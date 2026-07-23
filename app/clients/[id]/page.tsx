'use client'
import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ConfirmDialog } from '@/app/_components/ConfirmDialog'
import InPersonConsentForm from '@/components/InPersonConsentForm'
import RemoteConsentButton from '@/components/RemoteConsentButton'
import PrivacyLifecycleControls from '@/components/PrivacyLifecycleControls'
import { cmToInches, kgToPounds, round1 } from '@/lib/units'
import dynamic from 'next/dynamic'
import { toNum } from './numeric'
import {
  initialComparison,
  selectComparisonBase,
  selectComparisonTarget,
  sortAssessmentsChronologically,
} from './comparison'
import ComparisonWorkspace, { type ComparisonDeltaRow } from './ComparisonWorkspace'
import { buildClientComparison } from '@/lib/reports/clientComparison'
import { segmentTrendHistory } from '@/lib/comparison/trends'
import styles from './ClientEvidenceCanvas.module.css'

// recharts (+ d3) is heavy and only used on the Progress tab for multi-assessment
// clients; load it in its own chunk so it isn't shipped on every client-detail visit.
const ProgressCharts = dynamic(() => import('./ProgressCharts'), {
  ssr: false,
  loading: () => <div className={styles.loadingPanel} role="status">Loading progress charts…</div>,
})

interface Client {
  id: string
  first_name: string
  last_name: string
  date_of_birth: string | null
  sex_at_birth: string | null
  height_cm: number | null
  weight_kg: number | null
  notes: string | null
  consent_recorded_at: string | null
  created_at: string
}

interface Finding {
  imbalance_key: string
  label: string | null
  severity_pct: number | string | null
  zone: string | null
  region: string | null
  deviation: number | string | null
  standard: number | string | null
  unit: string | null
}

interface Assessment {
  id: string
  assessed_at: string
  overall_grade: string | null
  overall_score: number | string | null
  scoring_engine_version: string | null
  status: string
  assessment_findings?: Finding[]
}

type Tab = 'assessments' | 'progress' | 'compare' | 'info'

function formatStatus(status: string) {
  return status
    .split('_')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

export default function ClientDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const [client, setClient] = useState<Client | null>(null)
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [nextAssessmentCursor, setNextAssessmentCursor] = useState<string | null>(null)
  const [loadingMoreAssessments, setLoadingMoreAssessments] = useState(false)
  const assessmentRequestVersion = useRef(0)
  const loadMoreAssessmentController = useRef<AbortController | null>(null)
  const [historyPageError, setHistoryPageError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [historyLoadedForId, setHistoryLoadedForId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('assessments')
  const [workspaceReady, setWorkspaceReady] = useState<Tab>('assessments')
  const [archiving, setArchiving] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  // Compare selectors: older = "before", newer = "after"
  const [compareBaseId, setCompareBaseId] = useState<string>('')
  const [compareTargetId, setCompareTargetId] = useState<string>('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [consentStatus, setConsentStatus] = useState<
    'checking' | 'valid' | 'missing' | 'withdrawn' | 'reconsent_required' | 'unavailable'
  >('checking')

  useEffect(() => {
    const version = ++assessmentRequestVersion.current
    loadMoreAssessmentController.current?.abort()
    // Abort a stale load when the client id changes / the page unmounts, so a
    // slower earlier response can't show one client's data under another's page.
    const ac = new AbortController()
    async function load() {
      try {
        async function getJson<T>(url: string) {
          const response = await fetch(url, { cache: 'no-store', signal: ac.signal })
          const body = await response.json().catch(() => ({})) as T
          return { body, ok: response.ok, status: response.status }
        }

        const clientPromise = getJson<{ client?: Client; error?: string }>(`/api/clients/${encodeURIComponent(id)}`)
        const secondaryPromise = Promise.allSettled([
          getJson<{
            hasConsent?: boolean
            legalState?: 'current' | 'missing' | 'withdrawn' | 'reconsent_required' | 'legal_unavailable'
          }>(`/api/consent?client_id=${encodeURIComponent(id)}`),
          getJson<{
            assessments?: Assessment[]
            pagination?: { has_more?: boolean; next_cursor?: string | null }
          }>(`/api/clients/${encodeURIComponent(id)}/assessments?include_findings=true&limit=50`),
        ])

        const clientResult = await clientPromise
        if (ac.signal.aborted || version !== assessmentRequestVersion.current) return
        if (clientResult.status === 401) {
          router.push('/auth/sign-in')
          return
        }
        if (!clientResult.ok || !clientResult.body.client) {
          router.push('/clients')
          return
        }
        // Paint the owned client record as soon as its small identity request
        // completes. Consent and the larger history request were already started
        // in parallel and fill their own sections without holding back the page.
        setClient(clientResult.body.client)
        setLoading(false)

        const [consentResult, historyResult] = await secondaryPromise
        if (ac.signal.aborted || version !== assessmentRequestVersion.current) return
        const isUnauthorized = [consentResult, historyResult]
          .some((result) => result.status === 'fulfilled' && result.value.status === 401)
        if (isUnauthorized) {
          router.push('/auth/sign-in')
          return
        }

        const consent = consentResult.status === 'fulfilled' && consentResult.value.ok
          ? consentResult.value.body
          : null
        setConsentStatus(consent?.hasConsent && consent.legalState === 'current'
          ? 'valid'
          : consent?.legalState === 'withdrawn'
            ? 'withdrawn'
            : consent?.legalState === 'reconsent_required'
              ? 'reconsent_required'
              : consent?.legalState === 'missing'
                ? 'missing'
                : 'unavailable')

        if (historyResult.status === 'fulfilled' && historyResult.value.ok) {
          const json = historyResult.value.body
          const list = sortAssessmentsChronologically<Assessment>(json.assessments || [])
          setAssessments(list)
          setNextAssessmentCursor(json.pagination?.has_more ? json.pagination.next_cursor ?? null : null)
          // Default compare: earliest vs latest
          if (list.length >= 2) {
            const initial = initialComparison(list)
            setCompareBaseId(initial.baseId)
            setCompareTargetId(initial.targetId)
          }
        } else {
          setLoadError('Could not load the assessment history for this client. Refresh to try again.')
        }
      } catch (caught) {
        if ((caught as Error)?.name === 'AbortError') return
        setLoadError('Could not load this client record. Refresh to try again.')
      } finally {
        if (!ac.signal.aborted) {
          setLoading(false)
          setHistoryLoadedForId(id)
        }
      }
    }
    load()
    return () => {
      ac.abort()
      loadMoreAssessmentController.current?.abort()
    }
  }, [id, router])

  useEffect(() => {
    if (activeTab !== 'progress' && activeTab !== 'compare') return
    if (workspaceReady === activeTab) return
    const timer = window.setTimeout(() => setWorkspaceReady(activeTab), 250)
    return () => window.clearTimeout(timer)
  }, [activeTab, workspaceReady])

  async function loadMoreAssessments() {
    if (!nextAssessmentCursor || loadingMoreAssessments) return
    const version = assessmentRequestVersion.current
    loadMoreAssessmentController.current?.abort()
    const controller = new AbortController()
    loadMoreAssessmentController.current = controller
    setLoadingMoreAssessments(true)
    setHistoryPageError(null)
    try {
      const query = new URLSearchParams({
        include_findings: 'true',
        limit: '50',
        cursor: nextAssessmentCursor,
      })
      const response = await fetch(`/api/clients/${encodeURIComponent(id)}/assessments?${query.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Failed to load assessments (${response.status})`)
      const body = await response.json() as {
        assessments?: Assessment[]
        pagination?: { has_more?: boolean; next_cursor?: string | null }
      }
      if (controller.signal.aborted || version !== assessmentRequestVersion.current) return
      setAssessments((current) => {
        const byId = new Map(current.map((assessment) => [assessment.id, assessment]))
        for (const assessment of body.assessments ?? []) byId.set(assessment.id, assessment)
        return sortAssessmentsChronologically([...byId.values()])
      })
      setNextAssessmentCursor(body.pagination?.has_more ? body.pagination.next_cursor ?? null : null)
    } catch (caught) {
      if ((caught as Error)?.name !== 'AbortError' && version === assessmentRequestVersion.current) {
        setHistoryPageError('Could not load older assessments. Try again.')
      }
    } finally {
      if (loadMoreAssessmentController.current === controller) {
        loadMoreAssessmentController.current = null
        setLoadingMoreAssessments(false)
      }
    }
  }

  async function handleArchive() {
    if (!client) return
    setArchiving(true)
    setArchiveError(null)
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived_at: new Date().toISOString() }),
      })
      if (!res.ok) throw new Error(`Archive failed (${res.status})`)
      router.push('/clients')
    } catch {
      setArchiveError('Could not archive this client. Please try again.')
      setArchiving(false)
    }
  }

  if (loading || (client !== null && client.id !== id)) {
    return (
      <div className={`app-standard-page ${styles.canvas} ${styles.pageLoadingShell}`}>
        <div className={styles.loadingPanel} role="status">
          Loading client evidence…
        </div>
      </div>
    )
  }

  if (!client) return null

  const dob = client.date_of_birth
    ? new Date(client.date_of_birth).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    : null

  const consentDate = consentStatus === 'valid' && client.consent_recorded_at
    ? new Date(client.consent_recorded_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : null

  function handleConsentRecorded() {
    setConsentStatus('valid')
    setClient((current) => current
      ? { ...current, consent_recorded_at: new Date().toISOString() }
      : current)
  }

  function handleConsentWithdrawn() {
    setConsentStatus('withdrawn')
    setClient((current) => current ? { ...current, consent_recorded_at: null } : current)
  }

  const hasMultipleAssessments = assessments.length >= 2
  const availableTabs: Tab[] = hasMultipleAssessments
    ? ['assessments', 'progress', 'compare', 'info']
    : ['assessments', 'info']

  function activateTab(tab: Tab) {
    if (tab === activeTab) return
    setActiveTab(tab)
    if (tab !== 'progress' && tab !== 'compare') {
      setWorkspaceReady(tab)
      return
    }
    // Paint the selected panel immediately, then let the effect-owned timer
    // build its chart/comparison projection after the interaction frame.
    setWorkspaceReady('assessments')
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, tab: Tab) {
    const currentIndex = availableTabs.indexOf(tab)
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % availableTabs.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + availableTabs.length) % availableTabs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = availableTabs.length - 1
    if (nextIndex === null) return

    event.preventDefault()
    const nextTab = availableTabs[nextIndex]
    activateTab(nextTab)
    document.getElementById(`client-tab-${nextTab}`)?.focus()
  }

  function tabProps(tab: Tab) {
    return {
      id: `client-tab-${tab}`,
      role: 'tab',
      'aria-controls': `client-panel-${tab}`,
      'aria-selected': activeTab === tab,
      tabIndex: activeTab === tab ? 0 : -1,
      onClick: () => activateTab(tab),
      onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => handleTabKeyDown(event, tab),
    } as const
  }

  function panelProps(tab: Tab) {
    return {
      id: `client-panel-${tab}`,
      role: 'tabpanel',
      'aria-labelledby': `client-tab-${tab}`,
      tabIndex: 0,
    } as const
  }

  function handleCompareBaseChange(nextBaseId: string) {
    const next = selectComparisonBase(assessments, compareTargetId, nextBaseId)
    setCompareBaseId(next.baseId)
    setCompareTargetId(next.targetId)
  }

  function handleCompareTargetChange(nextTargetId: string) {
    const next = selectComparisonTarget(assessments, compareBaseId, nextTargetId)
    setCompareBaseId(next.baseId)
    setCompareTargetId(next.targetId)
  }

  // Build only the active workspace projection. The 50-assessment payload can
  // contain hundreds of findings, so computing every hidden tab on each render
  // turns a simple tab click into a long main-thread task.
  const imbalanceKeys: string[] = []
  const imbalanceLabels: Record<string, string> = {}
  let trendData: Array<Record<string, number | string | null>> = []
  let trendSegments: Array<{ id: string; scoringEngineVersion: string | null }> = []
  if (activeTab === 'progress' && workspaceReady === 'progress') {
    assessments.forEach((a) => {
      (a.assessment_findings || []).forEach((f) => {
        if (!imbalanceKeys.includes(f.imbalance_key)) {
          imbalanceKeys.push(f.imbalance_key)
          imbalanceLabels[f.imbalance_key] = f.label || f.imbalance_key
        }
      })
    })

    const segmentedTrendHistory = segmentTrendHistory(assessments.map((assessment) => ({
      ...assessment,
      assessmentId: assessment.id,
      scoringEngineVersion: assessment.scoring_engine_version,
    })))
    trendData = segmentedTrendHistory.points.map(({ value: a, segmentId }) => {
      const point: Record<string, number | string | null> = {
        assessment_id: a.id,
        date: new Date(a.assessed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        scoring_engine_version: a.scoring_engine_version,
        segment_id: segmentId,
        overall_score: toNum(a.overall_score),
        overall_grade: a.overall_grade,
      }
      const findingsMap: Record<string, number> = {}
      ;(a.assessment_findings || []).forEach((f) => {
        // severity_pct is NUMERIC → arrives as a string; coerce so the chart plots a
        // number and the tooltip's value.toFixed(1) doesn't throw.
        const sev = toNum(f.severity_pct)
        if (sev !== null && f.zone !== null && f.zone !== 'unreliable') findingsMap[f.imbalance_key] = sev
      })
      imbalanceKeys.forEach((key) => {
        if (findingsMap[key] !== undefined) point[key] = findingsMap[key]
      })
      return point
    })
    trendSegments = segmentedTrendHistory.segments.map((segment) => ({
      id: segment.id,
      scoringEngineVersion: segment.scoringEngineVersion,
    }))
  }

  // Comparison delta computation
  const comparisonReady = activeTab === 'compare' && workspaceReady === 'compare'
  const baseAssessment = comparisonReady ? assessments.find((a) => a.id === compareBaseId) : undefined
  const targetAssessment = comparisonReady ? assessments.find((a) => a.id === compareTargetId) : undefined
  const deltaRows: ComparisonDeltaRow[] = []
  const selectedComparison: ReturnType<typeof buildClientComparison> | null = baseAssessment && targetAssessment
    ? buildClientComparison({
        priorDateStr: fmtDate(baseAssessment.assessed_at),
        current: {
          grade: targetAssessment.overall_grade ?? '—',
          score: targetAssessment.overall_score,
          scoringEngineVersion: targetAssessment.scoring_engine_version,
          assessedAt: targetAssessment.assessed_at,
        },
        prior: {
          grade: baseAssessment.overall_grade ?? '—',
          score: baseAssessment.overall_score,
          scoringEngineVersion: baseAssessment.scoring_engine_version,
          assessedAt: baseAssessment.assessed_at,
        },
        currentFindings: (targetAssessment.assessment_findings || []).map((finding) => ({
          key: finding.imbalance_key,
          severityPct: finding.severity_pct,
          reliable: finding.zone !== null && finding.zone !== 'unreliable',
          unit: finding.unit,
        })),
        priorFindings: (baseAssessment.assessment_findings || []).map((finding) => ({
          key: finding.imbalance_key,
          severityPct: finding.severity_pct,
          reliable: finding.zone !== null && finding.zone !== 'unreliable',
          unit: finding.unit,
        })),
      })
    : null
  if (baseAssessment && targetAssessment) {
    const baseMap: Record<string, Finding> = {}
    const targetMap: Record<string, Finding> = {}
    ;(baseAssessment.assessment_findings || []).forEach((f) => { baseMap[f.imbalance_key] = f })
    ;(targetAssessment.assessment_findings || []).forEach((f) => { targetMap[f.imbalance_key] = f })
    const allKeys = Array.from(new Set([...Object.keys(baseMap), ...Object.keys(targetMap)]))
    allKeys.forEach((key) => {
      const b = baseMap[key]
      const t = targetMap[key]
      // deviation / severity_pct are NUMERIC → arrive as strings; coerce so the
      // delta table's toFixed() calls are numeric. Comparison decisions use the raw
      // values above so the central policy owns all validity and coercion rules.
      const baseDev = toNum(b?.deviation)
      const targetDev = toNum(t?.deviation)
      const baseUnit = b?.unit ?? null
      const targetUnit = t?.unit ?? null
      const unitsMatch = baseUnit !== null && targetUnit !== null && baseUnit === targetUnit
      const unit = targetUnit || baseUnit || ''
      const delta = unitsMatch && targetDev !== null && baseDev !== null ? targetDev - baseDev : null
      const comparison = selectedComparison?.byKey[key]
      if (!comparison) return
      deltaRows.push({
        key,
        label: b?.label || t?.label || key,
        baseDeviation: baseDev,
        targetDeviation: targetDev,
        baseUnit: baseUnit || '',
        targetUnit: targetUnit || '',
        unit,
        delta,
        comparison,
      })
    })
    // Stable, non-directional order. Raw severity deltas must not create a
    // second ranking policy outside lib/comparison/policy.ts.
    deltaRows.sort((left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key))
  }

  const comparisonAssessments = comparisonReady
    ? assessments.map((assessment) => ({
        id: assessment.id,
        assessedAt: assessment.assessed_at,
        overallGrade: assessment.overall_grade,
        overallScore: toNum(assessment.overall_score),
        scoringEngineVersion: assessment.scoring_engine_version,
        status: assessment.status,
      }))
    : []
  const latestAssessment = assessments.at(-1)
  const latestDeviation = toNum(latestAssessment?.overall_score)
  const trackingSpanDays = assessments.length >= 2
    ? Math.max(0, Math.round(
      (Date.parse(assessments[assessments.length - 1].assessed_at) - Date.parse(assessments[0].assessed_at))
      / (24 * 60 * 60 * 1000),
    ))
    : null
  const latestStatus = latestAssessment ? formatStatus(latestAssessment.status) : 'No assessment'
  const latestReviewContext = latestAssessment
    ? 'Approval state is not included in this history response.'
    : 'Review context appears after the first assessment.'

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className={`app-standard-page ${styles.canvas}`}>
      <div style={{ marginBottom: '24px' }}>
        <Link href="/clients" style={{ color: 'var(--brand)', textDecoration: 'none', fontSize: '0.875rem' }}>
          ← Back to Clients
        </Link>
      </div>

      {/* Profile Header */}
      <div className="app-panel" style={{
        background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '16px', padding: '24px', marginBottom: '24px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        flexWrap: 'wrap', gap: '12px',
      }}>
        <div>
          <p className="app-page-kicker">Client record</p>
          <h1 className="app-page-heading" style={{ marginBottom: '10px' }}>
            {client.first_name} {client.last_name}
          </h1>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            {dob && (
              <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                DOB: <span style={{ color: 'var(--text-secondary)' }}>{dob}</span>
              </span>
            )}
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Consent: {consentStatus === 'checking'
                ? <span style={{ color: 'var(--text-secondary)' }}>checking…</span>
                : consentStatus === 'valid'
                  ? <span style={{ color: '#10B981' }}>✓ {consentDate ?? 'recorded'}</span>
                  : consentStatus === 'unavailable'
                    ? <span style={{ color: 'var(--danger)' }}>unavailable</span>
                    : consentStatus === 'withdrawn'
                      ? <span style={{ color: 'var(--warning)' }}>withdrawn</span>
                      : consentStatus === 'reconsent_required'
                        ? <span style={{ color: 'var(--warning)' }}>new consent required</span>
                        : <span style={{ color: 'var(--warning)' }}>not recorded</span>}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <Link
            href={`/clients/${client.id}/edit`}
            style={{
              padding: '9px 16px', borderRadius: '8px',
              background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)',
              border: '1px solid rgba(255,255,255,0.12)',
              textDecoration: 'none', fontWeight: 600, fontSize: '0.85rem',
              whiteSpace: 'nowrap',
            }}
          >
            Edit Client
          </Link>
          <button
            onClick={() => setShowArchiveConfirm(true)}
            style={{
              padding: '9px 16px', borderRadius: '8px',
              background: 'rgba(239,68,68,0.1)', color: 'var(--danger)',
              border: '1px solid rgba(239,68,68,0.25)',
              fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
            }}
          >
            Archive Client
          </button>
          <Link
            href={`/assessments/new?client_id=${client.id}`}
            style={{
              padding: '10px 18px', borderRadius: '8px', background: 'var(--brand-strong)',
              color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: '0.9rem',
              whiteSpace: 'nowrap',
            }}
          >
            + New Assessment
          </Link>
        </div>
      </div>

      {consentStatus === 'missing' && (
        <div style={{ marginBottom: '16px', display: 'grid', gap: 12 }}>
          <InPersonConsentForm
            clientId={client.id}
            subjectName={`${client.first_name} ${client.last_name}`}
            onRecorded={handleConsentRecorded}
          />
          <RemoteConsentButton clientId={client.id} />
        </div>
      )}

      <section className={styles.metricsStrip} aria-label="Client evidence summary">
        <article className={styles.metricCard}>
          <p className={styles.metricLabel}>Latest screening</p>
          <p className={styles.metricValue}>
            {latestAssessment ? `Grade ${latestAssessment.overall_grade ?? '—'}` : '—'}
          </p>
          <p className={styles.metricSupport}>
            {latestAssessment
              ? `${latestDeviation === null ? 'Deviation unavailable' : `Deviation ${latestDeviation.toFixed(1)} / 100`} · ${fmtDate(latestAssessment.assessed_at)}`
              : 'Complete an assessment to establish a baseline.'}
          </p>
        </article>
        <article className={styles.metricCard}>
          <p className={styles.metricLabel}>Assessment count</p>
          <p className={styles.metricValue}>{assessments.length}{nextAssessmentCursor ? '+' : ''}</p>
          <p className={styles.metricSupport}>
            {nextAssessmentCursor
              ? `${assessments.length} screenings loaded; older history is available.`
              : assessments.length === 1 ? 'One recorded screening.' : `${assessments.length} recorded screenings.`}
          </p>
        </article>
        <article className={styles.metricCard}>
          <p className={styles.metricLabel}>Tracking span</p>
          <p className={styles.metricValue}>{trackingSpanDays === null ? '—' : `${nextAssessmentCursor ? '≥ ' : ''}${trackingSpanDays} days`}</p>
          <p className={styles.metricSupport}>
            {trackingSpanDays === null
              ? 'A second assessment starts the timeline.'
              : nextAssessmentCursor
                ? 'Loaded span; older assessments can extend it.'
                : 'Elapsed time from first to latest assessment.'}
          </p>
        </article>
        <article className={styles.metricCard}>
          <p className={styles.metricLabel}>Latest assessment status</p>
          <p className={styles.metricValue}>{latestStatus}</p>
          <p className={styles.metricSupport}>{latestReviewContext}</p>
        </article>
      </section>

      {/* Archive Confirmation Dialog */}
      {showArchiveConfirm && (
        <ConfirmDialog
          title="Archive Client?"
          confirmLabel={archiving ? 'Archiving...' : 'Yes, Archive'}
          onConfirm={handleArchive}
          onCancel={() => setShowArchiveConfirm(false)}
          busy={archiving}
          danger
          error={archiveError}
        >
          Archiving <strong style={{ color: 'var(--text-primary)' }}>{client.first_name} {client.last_name}</strong> will
          remove them from your active client list. Their data will be preserved and can be recovered.
        </ConfirmDialog>
      )}

      {/* Tabs */}
      <div className={styles.tabList} role="tablist" aria-label="Client workspace">
        <button
          {...tabProps('assessments')}
          className={`${styles.tab} ${activeTab === 'assessments' ? styles.tabActive : ''}`}
        >
          Assessments
        </button>
        {hasMultipleAssessments && (
          <>
            <button
              {...tabProps('progress')}
              className={`${styles.tab} ${activeTab === 'progress' ? styles.tabActive : ''}`}
            >
              Progress
            </button>
            <button
              {...tabProps('compare')}
              className={`${styles.tab} ${activeTab === 'compare' ? styles.tabActive : ''}`}
            >
              Compare
            </button>
          </>
        )}
        <button
          {...tabProps('info')}
          className={`${styles.tab} ${activeTab === 'info' ? styles.tabActive : ''}`}
        >
          Info
        </button>
      </div>

      {/* Assessments Tab */}
      {activeTab === 'assessments' && (
        <div {...panelProps('assessments')} style={{ background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '24px' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>Assessment History</h2>
          {historyLoadedForId !== id ? (
            <p role="status" className={styles.loadingPanel}>Loading assessment history…</p>
          ) : loadError ? (
            <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>{loadError}</p>
          ) : assessments.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No assessments yet. Click &quot;+ New Assessment&quot; to start.</p>
          ) : (
            <>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {[...assessments].reverse().map((a) => {
                  const date = fmtDate(a.assessed_at)
                  return (
                    <li key={a.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '12px', marginBottom: '12px' }}>
                      <Link href={`/assessments/${a.id}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textDecoration: 'none' }}>
                        <div>
                          <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 500 }}>Assessment — {date}</div>
                          {a.overall_score !== null && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>Deviation: {a.overall_score}/100 · lower is better</div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {a.overall_grade && (
                            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--brand)', background: 'rgba(0,152,243,0.12)', borderRadius: '6px', padding: '2px 8px' }}>
                              Grade {a.overall_grade}
                            </span>
                          )}
                          <span style={{ color: 'var(--text-secondary)' }}>›</span>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
              {historyPageError && <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.875rem' }}>{historyPageError}</p>}
              {nextAssessmentCursor && (
                <button
                  type="button"
                  onClick={loadMoreAssessments}
                  disabled={loadingMoreAssessments}
                  style={{
                    width: '100%', minHeight: 44, borderRadius: 10,
                    border: '1px solid rgba(0,152,243,0.28)', background: 'rgba(0,152,243,0.08)',
                    color: 'var(--brand)', fontWeight: 600, cursor: loadingMoreAssessments ? 'wait' : 'pointer',
                  }}
                >
                  {loadingMoreAssessments ? 'Loading older assessments…' : 'Load older assessments'}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Progress / Trend Charts Tab (recharts lazy-loaded — see ProgressCharts) */}
      {activeTab === 'progress' && hasMultipleAssessments && (
        <div {...panelProps('progress')}>
          {workspaceReady !== 'progress' ? (
            <p role="status" className={styles.loadingPanel}>Preparing progress charts…</p>
          ) : (
            <>
              {nextAssessmentCursor && (
                <p role="status" className={styles.loadingPanel}>
                  Showing the latest {assessments.length} assessments. Load older assessments in the Assessments tab to extend this chart.
                </p>
              )}
              <ProgressCharts
                trendData={trendData}
                trendSegments={trendSegments}
                imbalanceKeys={imbalanceKeys}
                imbalanceLabels={imbalanceLabels}
              />
            </>
          )}
        </div>
      )}

      {/* Compare Tab */}
      {activeTab === 'compare' && hasMultipleAssessments && (
        <div {...panelProps('compare')}>
          {workspaceReady !== 'compare' ? (
            <p role="status" className={styles.loadingPanel}>Preparing comparison…</p>
          ) : (
            <>
              {nextAssessmentCursor && (
                <p role="status" className={styles.loadingPanel}>
                  Comparing the latest {assessments.length} assessments. Load older assessments in the Assessments tab for earlier options.
                </p>
              )}
              <ComparisonWorkspace
                assessments={comparisonAssessments}
                baseId={compareBaseId}
                targetId={compareTargetId}
                deltaRows={deltaRows}
                overallComparison={selectedComparison?.overall ?? null}
                onBaseChange={handleCompareBaseChange}
                onTargetChange={handleCompareTargetChange}
              />
            </>
          )}
        </div>
      )}

      {/* Info Tab */}
      {activeTab === 'info' && (
        <div {...panelProps('info')}>
          <div style={{ background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '24px' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>Client Information</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px' }}>
            {dob && (
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Date of Birth</div>
                <div style={{ color: 'var(--text-primary)' }}>{dob}</div>
              </div>
            )}
            {client.sex_at_birth && (
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Sex at Birth</div>
                <div style={{ color: 'var(--text-primary)', textTransform: 'capitalize' }}>{client.sex_at_birth.replace('_', ' ')}</div>
              </div>
            )}
            {client.height_cm && (
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Height</div>
                <div style={{ color: 'var(--text-primary)' }}>
                  {round1(cmToInches(client.height_cm))} in{' '}
                  <span style={{ color: 'var(--text-secondary)' }}>({client.height_cm} cm)</span>
                </div>
              </div>
            )}
            {client.weight_kg && (
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Weight</div>
                <div style={{ color: 'var(--text-primary)' }}>
                  {round1(kgToPounds(client.weight_kg))} lb{' '}
                  <span style={{ color: 'var(--text-secondary)' }}>({client.weight_kg} kg)</span>
                </div>
              </div>
            )}
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Added</div>
              <div style={{ color: 'var(--text-primary)' }}>{new Date(client.created_at).toLocaleDateString()}</div>
            </div>
            {consentStatus !== 'checking' && (
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Consent</div>
                {consentStatus === 'valid' ? (
                  <div style={{ color: '#10B981', fontSize: '0.875rem' }}>
                    ✓ {client.consent_recorded_at ? new Date(client.consent_recorded_at).toLocaleDateString() : 'Recorded'}
                  </div>
                ) : consentStatus === 'withdrawn' ? (
                  <div style={{ color: 'var(--warning)', fontSize: '0.875rem' }}>Withdrawn</div>
                ) : consentStatus === 'reconsent_required' ? (
                  <div style={{ color: 'var(--warning)', fontSize: '0.875rem' }}>New consent required</div>
                ) : consentStatus === 'unavailable' ? (
                  <div style={{ color: 'var(--danger)', fontSize: '0.875rem' }}>Status unavailable</div>
                ) : (
                  <div style={{ color: 'var(--warning)', fontSize: '0.875rem' }}>Not recorded</div>
                )}
              </div>
            )}
          </div>
          {client.notes && (
            <div style={{ marginTop: '16px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Notes</div>
              <div style={{ color: 'var(--text-primary)', fontSize: '0.9rem', lineHeight: 1.6 }}>{client.notes}</div>
            </div>
          )}
          </div>
          <PrivacyLifecycleControls
            clientId={client.id}
            hasConsent={consentStatus === 'valid'}
            onConsentWithdrawn={handleConsentWithdrawn}
            onDeleted={({ externalStatus, receiptId }) => {
              if (externalStatus === 'pending' && receiptId) {
                sessionStorage.setItem('postureai:pending-erasure-receipt', receiptId)
              }
              router.push(`/clients?erasure=${externalStatus}`)
            }}
          />
        </div>
      )}
    </div>
  )
}

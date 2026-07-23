'use client'
import { memo, useCallback, useState, useEffect, useMemo, useRef } from 'react'
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

// recharts (+ d3) is heavy and only used for multi-assessment clients. Keep it
// in its own chunk, then begin loading it when bounded history confirms it is
// needed so the first Progress click only reveals retained content.
const ProgressCharts = dynamic(() => import('./ProgressCharts'), {
  ssr: false,
  loading: () => <div className={styles.loadingPanel} role="status">Loading progress charts…</div>,
})
const RetainedProgressCharts = memo(ProgressCharts)
const RetainedComparisonWorkspace = memo(ComparisonWorkspace)

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

export interface ClientDetailInitialData {
  client: Client
  assessments: Assessment[]
  pagination: {
    has_more: boolean
    next_cursor: string | null
    snapshot_at: string
  }
}

type Tab = 'assessments' | 'progress' | 'compare' | 'info'
const INITIAL_HISTORY_PAGE_SIZE = 20

function scheduleAfterPresentedFrame(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  if (typeof window.requestAnimationFrame !== 'function') {
    const timer = window.setTimeout(callback, 0)
    return () => window.clearTimeout(timer)
  }
  let secondFrame: number | null = null
  const firstFrame = window.requestAnimationFrame(() => {
    // The first frame presents the lightweight active panel. Mount expensive
    // charts/comparison evidence in the following frame so the tab click's INP
    // is not forced to wait for that work.
    secondFrame = window.requestAnimationFrame(callback)
  })
  return () => {
    window.cancelAnimationFrame(firstFrame)
    if (secondFrame !== null) window.cancelAnimationFrame(secondFrame)
  }
}

function formatStatus(status: string) {
  return status
    .split('_')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

export default function ClientDetailClient({
  initialData = null,
}: {
  initialData?: ClientDetailInitialData | null
}) {
  const params = useParams()
  const id = params.id as string
  // A route id is the ownership boundary for every state value below. Keying
  // the stateful record makes React discard the previous client's identity,
  // history, cursors, comparison selections, consent, and errors in the same
  // render that observes a new id. Same-id renders (including pagination) keep
  // the existing instance and its retained workspaces.
  const initialKey = initialData?.client.id === id ? initialData.pagination.snapshot_at : 'client-load'
  return <ClientDetailRoute key={`${id}:${initialKey}`} id={id} initialData={initialData} />
}

function ClientDetailRoute({
  id,
  initialData,
}: {
  id: string
  initialData: ClientDetailInitialData | null
}) {
  const router = useRouter()
  const ownsInitialData = initialData?.client.id === id
  const initialAssessments = ownsInitialData
    ? sortAssessmentsChronologically<Assessment>(initialData.assessments)
    : []
  const initialSelection = initialAssessments.length >= 2
    ? initialComparison(initialAssessments)
    : { baseId: '', targetId: '' }
  const [client, setClient] = useState<Client | null>(() => ownsInitialData ? initialData.client : null)
  const [assessments, setAssessments] = useState<Assessment[]>(initialAssessments)
  const [nextAssessmentCursor, setNextAssessmentCursor] = useState<string | null>(
    () => ownsInitialData && initialData.pagination.has_more ? initialData.pagination.next_cursor : null,
  )
  const [loadingMoreAssessments, setLoadingMoreAssessments] = useState(false)
  const assessmentRequestVersion = useRef(0)
  const loadMoreAssessmentController = useRef<AbortController | null>(null)
  const [historyPageError, setHistoryPageError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!ownsInitialData)
  const [historyLoadedForId, setHistoryLoadedForId] = useState<string | null>(ownsInitialData ? id : null)
  const [activeTab, setActiveTab] = useState<Tab>('assessments')
  const [renderedTabs, setRenderedTabs] = useState<ReadonlySet<Tab>>(
    () => new Set<Tab>(['assessments', 'info']),
  )
  const [archiving, setArchiving] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  // Compare selectors: older = "before", newer = "after"
  const [compareBaseId, setCompareBaseId] = useState<string>(initialSelection.baseId)
  const [compareTargetId, setCompareTargetId] = useState<string>(initialSelection.targetId)
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

        if (ownsInitialData) {
          // The server already supplied the owned record and bounded history in
          // the navigation response. Only the mutable legal-consent decision is
          // refreshed after hydration; repeating the two data queries would
          // contend with the first tab interaction on a throttled device.
          const consentResult = await getJson<{
            hasConsent?: boolean
            legalState?: 'current' | 'missing' | 'withdrawn' | 'reconsent_required' | 'legal_unavailable'
          }>(`/api/consent?client_id=${encodeURIComponent(id)}`)
          if (ac.signal.aborted || version !== assessmentRequestVersion.current) return
          if (consentResult.status === 401) {
            router.push('/auth/sign-in')
            return
          }
          const consent = consentResult.ok ? consentResult.body : null
          setConsentStatus(consent?.hasConsent && consent.legalState === 'current'
            ? 'valid'
            : consent?.legalState === 'withdrawn'
              ? 'withdrawn'
              : consent?.legalState === 'reconsent_required'
                ? 'reconsent_required'
                : consent?.legalState === 'missing'
                  ? 'missing'
                  : 'unavailable')
          return
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
          }>(`/api/clients/${encodeURIComponent(id)}/assessments?include_findings=true&limit=${INITIAL_HISTORY_PAGE_SIZE}`),
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
        if (ownsInitialData) setConsentStatus('unavailable')
        else setLoadError('Could not load this client record. Refresh to try again.')
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
  }, [id, ownsInitialData, router])

  useEffect(() => {
    if (renderedTabs.has(activeTab)) return
    return scheduleAfterPresentedFrame(() => {
      setRenderedTabs((current) => {
        if (current.has(activeTab)) return current
        const next = new Set(current)
        next.add(activeTab)
        return next
      })
    })
  }, [activeTab, renderedTabs])

  const {
    imbalanceKeys,
    imbalanceLabels,
    trendData,
    trendSegments,
  } = useMemo(() => {
    const keys: string[] = []
    const labels: Record<string, string> = {}
    assessments.forEach((assessment) => {
      ;(assessment.assessment_findings || []).forEach((finding) => {
        if (!keys.includes(finding.imbalance_key)) {
          keys.push(finding.imbalance_key)
          labels[finding.imbalance_key] = finding.label || finding.imbalance_key
        }
      })
    })

    const segmentedTrendHistory = segmentTrendHistory(assessments.map((assessment) => ({
      ...assessment,
      assessmentId: assessment.id,
      scoringEngineVersion: assessment.scoring_engine_version,
    })))
    const data = segmentedTrendHistory.points.map(({ value: assessment, segmentId }) => {
      const point: Record<string, number | string | null> = {
        assessment_id: assessment.id,
        date: new Date(assessment.assessed_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        }),
        scoring_engine_version: assessment.scoring_engine_version,
        segment_id: segmentId,
        overall_score: toNum(assessment.overall_score),
        overall_grade: assessment.overall_grade,
      }
      const findingsMap: Record<string, number> = {}
      ;(assessment.assessment_findings || []).forEach((finding) => {
        // severity_pct is NUMERIC and therefore may arrive as a string.
        const severity = toNum(finding.severity_pct)
        if (severity !== null && finding.zone !== null && finding.zone !== 'unreliable') {
          findingsMap[finding.imbalance_key] = severity
        }
      })
      keys.forEach((key) => {
        if (findingsMap[key] !== undefined) point[key] = findingsMap[key]
      })
      return point
    })

    return {
      imbalanceKeys: keys,
      imbalanceLabels: labels,
      trendData: data,
      trendSegments: segmentedTrendHistory.segments.map((segment) => ({
        id: segment.id,
        scoringEngineVersion: segment.scoringEngineVersion,
      })),
    }
  }, [assessments])

  const {
    deltaRows,
    selectedComparison,
    comparisonAssessments,
  } = useMemo(() => {
    const baseAssessment = assessments.find((assessment) => assessment.id === compareBaseId)
    const targetAssessment = assessments.find((assessment) => assessment.id === compareTargetId)
    const comparison = baseAssessment && targetAssessment
      ? buildClientComparison({
          priorDateStr: new Date(baseAssessment.assessed_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'UTC',
          }),
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
    const rows: ComparisonDeltaRow[] = []

    if (baseAssessment && targetAssessment) {
      const baseMap: Record<string, Finding> = {}
      const targetMap: Record<string, Finding> = {}
      ;(baseAssessment.assessment_findings || []).forEach((finding) => {
        baseMap[finding.imbalance_key] = finding
      })
      ;(targetAssessment.assessment_findings || []).forEach((finding) => {
        targetMap[finding.imbalance_key] = finding
      })
      const allKeys = Array.from(new Set([...Object.keys(baseMap), ...Object.keys(targetMap)]))
      allKeys.forEach((key) => {
        const baseFinding = baseMap[key]
        const targetFinding = targetMap[key]
        const baseDeviation = toNum(baseFinding?.deviation)
        const targetDeviation = toNum(targetFinding?.deviation)
        const baseUnit = baseFinding?.unit ?? null
        const targetUnit = targetFinding?.unit ?? null
        const unitsMatch = baseUnit !== null && targetUnit !== null && baseUnit === targetUnit
        const rowComparison = comparison?.byKey[key]
        if (!rowComparison) return
        rows.push({
          key,
          label: baseFinding?.label || targetFinding?.label || key,
          baseDeviation,
          targetDeviation,
          baseUnit: baseUnit || '',
          targetUnit: targetUnit || '',
          unit: targetUnit || baseUnit || '',
          delta: unitsMatch && targetDeviation !== null && baseDeviation !== null
            ? targetDeviation - baseDeviation
            : null,
          comparison: rowComparison,
        })
      })
      // Stable, non-directional order. The shared comparison policy owns meaning.
      rows.sort((left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key))
    }

    return {
      deltaRows: rows,
      selectedComparison: comparison,
      comparisonAssessments: assessments.map((assessment) => ({
        id: assessment.id,
        assessedAt: assessment.assessed_at,
        overallGrade: assessment.overall_grade,
        overallScore: toNum(assessment.overall_score),
        scoringEngineVersion: assessment.scoring_engine_version,
        status: assessment.status,
      })),
    }
  }, [assessments, compareBaseId, compareTargetId])

  const handleCompareBaseChange = useCallback((nextBaseId: string) => {
    const next = selectComparisonBase(assessments, compareTargetId, nextBaseId)
    setCompareBaseId(next.baseId)
    setCompareTargetId(next.targetId)
  }, [assessments, compareTargetId])

  const handleCompareTargetChange = useCallback((nextTargetId: string) => {
    const next = selectComparisonTarget(assessments, compareBaseId, nextTargetId)
    setCompareBaseId(next.baseId)
    setCompareTargetId(next.targetId)
  }, [assessments, compareBaseId])

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
    ? new Date(client.consent_recorded_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
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
      hidden: activeTab !== tab,
    } as const
  }

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

  // Client-detail evidence is server rendered. Its calendar-date projection is
  // deliberately UTC (docs/qa/pr09-performance-runbook.md) so hydration and
  // later browser renders describe the same stored timestamp identically.
  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
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

      {/* Progress / Trend Charts Tab (recharts lazy-loaded — see ProgressCharts) */}
      {hasMultipleAssessments && (
        <div {...panelProps('progress')}>
          {renderedTabs.has('progress') ? (
            <>
              {nextAssessmentCursor && (
                <p role="status" className={styles.loadingPanel}>
                  Showing the latest {assessments.length} assessments. Load older assessments in the Assessments tab to extend this chart.
                </p>
              )}
              <RetainedProgressCharts
                trendData={trendData}
                trendSegments={trendSegments}
                imbalanceKeys={imbalanceKeys}
                imbalanceLabels={imbalanceLabels}
              />
            </>
          ) : (
            <div className={styles.loadingPanel} role="status">Preparing progress charts…</div>
          )}
        </div>
      )}

      {/* Compare Tab */}
      {hasMultipleAssessments && (
        <div {...panelProps('compare')}>
          {renderedTabs.has('compare') ? (
            <>
              {nextAssessmentCursor && (
                <p role="status" className={styles.loadingPanel}>
                  Comparing the latest {assessments.length} assessments. Load older assessments in the Assessments tab for earlier options.
                </p>
              )}
              <RetainedComparisonWorkspace
                assessments={comparisonAssessments}
                baseId={compareBaseId}
                targetId={compareTargetId}
                deltaRows={deltaRows}
                overallComparison={selectedComparison?.overall ?? null}
                onBaseChange={handleCompareBaseChange}
                onTargetChange={handleCompareTargetChange}
              />
            </>
          ) : (
            <div className={styles.loadingPanel} role="status">Preparing comparison…</div>
          )}
        </div>
      )}

      {/* Info Tab */}
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
              <div style={{ color: 'var(--text-primary)' }}>
                {new Date(client.created_at).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'numeric',
                  day: 'numeric',
                  timeZone: 'UTC',
                })}
              </div>
            </div>
            {consentStatus !== 'checking' && (
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Consent</div>
                {consentStatus === 'valid' ? (
                  <div style={{ color: '#10B981', fontSize: '0.875rem' }}>
                    ✓ {client.consent_recorded_at
                      ? new Date(client.consent_recorded_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'numeric',
                          day: 'numeric',
                          timeZone: 'UTC',
                        })
                      : 'Recorded'}
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
    </div>
  )
}

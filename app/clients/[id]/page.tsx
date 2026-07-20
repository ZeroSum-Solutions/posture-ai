'use client'
import { useState, useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ConfirmDialog } from '@/app/_components/ConfirmDialog'
import InPersonConsentForm from '@/components/InPersonConsentForm'
import RemoteConsentButton from '@/components/RemoteConsentButton'
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
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('assessments')
  const [archiving, setArchiving] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  // Compare selectors: older = "before", newer = "after"
  const [compareBaseId, setCompareBaseId] = useState<string>('')
  const [compareTargetId, setCompareTargetId] = useState<string>('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [consentStatus, setConsentStatus] = useState<'checking' | 'valid' | 'missing' | 'unavailable'>('checking')

  useEffect(() => {
    // Abort a stale load when the client id changes / the page unmounts, so a
    // slower earlier response can't show one client's data under another's page.
    const ac = new AbortController()
    async function load() {
      const supabase = createSupabaseBrowserClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (ac.signal.aborted) return
      if (!user) { router.push('/auth/sign-in'); return }
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id)
        .eq('practitioner_id', user.id)
        .single()
      if (ac.signal.aborted) return
      if (error || !data) { router.push('/clients'); return }
      setClient(data)

      try {
        const consentResponse = await fetch(`/api/consent?client_id=${encodeURIComponent(id)}`, {
          cache: 'no-store',
          signal: ac.signal,
        })
        if (!consentResponse.ok) throw new Error(`Failed to load consent (${consentResponse.status})`)
        const consent = await consentResponse.json() as { hasConsent?: boolean }
        if (ac.signal.aborted) return
        setConsentStatus(consent.hasConsent ? 'valid' : 'missing')
      } catch (caught) {
        if ((caught as Error)?.name === 'AbortError') return
        setConsentStatus('unavailable')
      }

      try {
        const res = await fetch(`/api/clients/${id}/assessments?include_findings=true`, { signal: ac.signal })
        if (!res.ok) throw new Error(`Failed to load assessments (${res.status})`)
        const json = await res.json()
        const list = sortAssessmentsChronologically<Assessment>(json.assessments || [])
        setAssessments(list)
        // Default compare: earliest vs latest
        if (list.length >= 2) {
          const initial = initialComparison(list)
          setCompareBaseId(initial.baseId)
          setCompareTargetId(initial.targetId)
        }
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return
        setLoadError('Could not load the assessment history for this client. Refresh to try again.')
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => ac.abort()
  }, [id, router])

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

  if (loading) {
    return (
      <div className={styles.loadingPanel} role="status">
        Loading client evidence…
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

  const hasMultipleAssessments = assessments.length >= 2
  const availableTabs: Tab[] = hasMultipleAssessments
    ? ['assessments', 'progress', 'compare', 'info']
    : ['assessments', 'info']

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
    setActiveTab(nextTab)
    document.getElementById(`client-tab-${nextTab}`)?.focus()
  }

  function tabProps(tab: Tab) {
    return {
      id: `client-tab-${tab}`,
      role: 'tab',
      'aria-controls': `client-panel-${tab}`,
      'aria-selected': activeTab === tab,
      tabIndex: activeTab === tab ? 0 : -1,
      onClick: () => setActiveTab(tab),
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

  // Build chart trend data
  const imbalanceKeys: string[] = []
  const imbalanceLabels: Record<string, string> = {}
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
  const trendData = segmentedTrendHistory.points.map(({ value: a, segmentId }) => {
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
  const trendSegments = segmentedTrendHistory.segments.map((segment) => ({
    id: segment.id,
    scoringEngineVersion: segment.scoringEngineVersion,
  }))

  // Comparison delta computation
  const baseAssessment = assessments.find((a) => a.id === compareBaseId)
  const targetAssessment = assessments.find((a) => a.id === compareTargetId)
  const deltaRows: ComparisonDeltaRow[] = []
  const selectedComparison = baseAssessment && targetAssessment
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

  const comparisonAssessments = assessments.map((assessment) => ({
    id: assessment.id,
    assessedAt: assessment.assessed_at,
    overallGrade: assessment.overall_grade,
    overallScore: toNum(assessment.overall_score),
    scoringEngineVersion: assessment.scoring_engine_version,
    status: assessment.status,
  }))
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
                  : <span style={{ color: 'var(--warning)' }}>pending</span>}
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
          <p className={styles.metricValue}>{assessments.length}</p>
          <p className={styles.metricSupport}>
            {assessments.length === 1 ? 'One recorded screening.' : `${assessments.length} recorded screenings.`}
          </p>
        </article>
        <article className={styles.metricCard}>
          <p className={styles.metricLabel}>Tracking span</p>
          <p className={styles.metricValue}>{trackingSpanDays === null ? '—' : `${trackingSpanDays} days`}</p>
          <p className={styles.metricSupport}>
            {trackingSpanDays === null ? 'A second assessment starts the timeline.' : 'Elapsed time from first to latest assessment.'}
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
          {loadError ? (
            <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>{loadError}</p>
          ) : assessments.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No assessments yet. Click &quot;+ New Assessment&quot; to start.</p>
          ) : (
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
          )}
        </div>
      )}

      {/* Progress / Trend Charts Tab (recharts lazy-loaded — see ProgressCharts) */}
      {activeTab === 'progress' && hasMultipleAssessments && (
        <div {...panelProps('progress')}>
          <ProgressCharts
            trendData={trendData}
            trendSegments={trendSegments}
            imbalanceKeys={imbalanceKeys}
            imbalanceLabels={imbalanceLabels}
          />
        </div>
      )}

      {/* Compare Tab */}
      {activeTab === 'compare' && hasMultipleAssessments && (
        <div {...panelProps('compare')}>
          <ComparisonWorkspace
            assessments={comparisonAssessments}
            baseId={compareBaseId}
            targetId={compareTargetId}
            deltaRows={deltaRows}
            overallComparison={selectedComparison?.overall ?? null}
            onBaseChange={handleCompareBaseChange}
            onTargetChange={handleCompareTargetChange}
          />
        </div>
      )}

      {/* Info Tab */}
      {activeTab === 'info' && (
        <div {...panelProps('info')} style={{ background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '24px' }}>
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
                ) : (
                  <div style={{ color: 'var(--warning)', fontSize: '0.875rem' }}>Pending</div>
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
      )}
    </div>
  )
}

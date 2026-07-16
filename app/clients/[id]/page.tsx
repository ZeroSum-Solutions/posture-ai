'use client'
import { useState, useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ConfirmDialog } from '@/app/_components/ConfirmDialog'
import { cmToInches, kgToPounds, round1 } from '@/lib/units'
import dynamic from 'next/dynamic'
import { toNum } from './numeric'
import {
  initialComparison,
  selectComparisonBase,
  selectComparisonTarget,
  sortAssessmentsChronologically,
} from './comparison'
import RemoteConsentButton from '@/components/RemoteConsentButton'

// recharts (+ d3) is heavy and only used on the Progress tab for multi-assessment
// clients; load it in its own chunk so it isn't shipped on every client-detail visit.
const ProgressCharts = dynamic(() => import('./ProgressCharts'), { ssr: false })

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
  severity_pct: number | null
  zone: string | null
  region: string | null
  deviation: number | null
  standard: number | null
  unit: string | null
}

interface Assessment {
  id: string
  assessed_at: string
  overall_grade: string | null
  overall_score: number | null
  status: string
  assessment_findings?: Finding[]
}

type Tab = 'assessments' | 'progress' | 'compare' | 'info'

const GRADE_TO_PCT: Record<string, number> = {
  S: 100, A: 83, B: 66, C: 50, D: 33, E: 0,
}

const GRADE_ORDER: Record<string, number> = {
  S: 6, A: 5, B: 4, C: 3, D: 2, E: 1,
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
      <div style={{ padding: '32px 24px', maxWidth: '960px', margin: '0 auto' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading...</p>
      </div>
    )
  }

  if (!client) return null

  const dob = client.date_of_birth
    ? new Date(client.date_of_birth).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
    : null

  const consentDate = client.consent_recorded_at
    ? new Date(client.consent_recorded_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : null

  const tabStyle = (tab: Tab): React.CSSProperties => ({
    padding: '10px 20px',
    background: activeTab === tab ? 'var(--brand-strong)' : 'transparent',
    color: activeTab === tab ? '#fff' : 'var(--text-secondary)',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 600,
    fontSize: '0.875rem',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  })

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

  const trendData = assessments.map((a) => {
    const point: Record<string, number | string> = {
      date: new Date(a.assessed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      grade_pct: a.overall_grade ? (GRADE_TO_PCT[a.overall_grade] ?? 0) : 0,
    }
    const findingsMap: Record<string, number> = {}
    ;(a.assessment_findings || []).forEach((f) => {
      // severity_pct is NUMERIC → arrives as a string; coerce so the chart plots a
      // number and the tooltip's value.toFixed(1) doesn't throw.
      const sev = toNum(f.severity_pct)
      if (sev !== null) findingsMap[f.imbalance_key] = sev
    })
    imbalanceKeys.forEach((key) => {
      if (findingsMap[key] !== undefined) point[key] = findingsMap[key]
    })
    return point
  })

  // Comparison delta computation
  const baseAssessment = assessments.find((a) => a.id === compareBaseId)
  const targetAssessment = assessments.find((a) => a.id === compareTargetId)
  const baseDate = baseAssessment ? Date.parse(baseAssessment.assessed_at) : null
  const laterAssessments = baseDate === null
    ? []
    : assessments.filter((assessment) => Date.parse(assessment.assessed_at) > baseDate)

  type DeltaRow = {
    key: string
    label: string
    baseDev: number | null
    targetDev: number | null
    baseSev: number | null
    targetSev: number | null
    unit: string
    delta: number | null
    improved: boolean | null
  }

  const deltaRows: DeltaRow[] = []
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
      // delta table's toFixed() calls and the severity comparison below are numeric
      // (a string compare would order "9" after "80").
      const baseDev = toNum(b?.deviation)
      const targetDev = toNum(t?.deviation)
      const baseSev = toNum(b?.severity_pct)
      const targetSev = toNum(t?.severity_pct)
      const unit = b?.unit || t?.unit || 'deg'
      const delta = targetDev !== null && baseDev !== null ? targetDev - baseDev : null
      // Improved = severity decreased (lower is better)
      const improved = targetSev !== null && baseSev !== null
        ? targetSev < baseSev ? true : targetSev > baseSev ? false : null
        : null
      deltaRows.push({
        key,
        label: b?.label || t?.label || key,
        baseDev, targetDev, baseSev, targetSev, unit, delta, improved,
      })
    })
    // Sort by severity change (biggest regression first, then biggest improvement)
    deltaRows.sort((a, b) => {
      const aChange = a.targetSev !== null && a.baseSev !== null ? a.targetSev - a.baseSev : 0
      const bChange = b.targetSev !== null && b.baseSev !== null ? b.targetSev - b.baseSev : 0
      return bChange - aChange
    })
  }

  const baseGrade = baseAssessment?.overall_grade ?? null
  const targetGrade = targetAssessment?.overall_grade ?? null
  const gradeImproved = baseGrade && targetGrade
    ? (GRADE_ORDER[targetGrade] ?? 0) > (GRADE_ORDER[baseGrade] ?? 0)
    : null
  const gradeRegressed = baseGrade && targetGrade
    ? (GRADE_ORDER[targetGrade] ?? 0) < (GRADE_ORDER[baseGrade] ?? 0)
    : null

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className="app-standard-page">
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
              Consent: {consentDate
                ? <span style={{ color: '#10B981' }}>✓ {consentDate}</span>
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

      {!client.consent_recorded_at && (
        <div style={{ marginBottom: '16px' }}>
          <RemoteConsentButton clientId={client.id} />
        </div>
      )}

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
      <div className="app-panel" role="tablist" aria-label="Client workspace" style={{
        display: 'flex', gap: '4px', marginBottom: '16px',
        background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '10px', padding: '4px', flexWrap: 'wrap',
      }}>
        <button {...tabProps('assessments')} style={tabStyle('assessments')}>Assessments</button>
        {hasMultipleAssessments && (
          <>
            <button {...tabProps('progress')} style={tabStyle('progress')}>Progress</button>
            <button {...tabProps('compare')} style={tabStyle('compare')}>Compare</button>
          </>
        )}
        <button {...tabProps('info')} style={tabStyle('info')}>Info</button>
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
          <ProgressCharts trendData={trendData} imbalanceKeys={imbalanceKeys} imbalanceLabels={imbalanceLabels} />
        </div>
      )}

      {/* Compare Tab */}
      {activeTab === 'compare' && hasMultipleAssessments && (
        <div {...panelProps('compare')} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Assessment selectors */}
          <div style={{ background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '20px' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '16px' }}>Compare Two Assessments</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '12px', alignItems: 'center' }}>
              <div>
                <label htmlFor="compare-before" style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Before (baseline)</label>
                <select
                  id="compare-before"
                  value={compareBaseId}
                  onChange={(e) => handleCompareBaseChange(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--background)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', fontSize: '0.875rem' }}
                >
                  {assessments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {fmtDate(a.assessed_at)} — Grade {a.overall_grade ?? '?'}
                    </option>
                  ))}
                </select>
              </div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '1.25rem', textAlign: 'center' }}>→</span>
              <div>
                <label htmlFor="compare-after" style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>After (comparison)</label>
                <select
                  id="compare-after"
                  value={compareTargetId}
                  onChange={(e) => handleCompareTargetChange(e.target.value)}
                  disabled={laterAssessments.length === 0}
                  style={{ width: '100%', padding: '8px 12px', background: 'var(--background)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', fontSize: '0.875rem' }}
                >
                  {laterAssessments.length === 0 && <option value="">No later assessment available</option>}
                  {laterAssessments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {fmtDate(a.assessed_at)} — Grade {a.overall_grade ?? '?'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {laterAssessments.length === 0 && (
              <p role="status" style={{ margin: '12px 0 0', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                No later assessment is available. Choose an earlier Before assessment.
              </p>
            )}
          </div>

          {/* Grade change summary */}
          {baseGrade && targetGrade && (
            <div style={{
              background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '16px', padding: '20px',
            }}>
              <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Overall Grade Change
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--brand)' }}>Grade {baseGrade}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>Before</div>
                </div>
                <div style={{ fontSize: '1.5rem', color: gradeImproved ? '#10B981' : gradeRegressed ? 'var(--danger)' : 'var(--text-secondary)' }}>
                  {gradeImproved ? '↑' : gradeRegressed ? '↓' : '→'}
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', fontWeight: 700, color: gradeImproved ? '#10B981' : gradeRegressed ? 'var(--danger)' : 'var(--brand)' }}>
                    Grade {targetGrade}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>After</div>
                </div>
                <div style={{
                  marginLeft: '8px',
                  padding: '4px 12px',
                  borderRadius: '20px',
                  background: gradeImproved ? 'rgba(16,185,129,0.12)' : gradeRegressed ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)',
                  color: gradeImproved ? '#10B981' : gradeRegressed ? 'var(--danger)' : 'var(--text-secondary)',
                  fontSize: '0.85rem', fontWeight: 600,
                }}>
                  {gradeImproved ? 'Improved' : gradeRegressed ? 'Regressed' : 'No Change'}
                </div>
              </div>
            </div>
          )}

          {/* Per-imbalance delta table */}
          {deltaRows.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '20px' }}>
              <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Imbalance Deltas
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 500, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>Metric</th>
                      <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 500, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>Before</th>
                      <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 500, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>After</th>
                      <th style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 500, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>Delta</th>
                      <th style={{ textAlign: 'center', padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 500, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deltaRows.map((row) => {
                      const deltaSign = row.delta !== null ? (row.delta > 0 ? '+' : '') : ''
                      const deltaColor = row.improved === true ? '#10B981' : row.improved === false ? 'var(--danger)' : 'var(--text-secondary)'
                      return (
                        <tr key={row.key} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '10px 12px', color: 'var(--text-primary)' }}>{row.label}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                            {row.baseDev !== null ? `${row.baseDev.toFixed(1)}${row.unit}` : '—'}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                            {row.targetDev !== null ? `${row.targetDev.toFixed(1)}${row.unit}` : '—'}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: deltaColor, fontWeight: 600 }}>
                            {row.delta !== null ? `${deltaSign}${row.delta.toFixed(1)}${row.unit}` : '—'}
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            {row.improved === true && (
                              <span style={{ color: '#10B981', fontSize: '0.8rem', background: 'rgba(16,185,129,0.12)', padding: '2px 8px', borderRadius: '12px' }}>↓ Improved</span>
                            )}
                            {row.improved === false && (
                              <span style={{ color: 'var(--danger)', fontSize: '0.8rem', background: 'rgba(239,68,68,0.12)', padding: '2px 8px', borderRadius: '12px' }}>↑ Regressed</span>
                            )}
                            {row.improved === null && (
                              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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
            {client.consent_recorded_at && (
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Consent Recorded</div>
                <div style={{ color: '#10B981', fontSize: '0.875rem' }}>✓ {new Date(client.consent_recorded_at).toLocaleDateString()}</div>
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

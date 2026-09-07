'use client'
import { memo, startTransition, useCallback, useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ConfirmDialog } from '@/app/_components/ConfirmDialog'
import InPersonConsentForm from '@/components/InPersonConsentForm'
import RemoteConsentButton from '@/components/RemoteConsentButton'
import PrivacyLifecycleControls from '@/components/PrivacyLifecycleControls'
import { GradeChip } from '@/components/array/Chip'
import Icon from '@/components/array/Icon'
import { Surface, SurfaceLink } from '@/components/array/Surface'
import { TabStrip, tabPanelProps, type TabOption } from '@/components/array/Tabs'
import { bandFromGrade, ring, tint, tone } from '@/components/array/severity'
import { cmToInches, kgToPounds, round1 } from '@/lib/units'
import { toNum } from './numeric'
import {
  initialComparison,
  selectComparisonBase,
  selectComparisonTarget,
  sortAssessmentsChronologically,
} from './comparison'
import ComparisonWorkspace, { type ComparisonDeltaRow } from './ComparisonWorkspace'
import FindingsTrend from './FindingsTrend'
import TrendChart from './TrendChart'
import { buildHistoryRows } from './historyRows'
import { buildClientComparison } from '@/lib/reports/clientComparison'
import { segmentTrendHistory } from '@/lib/comparison/trends'
import styles from './ClientDetail.module.css'
import type { OperationMode } from '@/lib/prototype/runtime'

const RetainedFindingsTrend = memo(FindingsTrend)
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
  operationMode?: OperationMode
  client: Client
  assessments: Assessment[]
  consentStatus: 'valid' | 'missing' | 'withdrawn' | 'reconsent_required' | 'unavailable' | 'not_required'
  pagination: {
    has_more: boolean
    next_cursor: string | null
    snapshot_at: string
  }
}

/**
 * The trend, the actions and the scan history are the screen, not a tab. What
 * remains behind tabs is per-finding detail, the comparison workspace, and the
 * record's own particulars — each of which a practitioner opens deliberately.
 */
type Tab = 'findings' | 'compare' | 'details'
const TAB_ID_BASE = 'client'
const INITIAL_HISTORY_PAGE_SIZE = 20
const DEFERRED_WORKSPACE_MOUNT_MS = 300

function scheduleAfterPresentedFrame(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  // A pair of animation frames does not guarantee that Chromium presents
  // between them when the main thread is CPU-throttled. Keep expensive charts
  // and comparison tables in a later task so the lightweight selected tab can
  // paint first. The effect cleanup cancels work for a tab the user already
  // left, avoiding cross-interaction contention.
  const timer = window.setTimeout(callback, DEFERRED_WORKSPACE_MOUNT_MS)
  return () => window.clearTimeout(timer)
}

interface ClientWorkspaceProps {
  hasMultipleAssessments: boolean
  findingsPanel: ReactNode
  comparePanel: ReactNode
  detailsPanel: ReactNode
  privacyPanel: ReactNode
}

const ClientWorkspace = memo(function ClientWorkspace({
  hasMultipleAssessments,
  findingsPanel,
  comparePanel,
  detailsPanel,
  privacyPanel,
}: ClientWorkspaceProps) {
  // Keep tab navigation below the client route boundary. A tab click should
  // update a few small controls and panel visibility, not reconcile the trend
  // card, scan history, or consent controls above them.
  const availableTabs: Tab[] = hasMultipleAssessments
    ? ['findings', 'compare', 'details']
    : ['findings', 'details']
  const [activeTab, setActiveTab] = useState<Tab>('findings')
  const [renderedTabs, setRenderedTabs] = useState<ReadonlySet<Tab>>(
    () => new Set<Tab>(['findings']),
  )

  const options: readonly TabOption<Tab>[] = availableTabs.map(tab => ({
    value: tab,
    label: tab === 'findings' ? 'Findings' : tab === 'compare' ? 'Compare' : 'Details',
  }))

  useEffect(() => {
    // Compare and Details mount after their lightweight sibling has painted, so
    // hidden privacy-inventory work cannot collide with the first measured
    // interaction on a throttled device.
    if (renderedTabs.has(activeTab)) return
    return scheduleAfterPresentedFrame(() => {
      startTransition(() => {
        setRenderedTabs((current) => {
          if (current.has(activeTab)) return current
          const next = new Set(current)
          next.add(activeTab)
          return next
        })
      })
    })
  }, [activeTab, renderedTabs])

  const privacyStatus = activeTab === 'details'
    ? renderedTabs.has('details')
      ? 'Privacy controls ready.'
      : 'Preparing privacy controls…'
    : ''

  function panelClass(tab: Tab) {
    return `${styles.workspacePanel} ${activeTab === tab ? styles.workspacePanelActive : ''}`
  }

  return (
    <>
      <TabStrip
        idBase={TAB_ID_BASE}
        options={options}
        value={activeTab}
        onChange={setActiveTab}
        label="Client workspace"
      />

      <div
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-testid="privacy-workspace-status"
      >
        {privacyStatus}
      </div>

      <div className={styles.workspaceStage} data-testid="client-workspace-stage">
        <div {...tabPanelProps(TAB_ID_BASE, 'findings', activeTab === 'findings')} className={panelClass('findings')}>
          {findingsPanel}
        </div>
        {hasMultipleAssessments && (
          <div {...tabPanelProps(TAB_ID_BASE, 'compare', activeTab === 'compare')} className={panelClass('compare')}>
            {renderedTabs.has('compare') ? comparePanel : (
              <div className={styles.loadingPanel} role="status">Preparing comparison…</div>
            )}
          </div>
        )}
        <div {...tabPanelProps(TAB_ID_BASE, 'details', activeTab === 'details')} className={panelClass('details')}>
          {detailsPanel}
          {renderedTabs.has('details')
            ? privacyPanel
            : activeTab === 'details'
              ? <div className={styles.loadingPanel} aria-hidden="true">Preparing privacy controls…</div>
              : null}
        </div>
      </div>
    </>
  )
})

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
  const operationMode: OperationMode = ownsInitialData
    ? initialData.operationMode ?? 'governed'
    : 'governed'
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
  const [archiving, setArchiving] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuContainerRef = useRef<HTMLDivElement>(null)
  const menuToggleRef = useRef<HTMLButtonElement>(null)
  // Compare selectors: older = "before", newer = "after"
  const [compareBaseId, setCompareBaseId] = useState<string>(initialSelection.baseId)
  const [compareTargetId, setCompareTargetId] = useState<string>(initialSelection.targetId)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [consentStatus, setConsentStatus] = useState<
    'checking' | 'valid' | 'missing' | 'withdrawn' | 'reconsent_required' | 'unavailable' | 'not_required'
  >(() => ownsInitialData ? initialData.consentStatus : 'checking')

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
          // Identity, bounded history, and the mutable legal-consent decision
          // were resolved together on the server. Avoid a post-hydration fetch
          // and parent rerender that can collide with the first workspace click
          // on a throttled device.
          setHistoryLoadedForId(id)
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

  // The overflow menu is a disclosure, not an ARIA menu: it holds two links to
  // other routes. Escape and an outside click close it so it cannot be left
  // hanging over the trend card.
  //
  // Next.js App Router hydrates the React root onto `document` itself, so
  // this listener and React's own delegated pointerdown dispatch both live on
  // the same node. A child's `event.stopPropagation()` only blocks
  // propagation to *other* nodes, not other listeners already registered on
  // the node it's called from -- so it cannot stop this handler from firing.
  // Check containment via a ref instead of relying on propagation order.
  useEffect(() => {
    if (!menuOpen) return
    function close(event: Event) {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return
        // Containment does not apply here: for a keydown, event.target is
        // whatever has focus, which is normally a menu item itself (that's
        // the whole point of tabbing in). Gating Escape on containment would
        // make it close everything except the one place a keyboard user is
        // standing when they press it.
        setMenuOpen(false)
        menuToggleRef.current?.focus()
        return
      }
      if (
        event.target instanceof Node &&
        menuContainerRef.current?.contains(event.target)
      ) {
        return
      }
      setMenuOpen(false)
    }
    document.addEventListener('keydown', close)
    document.addEventListener('pointerdown', close)
    return () => {
      document.removeEventListener('keydown', close)
      document.removeEventListener('pointerdown', close)
    }
  }, [menuOpen])

  const { trendPoints, findingsAssessments } = useMemo(() => {
    const segmented = segmentTrendHistory(assessments.map((assessment) => ({
      ...assessment,
      assessmentId: assessment.id,
      scoringEngineVersion: assessment.scoring_engine_version,
    })))

    return {
      trendPoints: segmented.points.map(({ value: assessment, segmentId }) => ({
        id: assessment.id,
        assessedAt: assessment.assessed_at,
        score: toNum(assessment.overall_score),
        grade: assessment.overall_grade,
        scoringEngineVersion: assessment.scoring_engine_version,
        segmentId,
      })),
      findingsAssessments: segmented.points.map(({ value: assessment, segmentId }) => ({
        id: assessment.id,
        assessedAt: assessment.assessed_at,
        scoringEngineVersion: assessment.scoring_engine_version,
        segmentId,
        findings: (assessment.assessment_findings || []).map((finding) => ({
          key: finding.imbalance_key,
          label: finding.label,
          severityPct: finding.severity_pct,
          zone: finding.zone,
          unit: finding.unit,
        })),
      })),
    }
  }, [assessments])

  const historyRows = useMemo(() => buildHistoryRows(assessments.map((assessment) => ({
    id: assessment.id,
    assessedAt: assessment.assessed_at,
    overallGrade: assessment.overall_grade,
    overallScore: toNum(assessment.overall_score),
    scoringEngineVersion: assessment.scoring_engine_version,
  }))), [assessments])

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
      <div className="app-screen">
        <div className="app-screen-x" style={{ paddingTop: 24 }}>
          <div className={styles.loadingPanel} role="status">Loading client record…</div>
        </div>
      </div>
    )
  }

  if (!client) return null

  const dob = client.date_of_birth
    ? new Date(client.date_of_birth).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
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
  const latestAssessment = assessments.at(-1)
  const latestBand = bandFromGrade(latestAssessment?.overall_grade)

  const trackingSpanDays = assessments.length >= 2
    ? Math.max(0, Math.round(
      (Date.parse(assessments[assessments.length - 1].assessed_at) - Date.parse(assessments[0].assessed_at))
      / (24 * 60 * 60 * 1000),
    ))
    : null

  // State only, no date. The one date available here is clients.consent_recorded_at,
  // which is not the record the legal-consent decision is made from — showing it
  // beside "Consent active" would attribute the decision to the wrong evidence.
  const consentSummary = operationMode === 'prototype'
    ? { text: 'Prototype operation', band: 'neutral' as const, icon: 'shield-check-linear' as const }
    : consentStatus === 'checking'
    ? { text: 'Checking consent', band: 'neutral' as const, icon: 'clock-circle-linear' as const }
    : consentStatus === 'valid'
      ? { text: 'Consent active', band: 'maintain' as const, icon: 'shield-check-linear' as const }
      : consentStatus === 'unavailable'
        ? { text: 'Consent status unavailable', band: 'review' as const, icon: 'close-circle-linear' as const }
        : consentStatus === 'withdrawn'
          ? { text: 'Consent withdrawn', band: 'review' as const, icon: 'close-circle-linear' as const }
          : consentStatus === 'reconsent_required'
            ? { text: 'New consent required', band: 'monitor' as const, icon: 'flag-linear' as const }
            : { text: 'Consent not recorded', band: 'monitor' as const, icon: 'flag-linear' as const }

  const scanCountLabel = assessments.length === 0
    ? 'No scans'
    : `${assessments.length}${nextAssessmentCursor ? '+' : ''} ${assessments.length === 1 ? 'scan' : 'scans'}`

  return (
    <div className="app-screen">
      <div className={styles.topBar}>
        <Link href="/clients" className={styles.back}>
          <Icon name="alt-arrow-left-linear" size={18} />
          Clients
        </Link>
        <div style={{ position: 'relative' }} ref={menuContainerRef}>
          <button
            type="button"
            ref={menuToggleRef}
            className={styles.iconButton}
            aria-expanded={menuOpen}
            aria-label="Client record actions"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true"><Icon name="menu-dots-linear" size={18} /></span>
          </button>
          {menuOpen ? (
            <div className={styles.menu} onPointerDown={(event) => event.stopPropagation()}>
              <Link href={`/clients/${client.id}/edit`} className={styles.menuItem}>
                <Icon name="pen-linear" size={16} />
                Edit client
              </Link>
              <button
                type="button"
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                onClick={() => { setMenuOpen(false); setShowArchiveConfirm(true) }}
              >
                <Icon name="close-circle-linear" size={16} />
                Archive client
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <section className={styles.identity}>
        <div className={styles.identityBody}>
          <h1 className="t-headline">{client.first_name} {client.last_name}</h1>
          <p className={styles.identityMeta}>
            <span className={styles.consentIcon} style={{ color: tone(consentSummary.band) }}>
              <Icon name={consentSummary.icon} size={14} />
            </span>
            {consentSummary.text}
            {' · '}
            <span className="n">{scanCountLabel}</span>
            {trackingSpanDays === null ? null : <>{' · '}<span className="n">{nextAssessmentCursor ? '≥ ' : ''}{trackingSpanDays} days</span></>}
          </p>
        </div>
        {latestAssessment ? (
          <span
            className={styles.gradeTile}
            style={{
              background: tint(latestBand),
              boxShadow: `inset 0 0 0 1px ${ring(latestBand)}`,
              color: tone(latestBand),
            }}
            aria-label={`Latest grade ${latestAssessment.overall_grade ?? 'not graded'}`}
          >
            {latestAssessment.overall_grade ?? '—'}
          </span>
        ) : null}
      </section>

      <div className="app-screen-x app-stack">
        {loadError ? (
          <Surface tier="tile">
            <p className={`${styles.notice} ${styles.errorNotice}`} role="alert">
              <Icon name="close-circle-linear" size={16} />
              {loadError}
            </p>
          </Surface>
        ) : null}

        {operationMode === 'governed' && consentStatus === 'missing' && (
          <>
            <InPersonConsentForm
              clientId={client.id}
              subjectName={`${client.first_name} ${client.last_name}`}
              onRecorded={handleConsentRecorded}
            />
            <RemoteConsentButton clientId={client.id} />
          </>
        )}

        <TrendChart history={trendPoints} tableId="client-score-table" />

        <div className={styles.actionPair}>
          <Link href={`/assessments/new?client_id=${client.id}`} className="a-primary">
            <Icon name="scanner-linear" size={18} />
            New scan
          </Link>
          <Link href="#client-workspace" className="a-secondary">
            <Icon name="square-transfer-horizontal-linear" size={18} />
            Compare
          </Link>
        </div>

        <div className={styles.sectionHead}>
          <h2 className="t-headline-sm">Scan history</h2>
          {nextAssessmentCursor ? <span className="t-quiet">latest {assessments.length}</span> : null}
        </div>

        {historyLoadedForId !== id ? (
          <div className={styles.loadingPanel} role="status">Loading assessment history…</div>
        ) : historyRows.length === 0 ? (
          <Surface tier="tile">
            <p className="t-body">No scans yet.</p>
            <p className="t-quiet" style={{ marginTop: 4 }}>
              Capture one to establish this client&apos;s baseline.
            </p>
          </Surface>
        ) : (
          <>
            {historyRows.map((row) => (
              <SurfaceLink key={row.id} href={row.href} tier="row" prefetch={false}>
                <span className={styles.historyRow}>
                  <GradeChip grade={row.grade} />
                  <span className={styles.historyBody}>
                    <span className={styles.historyDate} style={{ display: 'block' }}>{row.dateLabel}</span>
                    <span className={styles.historyMeta} style={{ display: 'block' }}>{row.meta}</span>
                  </span>
                  <span className={`${styles.historyDelta} n`} style={{ color: tone(row.deltaBand) }}>
                    {row.deltaIcon ? <Icon name={row.deltaIcon} size={13} /> : null}
                    {row.delta ?? row.deltaWord}
                  </span>
                </span>
              </SurfaceLink>
            ))}
            {historyPageError && (
              <p className={`${styles.notice} ${styles.errorNotice}`} role="alert">{historyPageError}</p>
            )}
            {nextAssessmentCursor && (
              <button
                type="button"
                onClick={loadMoreAssessments}
                disabled={loadingMoreAssessments}
                className="a-secondary a-secondary--bar"
                style={{ minHeight: 44 }}
              >
                {loadingMoreAssessments ? 'Loading older assessments…' : 'Load older assessments'}
              </button>
            )}
          </>
        )}

        <div id="client-workspace" className={styles.sectionHead} style={{ paddingTop: 16 }}>
          <h2 className="t-headline-sm">Detail</h2>
        </div>

        <ClientWorkspace
          hasMultipleAssessments={hasMultipleAssessments}
          findingsPanel={(
            <RetainedFindingsTrend assessments={findingsAssessments} />
          )}
          comparePanel={(
            <>
              {nextAssessmentCursor && (
                <p className={styles.loadingPanel} role="status" style={{ marginBottom: 12 }}>
                  Comparing the latest {assessments.length} assessments. Load older assessments above
                  for earlier options.
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
          )}
          detailsPanel={(
            <Surface tier="tile">
              <h2 className="t-title" style={{ marginBottom: 14 }}>Client Information</h2>
              <div className={styles.factGrid}>
                {dob && (
                  <div>
                    <p className={styles.factLabel}>Date of birth</p>
                    <p className={styles.factValue}>{dob}</p>
                  </div>
                )}
                {client.sex_at_birth && (
                  <div>
                    <p className={styles.factLabel}>Sex at birth</p>
                    <p className={styles.factValue} style={{ textTransform: 'capitalize' }}>
                      {client.sex_at_birth.replace('_', ' ')}
                    </p>
                  </div>
                )}
                {client.height_cm && (
                  <div>
                    <p className={styles.factLabel}>Height</p>
                    <p className={`${styles.factValue} n`}>
                      {round1(cmToInches(client.height_cm))} in{' '}
                      <span className={styles.unitAlt}>({client.height_cm} cm)</span>
                    </p>
                  </div>
                )}
                {client.weight_kg && (
                  <div>
                    <p className={styles.factLabel}>Weight</p>
                    <p className={`${styles.factValue} n`}>
                      {round1(kgToPounds(client.weight_kg))} lb{' '}
                      <span className={styles.unitAlt}>({client.weight_kg} kg)</span>
                    </p>
                  </div>
                )}
                <div>
                  <p className={styles.factLabel}>Added</p>
                  <p className={`${styles.factValue} n`}>
                    {new Date(client.created_at).toLocaleDateString('en-GB', {
                      year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
                    })}
                  </p>
                </div>
                {consentStatus !== 'checking' && (
                  <div>
                    <p className={styles.factLabel}>{operationMode === 'prototype' ? 'Operation' : 'Consent'}</p>
                    <p className={styles.factValue} style={{ color: tone(consentSummary.band) }}>
                      {consentSummary.text}
                    </p>
                  </div>
                )}
              </div>
              {client.notes && (
                <div className={styles.notes}>
                  <p className={styles.factLabel}>Notes</p>
                  <p className={styles.notesBody}>{client.notes}</p>
                </div>
              )}
            </Surface>
          )}
          privacyPanel={operationMode === 'prototype' ? (
            <Surface tier="tile">
              <p className="t-body">Workout sharing and consent controls are off for prototype records.</p>
            </Surface>
          ) : (
            <div style={{ marginTop: 12 }}>
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
        />
      </div>

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
          Archiving <strong>{client.first_name} {client.last_name}</strong> will
          remove them from your active client list. Their data will be preserved and can be recovered.
        </ConfirmDialog>
      )}
    </div>
  )
}

'use client'
// This bundle is referenced only after the server verifies an active HG-03 release.
import { startTransition, useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PriorityProgram from './PriorityProgram'
import ReviewDock from './ReviewDock'
import GradeRail from './GradeRail'
import ReviewEvidence from './ReviewEvidence'
import ReviewFindings from './ReviewFindings'
import { buildReviewModel } from './reviewModel'
import Icon from '@/components/array/Icon'
import { Surface } from '@/components/array/Surface'
import { TabStrip, tabPanelProps } from '@/components/array/Tabs'
import { ring, tint, tone, type SeverityBand } from '@/components/array/severity'
import styles from './AssessmentReview.module.css'
import MuscleModel3D from './MuscleModel3D'
import { saveOverridePatch } from './saveOverride'
import type { AssessmentResultsPayload } from './loadAssessmentResults'
import {
  createOverrideQueue,
  type OverridePatch,
  type OverrideSaveState,
} from './overrideQueue'
import type { Capability } from '@/lib/program/selectPriorities'
import type {
  ClinicalExerciseProjection,
  ClinicalProgramReport,
  ClinicalProjection,
} from '@/lib/program/clinicalProjection'
import { getGradeDisplayBand, usesCurrentGradeScale } from '@/lib/scoring/grade-display'
import { comparisonVersionOptionNote } from '@/lib/comparison/policy'
import { sortAssessmentsChronologically } from '@/app/clients/[id]/comparison'
import { utcCalendarLabel } from '@/lib/time/calendar'
import LegalNotice from '@/components/LegalNotice'
import {
  canonicalizePostgresTimestamp,
  comparePostgresTimestamps,
} from '@/lib/time/postgres-timestamp'

type Finding = AssessmentResultsPayload['findings'][number]
type Capture = AssessmentResultsPayload['captures'][number]
type Assessment = AssessmentResultsPayload['assessment']

const REVIEW_TAB_BASE = 'review'
const DEFERRED_PANEL_MOUNT_MS = 300

export function canonicalAssessmentTimestamp(value: string): string | null {
  return canonicalizePostgresTimestamp(value)
}

// Zone colors
// ---- Skeletal Diagram: Front View positions ----
const CATEGORY_LABELS: Record<string, string> = {
  stretch: 'Stretch',
  strengthen: 'Strengthen',
  mobility: 'Mobility',
  activation: 'Activation',
  informational: 'Info',
}
// These label exercise CATEGORIES, not severity — they must never reuse
// maintain/monitor/review, or a "mobility" exercise tinted amber would read
// as a warning. The palette is deliberately off to the side of that trio.
const CATEGORY_COLORS: Record<string, string> = {
  stretch: '#818CF8',
  strengthen: '#38BDF8',
  mobility: '#A78BFA',
  activation: '#F472B6',
  informational: 'var(--text-secondary)',
}

function ExerciseAccordionItem({ exercise }: { exercise: ClinicalExerciseProjection }) {
  const [open, setOpen] = useState(false)
  const catColor = CATEGORY_COLORS[exercise.category] ?? CATEGORY_COLORS.stretch
  const catLabel = CATEGORY_LABELS[exercise.category] ?? exercise.category

  return (
    <div
      data-testid={`exercise-item-${exercise.slug}`}
      style={{
        background: 'var(--surface-glass)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10, overflow: 'hidden', marginBottom: 8,
      }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: '100%', textAlign: 'left', background: 'none', border: 'none',
          padding: '14px 16px', cursor: 'pointer', display: 'flex',
          alignItems: 'center', gap: 10,
        }}
      >
        <span style={{
          padding: '2px 8px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700,
          background: `color-mix(in srgb, ${catColor} 13%, transparent)`, color: catColor, textTransform: 'uppercase',
          letterSpacing: '0.05em', flexShrink: 0,
        }}>{catLabel}</span>
        <span style={{ flex: 1, fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
          {exercise.name}
        </span>
        <span style={{
          color: 'var(--text-secondary)', fontSize: '0.8rem', transition: 'transform 0.2s',
          display: 'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>▾</span>
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6, margin: '12px 0 10px' }}>
            {exercise.instructions}
          </p>
          <div style={{ display: 'flex', gap: 16 }}>
            {exercise.sets > 0 && (
              <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '6px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{exercise.sets}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Sets</div>
              </div>
            )}
            {exercise.dosageType !== 'dynamic' && exercise.holdSeconds > 0 && (
              <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '6px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{exercise.holdSeconds}s</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Hold</div>
              </div>
            )}
            {exercise.reps != null && (
              <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '6px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{exercise.reps.min}–{exercise.reps.max}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Reps</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ExercisesSection({ exercises }: { exercises: ClinicalExerciseProjection[] }) {
  if (exercises.length === 0) return null

  return (
    <details
      data-testid="exercises-section"
      className={styles.disclosure}
    >
      <summary className={styles.disclosureSummary}>Browse all matched exercises <span>{exercises.length}</span></summary>
      <div className={styles.disclosureBody}>
        {exercises.map(ex => (
          <ExerciseAccordionItem key={ex.slug} exercise={ex} />
        ))}
      </div>
    </details>
  )
}

// ---- Main Results Page ----
/**
 * A previously approved scan of the same client. `overall_score` and the findings
 * are what let the grade rail draw the previous reading and each finding row show
 * a real movement — both already served by the assessments endpoint.
 */
type PriorAssessment = {
  id: string
  assessed_at: string
  overall_grade: string
  overall_score: number | null
  scoring_engine_version: string | null
  assessment_findings?: Array<{
    imbalance_key: string
    severity_pct: number
    zone: 'maintain' | 'warning' | 'danger' | 'unreliable'
    unit: string | null
  }>
}

export default function ClinicalAssessmentResults({
  params,
  initialAssessmentId,
  initialData,
}: {
  params: Promise<{ id: string }>
  initialAssessmentId?: string
  initialData?: AssessmentResultsPayload
}) {
  const router = useRouter()
  const initialProjection = initialData?.clinical_content.enabled === true
    ? initialData.clinical_content.projection
    : null
  const hasInitialReport = Boolean(initialData && initialProjection?.program)
  const initialCapability = initialData?.assessment.capability
  const [assessment, setAssessment] = useState<Assessment | null>(
    hasInitialReport ? initialData!.assessment : null,
  )
  const [findings, setFindings] = useState<Finding[]>(
    hasInitialReport ? initialData!.findings : [],
  )
  const [captures, setCaptures] = useState<Capture[]>(
    hasInitialReport ? initialData!.captures : [],
  )
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState<string | null>(
    initialData && !hasInitialReport
      ? 'Clinical content is not available for this release.'
      : null,
  )
  const [resolvedAssessmentId, setResolvedAssessmentId] = useState<string>('')
  const assessmentId = initialAssessmentId ?? resolvedAssessmentId
  const [pdfLoading, setPdfLoading] = useState<'practitioner' | 'client' | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfKind, setPdfKind] = useState<'practitioner' | 'client'>('practitioner')
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)
  const [approving, setApproving] = useState(false)
  // Prior scans carry their score and findings so the grade rail can draw the
  // previous reading and each finding row can show a real movement. Both come
  // from the existing endpoint; nothing here is derived from the current scan.
  const [priorAssessments, setPriorAssessments] = useState<Array<PriorAssessment>>([])
  const [nextPriorCursor, setNextPriorCursor] = useState<string | null>(null)
  const [loadingMorePriors, setLoadingMorePriors] = useState(false)
  const priorRequestVersion = useRef(0)
  const loadMorePriorController = useRef<AbortController | null>(null)
  const [compareToId, setCompareToId] = useState<string>('')
  const [auxError, setAuxError] = useState<string | null>(null)
  const [capability, setCapability] = useState<Capability>(
    initialCapability === 'regression' || initialCapability === 'progression'
      ? initialCapability
      : 'standard',
  )
  const [swaps, setSwaps] = useState<Record<string, Record<string, string>>>(
    initialData?.assessment.exercise_swaps && typeof initialData.assessment.exercise_swaps === 'object'
      ? initialData.assessment.exercise_swaps
      : {},
  )
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [overrideError, setOverrideError] = useState<string | null>(null)
  const [overrideSaveState, setOverrideSaveState] = useState<OverrideSaveState>('idle')
  const [runList, setRunList] = useState<Array<{ session_id: string; created_at: string; status: string; red_flag_acknowledged: boolean | null; completed_at: string | null }>>([])
  const [program, setProgram] = useState<ClinicalProgramReport | null>(
    initialProjection?.program ?? null,
  )
  const [exercises, setExercises] = useState<ClinicalExerciseProjection[]>(
    initialProjection?.exercises ?? [],
  )
  const [sessionPreview, setSessionPreview] = useState<ClinicalProjection['sessionPreview']>(
    initialProjection?.sessionPreview ?? null,
  )

  const overrideQueue = useMemo(() => assessmentId ? createOverrideQueue(
    (patch) => saveOverridePatch(assessmentId, patch),
    (state) => {
      setOverrideSaveState(state)
      setOverrideError(state === 'failed'
        ? 'Program changes were not saved. Retry the save before approving, exporting, sharing, or launching.'
        : null)
    },
  ) : null, [assessmentId])

  useEffect(() => {
    if (initialAssessmentId) return
    params.then(p => setResolvedAssessmentId(p.id))
  }, [initialAssessmentId, params])

  useEffect(() => {
    if (!assessmentId) return
    const version = ++priorRequestVersion.current
    loadMorePriorController.current?.abort()
    loadMorePriorController.current = null
    // Abort a stale in-flight load when the id changes / the page unmounts, so a
    // slower earlier response can't paint the wrong assessment's data.
    const ac = new AbortController()
    async function load() {
      setPriorAssessments([])
      setNextPriorCursor(null)
      setCompareToId('')
      setAuxError(null)
      setLoadingMorePriors(false)
      try {
        let data: AssessmentResultsPayload
        if (initialData && assessmentId === initialAssessmentId) {
          data = initialData
        } else {
          const r = await fetch('/api/assessments/' + assessmentId, { signal: ac.signal })
          if (!r.ok) {
            if (r.status === 401) { router.push('/auth/sign-in'); return }
            setError('Assessment not found.')
            setLoading(false)
            return
          }
          data = await r.json() as AssessmentResultsPayload
        }
        const projection = data.clinical_content?.projection as ClinicalProjection | null | undefined
        if (data.clinical_content?.enabled !== true || !projection?.program) {
          setError('Clinical content is not available for this release.')
          setLoading(false)
          return
        }
        setAssessment(data.assessment)
        setFindings(data.findings || [])
        setCaptures(data.captures || [])
        setProgram(projection.program)
        setExercises(Array.isArray(projection.exercises) ? projection.exercises : [])
        setSessionPreview(projection.sessionPreview ?? null)
        // Hydrate persisted coach overrides.
        const cap = data.assessment?.capability
        if (cap === 'regression' || cap === 'standard' || cap === 'progression') setCapability(cap)
        setSwaps(data.assessment?.exercise_swaps && typeof data.assessment.exercise_swaps === 'object' ? data.assessment.exercise_swaps : {})
        // The primary review is complete at this point. Paint it while the
        // optional prior-report picker continues loading; ReviewDock exposes
        // that selector only after prior options arrive, so comparisons remain
        // unavailable until their authoritative data is ready.
        setLoading(false)
        if (data.assessment?.clients?.id) {
          const clientId = data.assessment.clients.id
          const beforeAt = canonicalAssessmentTimestamp(data.assessment.assessed_at)
          if (!beforeAt) {
            setAuxError('Some report options could not load (invalid assessment date). Refresh to try again.')
            return
          }
          const priorQuery = new URLSearchParams({
            exclude: assessmentId,
            approved_only: 'true',
            before_at: beforeAt,
            limit: '50',
            include_findings: 'true',
          })
          try {
            const priorRes = await fetch(`/api/clients/${encodeURIComponent(clientId)}/assessments?${priorQuery.toString()}`, { signal: ac.signal })
            if (priorRes.ok) {
              const priorData = await priorRes.json()
              if (version === priorRequestVersion.current) {
                setPriorAssessments(sortAssessmentsChronologically(priorData.assessments || []))
                setNextPriorCursor(priorData.pagination?.has_more ? priorData.pagination.next_cursor ?? null : null)
              }
            } else if (version === priorRequestVersion.current) {
              setAuxError('Some report options could not load (prior assessments). Refresh to try again.')
            }
          } catch (priorError) {
            if ((priorError as Error)?.name === 'AbortError') return
            if (version === priorRequestVersion.current) {
              setAuxError('Some report options could not load (prior assessments). Refresh to try again.')
            }
          }
        }
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return
        setError('Failed to load assessment.')
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => {
      ac.abort()
      loadMorePriorController.current?.abort()
    }
  }, [assessmentId, initialAssessmentId, initialData, router])

  async function loadMorePriorAssessments() {
    const clientId = assessment?.clients?.id
    if (!clientId || !assessmentId || !nextPriorCursor || loadingMorePriors) return
    const beforeAt = canonicalAssessmentTimestamp(assessment.assessed_at)
    if (!beforeAt) {
      setAuxError('Some older report options could not load (invalid assessment date). Refresh to try again.')
      return
    }
    const version = priorRequestVersion.current
    loadMorePriorController.current?.abort()
    const controller = new AbortController()
    loadMorePriorController.current = controller
    setLoadingMorePriors(true)
    setAuxError(null)
    try {
      const query = new URLSearchParams({
        exclude: assessmentId,
        approved_only: 'true',
        before_at: beforeAt,
        limit: '50',
        cursor: nextPriorCursor,
        include_findings: 'true',
      })
      const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/assessments?${query.toString()}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Failed to load prior assessments (${response.status})`)
      const body = await response.json() as {
        assessments?: Array<PriorAssessment>
        pagination?: { has_more?: boolean; next_cursor?: string | null }
      }
      if (controller.signal.aborted || version !== priorRequestVersion.current) return
      setPriorAssessments((current) => {
        const byId = new Map(current.map((prior) => [prior.id, prior]))
        for (const prior of body.assessments ?? []) byId.set(prior.id, prior)
        return sortAssessmentsChronologically([...byId.values()])
      })
      setNextPriorCursor(body.pagination?.has_more ? body.pagination.next_cursor ?? null : null)
    } catch (caught) {
      if ((caught as Error)?.name !== 'AbortError' && version === priorRequestVersion.current) {
        setAuxError('Some older report options could not load. Try again.')
      }
    } finally {
      if (loadMorePriorController.current === controller) {
        loadMorePriorController.current = null
        setLoadingMorePriors(false)
      }
    }
  }

  // Practitioner-facing session-run list (with pain-check status). Refetched on
  // mount; a launched session remounts this page on return from the player.
  useEffect(() => {
    if (!assessmentId) return
    const ac = new AbortController()
    fetch(`/api/workouts?assessment_id=${assessmentId}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : { runs: [] }))
      .then((d) => setRunList(d.runs ?? []))
      .catch(() => {})
    return () => ac.abort()
  }, [assessmentId])

  const unreliableFindings = useMemo(
    () => findings.filter(f => f.zone === 'unreliable').map(f => ({ label: f.label })),
    [findings]
  )

  async function refreshClinicalProjection() {
    if (!assessmentId) return false
    const response = await fetch(`/api/assessments/${assessmentId}`, { cache: 'no-store' })
    if (!response.ok) return false
    const data = await response.json()
    const projection = data.clinical_content?.projection as ClinicalProjection | null | undefined
    if (data.clinical_content?.enabled !== true || !projection?.program) return false
    setAssessment(data.assessment)
    setFindings(data.findings || [])
    setCaptures(data.captures || [])
    setProgram(projection.program)
    setExercises(Array.isArray(projection.exercises) ? projection.exercises : [])
    setSessionPreview(projection.sessionPreview ?? null)
    const cap = data.assessment?.capability
    if (cap === 'regression' || cap === 'standard' || cap === 'progression') setCapability(cap)
    setSwaps(data.assessment?.exercise_swaps && typeof data.assessment.exercise_swaps === 'object'
      ? data.assessment.exercise_swaps
      : {})
    return true
  }

  // Persist coach overrides so the client PDF regenerates identically. fetch does
  // NOT reject on 4xx/5xx, so a failed save must be detected via the returned ok flag
  // and surfaced — otherwise the optimistic UI (and the PDF rebuilt from the persisted
  // row) silently diverges from the DB with no signal to the practitioner.
  function persistOverrides(patch: OverridePatch) {
    const queue = overrideQueue
    if (!queue) return
    void queue.enqueue(patch).then(async (saved) => {
      if (!saved || !(await queue.waitForSettled())) return
      if (!(await refreshClinicalProjection())) {
        setOverrideError('Program changes were saved, but the reviewed projection could not be refreshed. Reload before continuing.')
      }
    })
  }

  async function waitForOverrides() {
    if (!overrideQueue) {
      setOverrideError('Program changes cannot be verified yet. Refresh and try again.')
      return false
    }
    const didSave = await overrideQueue.waitForSettled()
    if (!didSave) {
      setOverrideError('Program changes were not saved. Retry the save before approving, exporting, sharing, or launching.')
    }
    return didSave
  }

  async function retryOverrides() {
    if (!overrideQueue) return
    if (await overrideQueue.retryFailed()) await refreshClinicalProjection()
  }

  function handleCapabilityChange(c: Capability) {
    setCapability(c)
    persistOverrides({ capability: c })
  }
  function handleDemote(primaryKey: string) {
    if (!program) return
    const next = program.priorities.map(p => p.primaryKey).filter(k => k !== primaryKey)
    persistOverrides({ priority_keys: next })
  }
  function handlePromote(primaryKey: string) {
    if (!program) return
    const order = program.eligibleOrder
    const next = [...program.priorities.map(p => p.primaryKey), primaryKey]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .slice(0, 3)
    persistOverrides({ priority_keys: next })
  }
  function handleSwap(primaryKey: string, baseSlug: string, toSlug: string | null) {
    const nextForPriority = { ...(swaps[primaryKey] ?? {}) }
    if (toSlug === null) delete nextForPriority[baseSlug]
    else nextForPriority[baseSlug] = toSlug
    const next = { ...swaps }
    if (Object.keys(nextForPriority).length === 0) delete next[primaryKey]
    else next[primaryKey] = nextForPriority
    setSwaps(next)
    persistOverrides({ exercise_swaps: next })
  }

  async function handleGeneratePdf(variant: 'practitioner' | 'client' = 'practitioner') {
    if (!assessmentId) return
    if (!(approved || assessment?.practitioner_approved)) {
      setPdfError('Approve the assessment before exporting a report.')
      return
    }
    if (!(await waitForOverrides())) return
    setPdfLoading(variant)
    setPdfError(null)
    setPdfUrl(null)
    try {
      const r = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_id: assessmentId, compared_to_assessment_id: compareToId || undefined, variant }),
      })
      if (!r.ok) {
        const err = await r.json()
        setPdfError(err.error || 'PDF generation failed')
        return
      }
      const data = await r.json()
      setPdfKind(variant)
      setPdfUrl(data.signed_url)
    } catch {
      setPdfError('Failed to generate PDF.')
    } finally {
      setPdfLoading(null)
    }
  }

  async function handleApprove() {
    if (!assessmentId) return
    if (!(await waitForOverrides())) return
    setApproving(true)
    try {
      const r = await fetch(`/api/assessments/${assessmentId}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      })
      if (r.ok) { setApproved(true); setPdfError(null) }
      else { const e = await r.json().catch(() => ({})); setPdfError(e.error || 'Failed to approve.') }
    } catch {
      setPdfError('Failed to approve.')
    } finally {
      setApproving(false)
    }
  }

  // Mint a guided session from this approved assessment and open the player
  // (in-clinic, same device). The frozen snapshot is generated server-side.
  async function handleLaunch() {
    if (!assessmentId || launching) return
    if (!(await waitForOverrides())) return
    setLaunching(true)
    setLaunchError(null)
    try {
      const r = await fetch('/api/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_id: assessmentId }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setLaunchError(data.error || 'Could not start the session.')
        setLaunching(false)
        return
      }
      if (!data.session_id) {
        setLaunchError('Could not start the session.')
        setLaunching(false)
        return
      }
      router.push(`/workouts/${data.session_id}`)
    } catch {
      setLaunchError('Could not start the session.')
      setLaunching(false)
    }
  }

  // Mint an expiring, hashed public share link so the client can follow the same
  // guided session from their own device (O5). The raw token lives only in the
  // returned URL — never stored — so this is the one moment it exists to copy.
  async function handleShare() {
    if (!assessmentId || sharing) return
    if (!(await waitForOverrides())) return
    setSharing(true)
    setShareError(null)
    setCopied(false)
    try {
      const r = await fetch('/api/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment_id: assessmentId, share: true }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data.share_link) {
        setShareError(data.error || 'Could not create a share link.')
        setSharing(false)
        return
      }
      setShareLink(data.share_link)
      setSharing(false)
    } catch {
      setShareError('Could not create a share link.')
      setSharing(false)
    }
  }

  async function copyShareLink() {
    if (!shareLink) return
    try {
      await navigator.clipboard.writeText(shareLink)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  if (loading) {
    return (
      <div className={styles.routeState} role="status">
        <div>
          <div className={styles.spinner} />
          <p style={{ color: 'var(--text-secondary)' }}>Loading results...</p>
        </div>
      </div>
    )
  }

  if (error || !assessment || !program) {
    return (
      <div className={styles.routeState}>
        <div>
          <p role="alert" style={{ color: 'var(--review)', marginBottom: 16 }}>{error || 'Assessment not found.'}</p>
          <Link href="/clients" className={styles.errorLink}>Back to Clients</Link>
        </div>
      </div>
    )
  }

  const grade = assessment.overall_grade
  const score = assessment.overall_score
  const showCurrentGradeScale = usesCurrentGradeScale(assessment.scoring_engine_version)
  const gradeDesc = showCurrentGradeScale
    ? getGradeDisplayBand(grade).description
    : 'Recorded screening grade'
  const isApproved = approved || !!assessment.practitioner_approved
  const clientName = assessment.clients.first_name + ' ' + assessment.clients.last_name
  const rollNotes = captures
    .filter(c => typeof c.capture_roll_deg === 'number' && Math.abs(c.capture_roll_deg) >= 0.05)
    .map(c => `${c.view} ${c.capture_roll_deg! > 0 ? '+' : '−'}${Math.abs(c.capture_roll_deg!).toFixed(1)}°`)
  const assessedAtLabel = utcCalendarLabel(assessment.assessed_at, 'long')
  const reliabilityLabel = assessment.level_verified === true
    ? 'Camera level verified'
    : assessment.level_verified === false
      ? 'Camera level not verified'
      : 'Camera level unavailable'
  const reliabilityDetailParts = [
    typeof assessment.capture_stability === 'number'
      ? `Within-burst landmark consistency ${Math.round(assessment.capture_stability * 100)}%`
      : null,
    assessment.tilt_corrected && rollNotes.length > 0
      ? `Tilt corrected: ${rollNotes.join(', ')}`
      : null,
  ].filter((part): part is string => part !== null)
  const comparisonOptions = priorAssessments
    .filter((prior) => comparePostgresTimestamps(prior.assessed_at, assessment.assessed_at) === -1)
    .map((prior) => ({
    id: prior.id,
    label: `${utcCalendarLabel(prior.assessed_at, 'numeric')} — Grade ${prior.overall_grade}${comparisonVersionOptionNote(
      assessment.scoring_engine_version,
      prior.scoring_engine_version,
    )}`,
    }))
  const assessedAtShort = utcCalendarLabel(assessment.assessed_at, 'short')
  // Chronological order, so the last entry is the scan immediately behind this one.
  const mostRecentPrior = priorAssessments.length > 0
    ? priorAssessments[priorAssessments.length - 1]
    : null

  const reviewModel = buildReviewModel({
    assessment: {
      overall_score: score,
      overall_grade: grade,
      scoring_engine_version: assessment.scoring_engine_version,
      assessed_at: assessment.assessed_at,
    },
    findings,
    // The most recent prior scan. priorAssessments is chronological, so the last
    // entry is the nearest one behind this scan; the shared comparison policy
    // decides on its own whether the pair is comparable at all.
    prior: mostRecentPrior
      ? {
        overall_score: mostRecentPrior.overall_score,
        scoring_engine_version: mostRecentPrior.scoring_engine_version,
        assessed_at: mostRecentPrior.assessed_at,
        findings: mostRecentPrior.assessment_findings ?? [],
      }
      : null,
    scanLabel: `Screening · ${assessedAtShort}`,
    priorLabel: mostRecentPrior ? utcCalendarLabel(mostRecentPrior.assessed_at, 'short') : null,
  })

  return (
    <div className="app-screen app-screen--bar">
      <div className={styles.topBar}>
        <Link className={styles.back} href={`/clients/${assessment.clients.id}`}>
          <Icon name="alt-arrow-left-linear" size={18} />
          {clientName}
        </Link>
        {typeof assessment.level_verified === 'boolean' && (
          <span
            className={styles.verifiedChip}
            data-testid="level-badge"
            data-verified={assessment.level_verified ? 'true' : 'false'}
            style={assessment.level_verified
              ? { background: tint('maintain'), color: tone('maintain') }
              : { background: tint('monitor'), color: tone('monitor') }}
          >
            <Icon name={assessment.level_verified ? 'shield-check-linear' : 'flag-linear'} size={13} />
            {assessment.level_verified
              ? `${captures.length} ${captures.length === 1 ? 'view' : 'views'} verified`
              : 'Camera level not verified'}
          </span>
        )}
      </div>

      <section className={styles.verdict}>
        <p className="t-kicker" style={{ marginBottom: 12 }}>{reviewModel.verdict.kicker}</p>
        <h1 className="t-headline">
          {reviewModel.verdict.headline.lead}
          {reviewModel.verdict.headline.tail
            ? <> <em>{reviewModel.verdict.headline.tail}</em></>
            : null}
        </h1>
      </section>

      <div className="app-screen-x app-stack">
        <GradeRail rail={reviewModel.rail} scaleApplies={showCurrentGradeScale} />

        {[launchError, shareError, pdfError, auxError].filter(Boolean).map((message) => (
          <p key={message} className={`${styles.notice} ${styles.errorNotice}`} role="alert">
            <Icon name="close-circle-linear" size={16} />
            {message}
          </p>
        ))}

        <ReviewWorkspace
          findingsCount={findings.length}
          programCount={program.priorities.length}
          findingsPanel={(
            <div className="app-stack">
              <ReviewFindings rows={reviewModel.rows} />
              {reviewModel.counts.unreliable > 0 && (
                <p className={styles.scanCaption} style={{ borderTop: 0, paddingTop: 0 }}>
                  {reviewModel.counts.unreliable === 1
                    ? 'One reading was not usable and is listed last. Re-capture that view to score it.'
                    : `${reviewModel.counts.unreliable} readings were not usable and are listed last. Re-capture those views to score them.`}
                </p>
              )}
              <details className={styles.disclosure}>
                <summary className={styles.disclosureSummary}>Accuracy &amp; methodology</summary>
                <div className={styles.disclosureBody}>
                  <AccuracyCard assessment={assessment} findings={findings} />
                </div>
              </details>
              <details data-testid="disclaimer" className={styles.disclosure}>
                <summary className={styles.disclosureSummary}>Screening notice</summary>
                <div className={styles.disclosureBody}>
                  <LegalNotice kind="screening_notice" compact />
                </div>
              </details>
            </div>
          )}
          evidencePanel={(
            <div className="app-stack">
              <ReviewEvidence
                findings={findings}
                captures={captures}
                levelVerified={assessment.level_verified}
              />
              {findings.length > 0 && (
                <MuscleModel3D findings={findings} />
              )}
            </div>
          )}
          programPanel={(
            <div className="app-stack">
              {findings.length > 0 ? (
                <PriorityProgram
                  report={program}
                  unreliable={unreliableFindings}
                  capability={capability}
                  onCapabilityChange={handleCapabilityChange}
                  onDemote={handleDemote}
                  onPromote={handlePromote}
                  onSwap={handleSwap}
                />
              ) : (
                <Surface tier="tile">
                  <p className={styles.emptyState}>
                    No corrective priorities are available from this screening.
                  </p>
                </Surface>
              )}
              {overrideSaveState === 'saving' && (
                <p role="status" aria-live="polite" className={styles.notice}>Saving program changes…</p>
              )}
              {overrideError && (
                <p role="alert" aria-live="assertive" className={`${styles.notice} ${styles.errorNotice}`}>
                  {overrideError}
                </p>
              )}

              {exercises.length > 0 && (
                <details className={styles.disclosure}>
                  <summary className={styles.disclosureSummary}>
                    Matched exercises ({exercises.length})
                  </summary>
                  <div className={styles.disclosureBody}>
                    <ExercisesSection exercises={exercises} />
                  </div>
                </details>
              )}

              {sessionPreview ? (
                <Surface tier="tile">
                  <h3 className="t-title">Guided corrective session ready</h3>
                  <p className="t-body" style={{ marginTop: 4 }}>
                    {sessionPreview.itemCount} movements · about{' '}
                    {Math.max(1, Math.round(sessionPreview.estimatedDurationSec / 60))} min · full-screen coach
                  </p>
                  {!isApproved && (
                    <p className="t-quiet" style={{ marginTop: 6 }}>
                      Practitioner approval is required before launch.
                    </p>
                  )}
                  <Link
                    href={`/workouts?assessment_id=${assessmentId}`}
                    className="a-secondary"
                    style={{ display: 'inline-flex', minHeight: 42, padding: '0 16px', marginTop: 12 }}
                  >
                    Customize workout
                  </Link>
                </Surface>
              ) : (
                <Surface tier="tile">
                  <h3 className="t-title">No guided session available</h3>
                  <p className="t-body" style={{ marginTop: 4 }}>
                    There are not enough reliably measured findings. Re-capture clear front and
                    side photos to build a session.
                  </p>
                </Surface>
              )}

              {runList.length > 0 && (
                <details className={styles.disclosure}>
                  <summary className={styles.disclosureSummary}>Session runs ({runList.length})</summary>
                  <div className={styles.disclosureBody}>
                    {runList.map((run) => (
                      <p key={run.session_id + run.created_at}>
                        {utcCalendarLabel(run.created_at, 'short')} · {run.status.replace('_', ' ')} ·{' '}
                        {run.red_flag_acknowledged ? 'Pain check clear' : 'Pain check not recorded'}
                      </p>
                    ))}
                  </div>
                </details>
              )}

            </div>
          )}
        />

        {/* Deliberately collapsed. Sign-off does not live here: the pinned
            action bar below carries "Approve & send report", so this holds only
            the secondary report, share and compare controls plus the dock's own
            redundant approve. Anything driving this dock -- e2e specs, the
            performance journey -- has to open the disclosure first. */}
        <details className={styles.disclosure}>
          <summary className={styles.disclosureSummary}>Report, share &amp; compare</summary>
          <div className={styles.disclosureBody}>
            <ReviewDock
              clientName={clientName}
              assessedAtLabel={assessedAtLabel}
              grade={grade}
              score={score}
              gradeDescription={gradeDesc}
              reliabilityLabel={reliabilityLabel}
              reliabilityDetail={reliabilityDetailParts.join(' · ') || null}
              unreliableCount={unreliableFindings.length}
              isApproved={isApproved}
              saveState={overrideSaveState}
              hasSession={sessionPreview !== null}
              isApproving={approving}
              isLaunching={launching}
              onApprove={handleApprove}
              onLaunch={handleLaunch}
              onRetrySave={retryOverrides}
              pdfLoading={pdfLoading}
              pdfUrl={pdfUrl}
              pdfKind={pdfKind}
              onGeneratePdf={handleGeneratePdf}
              comparisonId={compareToId}
              comparisonOptions={comparisonOptions}
              onComparisonChange={setCompareToId}
              hasMoreComparisonOptions={nextPriorCursor !== null}
              isLoadingMoreComparisonOptions={loadingMorePriors}
              onLoadMoreComparisonOptions={loadMorePriorAssessments}
              isSharing={sharing}
              shareLink={shareLink}
              copied={copied}
              onShare={handleShare}
              onCopyShare={copyShareLink}
              backHref={`/clients/${assessment.clients.id}`}
              newAssessmentHref="/assessments/new"
            />
          </div>
        </details>
      </div>

      {/* Sign-off stays reachable from anywhere on the screen. The dock above
          still owns every other action, including its own approve control, so
          nothing here is the only route to it. */}
      <div className={styles.actionBar}>
        <div className={styles.actionBarInner}>
          <button
            type="button"
            className={styles.iconAction}
            onClick={() => handleGeneratePdf('practitioner')}
            disabled={pdfLoading !== null || overrideSaveState === 'saving'}
            aria-label="Generate practitioner PDF"
          >
            <Icon name="pen-new-square-linear" size={20} />
          </button>
          {isApproved ? (
            <button
              type="button"
              className={`a-primary a-primary--bar approve ${styles.approve}`}
              onClick={handleLaunch}
              disabled={launching || sessionPreview === null}
            >
              <Icon name="check-circle-linear" size={18} />
              {launching ? 'Launching…' : 'Launch session'}
            </button>
          ) : (
            <button
              type="button"
              className={`a-primary a-primary--bar approve ${styles.approve}`}
              onClick={handleApprove}
              disabled={approving || overrideSaveState === 'saving'}
            >
              <Icon name="check-circle-linear" size={18} />
              {approving ? 'Approving…' : 'Approve & send report'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Findings, Evidence and Program. Evidence and Program mount after the selected
 * panel has painted: the point-scan canvas and the program's override controls are
 * the two heaviest things on this route, and neither should compete with the first
 * interaction on a throttled device.
 */
type ReviewPanel = 'findings' | 'evidence' | 'program'

function ReviewWorkspace({
  findingsCount,
  programCount,
  findingsPanel,
  evidencePanel,
  programPanel,
}: {
  findingsCount: number
  programCount: number
  findingsPanel: ReactNode
  evidencePanel: ReactNode
  programPanel: ReactNode
}) {
  const [active, setActive] = useState<ReviewPanel>('findings')
  const [mounted, setMounted] = useState<ReadonlySet<ReviewPanel>>(
    () => new Set<ReviewPanel>(['findings']),
  )

  useEffect(() => {
    if (mounted.has(active)) return
    const timer = window.setTimeout(() => {
      startTransition(() => {
        setMounted((current) => {
          if (current.has(active)) return current
          const next = new Set(current)
          next.add(active)
          return next
        })
      })
    }, DEFERRED_PANEL_MOUNT_MS)
    return () => window.clearTimeout(timer)
  }, [active, mounted])

  function panelClass(panel: ReviewPanel) {
    return `${styles.workspacePanel} ${active === panel ? styles.workspacePanelActive : ''}`
  }

  return (
    <>
      <TabStrip
        idBase={REVIEW_TAB_BASE}
        options={[
          { value: 'findings', label: `Findings${findingsCount > 0 ? ` ${findingsCount}` : ''}` },
          { value: 'evidence', label: 'Evidence' },
          { value: 'program', label: `Program${programCount > 0 ? ` ${programCount}` : ''}` },
        ]}
        value={active}
        onChange={setActive}
        label="Screening result details"
      />

      <div className={styles.workspaceStage}>
        <div {...tabPanelProps(REVIEW_TAB_BASE, 'findings', active === 'findings')} className={panelClass('findings')}>
          {findingsPanel}
        </div>
        <div {...tabPanelProps(REVIEW_TAB_BASE, 'evidence', active === 'evidence')} className={panelClass('evidence')}>
          {mounted.has('evidence')
            ? evidencePanel
            : <div className={styles.loadingPanel} role="status">Preparing evidence…</div>}
        </div>
        <div {...tabPanelProps(REVIEW_TAB_BASE, 'program', active === 'program')} className={panelClass('program')}>
          {mounted.has('program')
            ? programPanel
            : <div className={styles.loadingPanel} role="status">Preparing program…</div>}
        </div>
      </div>
    </>
  )
}

// Per-finding stability, angle uncertainty, capture/level status, and the
// 2D monocular limits are shown together here.
function AccuracyCard({ assessment, findings }: { assessment: Assessment; findings: Finding[] }) {
  const withStability = findings.filter(
    f => f.zone !== 'unreliable' && (f.stability_score != null || f.uncertainty_deg != null),
  )
  const pill = (band: SeverityBand, label: string) => (
    <span style={{
      padding: '3px 10px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 700,
      background: tint(band),
      color: tone(band),
      border: `1px solid ${ring(band)}`,
    }}>{label}</span>
  )
  return (
    <div data-testid="accuracy-card" style={{ paddingTop: 24, marginTop: 24, borderTop: '1px solid var(--hairline)' }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Accuracy &amp; Methodology</h3>
      <p style={{ color: 'var(--text-tertiary)', fontSize: '0.82rem', lineHeight: 1.55, margin: '0 0 16px' }}>
        An image-based <strong style={{ color: 'var(--text-secondary)' }}>2D screening</strong> — no depth, so monocular parallax and camera tilt can affect angles. Within-burst consistency describes repeated processing inside one capture burst. Re-stance repeatability and clinical accuracy are not established.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: withStability.length ? 16 : 0 }}>
        {pill(assessment.level_verified === true ? 'maintain' : 'monitor', assessment.level_verified === true ? 'Camera level verified' : 'Level not verified')}
        {assessment.tilt_corrected ? pill('maintain', 'Tilt-corrected') : null}
        {typeof assessment.capture_stability === 'number' ? pill('neutral', `Within-burst landmark consistency ${Math.round(assessment.capture_stability * 100)}%`) : null}
      </div>
      {withStability.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {withStability.map(f => {
            const s = f.stability_score
            const stColor = tone('neutral')
            return (
              <div key={f.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12, minWidth: 0, overflowWrap: 'anywhere', padding: '9px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10 }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', flex: 1 }}>{f.label}</span>
                {f.uncertainty_deg != null && <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>Within-burst angle variation ±{f.uncertainty_deg.toFixed(1)}°</span>}
                {s != null && <span style={{ color: stColor, fontSize: '0.78rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>Within-burst landmark consistency {Math.round(s * 100)}%</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

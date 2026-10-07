'use client'

import { useState } from 'react'
import { Surface } from '@/components/array/Surface'
import {
  ProgressionReasonV1Schema,
  TrainingProgressionAcceptanceV1Schema,
  TrainingProgressionProjectionV1Schema,
  type ProgressionProposalV1,
  type TrainingProgressionProjectionV1,
} from '@/lib/training/contracts/progression'
import {
  RecoveryContextSubmissionV1Schema,
  type RecoveryContextSubmissionV1,
  type RecoveryContextV1,
} from '@/lib/training/contracts/recovery-context'
import { RecoveryContextFields } from './RecoveryContextFields'
import ActiveCalibrationPanel from './ActiveCalibrationPanel'
import ManualRecalibrationPanel from './ManualRecalibrationPanel'
import type { BodyweightAssistanceProgressionDecisionV1 } from '@/lib/training/contracts/bodyweight-assistance'
import styles from './StrengthProgramBuilder.module.css'

type Projection = TrainingProgressionProjectionV1
type ProposalResult = Extract<Projection['result'], { kind: 'proposal' }>
type NoChangeResult = Extract<Projection['result'], { kind: 'not_proposed' }>
type RecoveryReviewResult = Extract<Projection['result'], { kind: 'recovery_review' }>
type Reason = (typeof ProgressionReasonV1Schema.options)[number]

type PanelState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; projection: Projection }

type AcceptanceState =
  | { status: 'idle' }
  | { status: 'accepting' }
  | { status: 'accepted'; revision: number }
  | { status: 'stale' }
  | { status: 'forbidden' }
  | { status: 'blocked'; message: string }
  | { status: 'error'; message: string }

const reasonMessages: Record<Reason, string> = {
  acute_stop: 'The saved session requires review before another target is suggested.',
  eligibility_unanswered: 'Required training questions have not been completed.',
  eligibility_review_required: 'The current training review must be completed before changing the target.',
  eligibility_scope_unavailable: 'This program is outside the currently supported training scope.',
  eligibility_source_unavailable: 'The training review used by this program is no longer current.',
  eligibility_constraints_unavailable: 'The current training constraints cannot be applied automatically.',
  eligibility_constraints_blocked: 'The current training constraints do not allow an automatic change.',
  stale_session_review: 'This unfinished session is over 24 hours old and needs review before progression.',
  session_in_progress_hold: 'Finish and save the session before reviewing the next target.',
  session_aborted_hold: 'This session ended early, so the existing target is being kept.',
  exercise_incomplete_hold: 'The exercise was not completed, so the existing target is being kept.',
  exercise_aborted_hold: 'This exercise ended early, so the existing target is being kept.',
  sync_pending_hold: 'The latest saved results are still syncing.',
  sync_conflict_hold: 'Conflicting saved results must be resolved first.',
  adverse_symptom_hold: 'A reported symptom requires review before changing the target.',
  invalid_log_hold: 'One or more saved results could not be used for this suggestion.',
  unconfirmed_outlier_hold: 'An unusual saved result needs confirmation before changing the target.',
  effort_unknown_hold: 'Effort was not recorded clearly enough to change the target.',
  effort_too_easy_recalibration: 'The saved effort suggests the starting target should be recalibrated.',
  mixed_working_load_review: 'Working sets used different loads and need review before changing the target.',
  return_after_gap_review: 'The time since the last matching session calls for a review of the current target.',
  comparator_changed_recalibration: 'The exercise setup changed, so the starting target should be recalibrated.',
  calibration_required: 'A starting target must be accepted before progression can be suggested.',
  difficult_exposure_hold: 'The saved effort supports keeping the current target.',
  repeated_difficult_exposure_review: 'Repeated difficult sessions call for a review before changing the target.',
  insufficient_same_load_evidence_hold: 'More comparable saved sessions are needed before changing the target.',
  no_achievable_increment_within_cap: 'Available equipment does not provide a suitable next load.',
  one_rep_progression: 'The latest comparable session supports adding one rep to the target.',
  two_ceiling_successes: 'Two comparable sessions reached the current rep ceiling.',
  valid_state_hold: 'The current target is being kept for the next matching session.',
}

function loadLabel(load: ProgressionProposalV1['proposal']['load']): string {
  const entered = `${load.quantity.entered.value} ${load.quantity.entered.unit}`
  if (load.basis === 'barbell_total') return `${entered} · total on the bar`
  if (load.basis === 'dumbbell_per_hand') return `${entered} · per hand`
  if (load.basis === 'dumbbell_single_implement') return `${entered} · one dumbbell total`
  return `${entered} · machine stack`
}

const dedicatedReasonMessages: Record<BodyweightAssistanceProgressionDecisionV1['reason'], string> = {
  one_rep_progression: 'Add one rep while keeping the same load setting.',
  policy_unavailable_hold: 'A reviewed progression rule is not available for this setup.',
  benchmark_changed_recalibration: 'The exercise setup changed. Review the starting target.',
  assistance_range_recalibration: 'Review the assistance setting against this machine’s available settings.',
  incomplete_exposure_hold: 'Complete and save the exercise before changing its target.',
  adverse_symptom_review: 'A reported symptom requires review before changing the target.',
  effort_unknown_hold: 'Record effort clearly before changing the target.',
  effort_too_easy_recalibration: 'Review the starting target before changing it.',
  below_range_or_target_effort_hold: 'Keep the current target based on the saved reps and effort.',
  benchmark_ceiling_review: 'The rep ceiling was reached. Review the next starting target.',
  valid_state_hold: 'Keep the current target for the next matching session.',
}

function decisionReason(decision: ProposalResult['decision'] | NoChangeResult['decision']): string {
  return 'reasonCodes' in decision
    ? reasonMessages[decision.reasonCodes[0]]
    : dedicatedReasonMessages[decision.reason]
}

function proposedLoadLabel(decision: ProposalResult['decision']): string {
  if ('proposal' in decision) return loadLabel(decision.proposal.load)
  const load = decision.preservedLoad
  const quantity = load.loadBasis === 'bodyweight_external' ? load.externalLoad : load.assistance
  return `${quantity.entered.value} ${quantity.entered.unit} · ${load.loadBasis === 'bodyweight_external' ? 'external load added to bodyweight' : 'machine assistance'}`
}

function proposalReps(decision: ProposalResult['decision']): readonly number[] {
  return 'proposal' in decision ? decision.proposal.targetReps : decision.targetReps
}

function isPracticeResult(result: ProposalResult | NoChangeResult): boolean {
  const context = result.executionContext
    ?? ('executionContext' in result.decision ? result.decision.executionContext : undefined)
  return context?.kind === 'synthetic_simulation'
}

function noChangeHeading(kind: NoChangeResult['decision']['kind']): string {
  if (kind === 'hold') return 'Keep the current target'
  if (kind === 'recalibrate') return 'Recalibrate before changing the target'
  return 'Review before changing the target'
}

function ManualRecalibrationHandoff({ result, sessionId, exerciseInstanceId }: {
  result: NoChangeResult
  sessionId: string
  exerciseInstanceId: string
}) {
  const reason = 'reasonCodes' in result.decision ? result.decision.reasonCodes[0] : result.decision.reason
  if (result.decision.kind !== 'recalibrate' || reason !== 'effort_too_easy_recalibration') return null
  const executionContext = result.executionContext
    ?? ('executionContext' in result.decision ? result.decision.executionContext : undefined)
  if (!executionContext) return null
  return <ManualRecalibrationPanel sessionId={sessionId} exerciseInstanceId={exerciseInstanceId}
    expected={result.target} executionContext={executionContext} />
}

function freshRecoveryContext(report?: RecoveryContextV1['report']): RecoveryContextV1 {
  return {
    report: {
      schemaVersion: 'recovery-context.v1',
      capturedAt: new Date().toISOString(),
      sleep: report?.sleep ?? 'unknown',
      fatigue: report?.fatigue ?? 'unknown',
      schedule: report?.schedule ?? 'unknown',
      illness: report?.illness ?? 'unknown',
    },
  }
}

function recoveryReviewCopy(result: RecoveryReviewResult): { heading: string; body: string } {
  if (result.review.kind === 'hold') return {
    heading: 'Keep the current target',
    body: 'Your recovery report and explicit hold are saved. No training target was changed.',
  }
  if (result.review.kind === 'request_review') return {
    heading: 'Program review requested',
    body: 'Your recovery report is saved for review. No training target was changed automatically.',
  }
  return {
    heading: 'Fresh starting point requested',
    body: 'Your recovery report is saved. A fresh starting target still needs to be reviewed and accepted before anything changes.',
  }
}

function recoveryReviewMatchesSubmission(
  result: RecoveryReviewResult,
  submission: RecoveryContextSubmissionV1 | null,
  sessionId: string,
  exerciseInstanceId: string,
): boolean {
  if (result.requestBinding.sessionId !== sessionId
    || result.requestBinding.exerciseInstanceId !== exerciseInstanceId
    || result.record.context.choice !== result.review.kind) return false
  if (submission && (result.record.sourceSessionId !== sessionId
    || result.record.exerciseInstanceId !== exerciseInstanceId)) return false
  if (!submission) return JSON.stringify(result.review.report) === JSON.stringify(result.record.context.report)
  return JSON.stringify(result.record.context) === JSON.stringify(submission.context)
    && JSON.stringify(result.review.report) === JSON.stringify(submission.context.report)
}

async function readBody(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

type TrainingProgressionPanelProps = {
  sessionId: string
  exerciseInstanceId: string
}

function TrainingProgressionPanelState({
  sessionId,
  exerciseInstanceId,
}: TrainingProgressionPanelProps) {
  const [panelState, setPanelState] = useState<PanelState>({ status: 'idle' })
  const [acceptanceState, setAcceptanceState] = useState<AcceptanceState>({ status: 'idle' })
  const [acceptanceRequestId, setAcceptanceRequestId] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [recoveryContext, setRecoveryContext] = useState<RecoveryContextV1 | null>(null)
  const [pendingRecoverySubmission, setPendingRecoverySubmission] = useState<RecoveryContextSubmissionV1 | null>(null)

  async function reviewNextTarget() {
    const preservesProjection = panelState.status === 'ready'
    if (preservesProjection) setIsRefreshing(true)
    else setPanelState({ status: 'loading' })
    let recoverySubmission = pendingRecoverySubmission
    if (!recoverySubmission && recoveryContext) {
      recoverySubmission = RecoveryContextSubmissionV1Schema.parse({
        requestId: globalThis.crypto.randomUUID(),
        context: {
          ...recoveryContext,
          report: { ...recoveryContext.report, capturedAt: new Date().toISOString() },
        },
      })
      setPendingRecoverySubmission(recoverySubmission)
    }
    let responseReceived = false
    try {
      const response = await fetch('/api/training/progression/proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          exerciseInstanceId,
          ...(recoverySubmission ? { recoveryContext: recoverySubmission } : {}),
        }),
      })
      responseReceived = true
      const body = await readBody(response)
      if (response.status === 403) throw new Error('You do not have permission to review progression for this session.')
      if (response.status === 409 && body && typeof body === 'object'
        && (body as Record<string, unknown>).action === 'rebuild_program') {
        setPendingRecoverySubmission(null)
        throw new Error('Your training profile changed. Rebuild the program before reviewing another target.')
      }
      if (response.status === 409 && body && typeof body === 'object'
        && ((body as Record<string, unknown>).action === 'refresh_progression'
          || (body as Record<string, unknown>).error === 'progression_recovery_context_conflict')) {
        setPendingRecoverySubmission(null)
        throw new Error('The saved session changed. Start a new recovery report before reviewing another target.')
      }
      if (!response.ok) throw new Error('A progression suggestion could not be loaded.')
      const projection = TrainingProgressionProjectionV1Schema.safeParse(body)
      if (!projection.success) throw new Error('The progression response was invalid.')
      if (projection.data.result.kind === 'recovery_review'
        && !recoveryReviewMatchesSubmission(
          projection.data.result,
          recoverySubmission,
          sessionId,
          exerciseInstanceId,
        )) {
        throw new Error('The recovery receipt did not match this report. Retry the same report to confirm its outcome.')
      }
      setPanelState({ status: 'ready', projection: projection.data })
      setAcceptanceState({ status: 'idle' })
      setAcceptanceRequestId(null)
      setPendingRecoverySubmission(null)
    } catch (cause) {
      const message = recoverySubmission && !responseReceived
        ? 'Recovery review is not confirmed. Retry the same report to check whether it was saved.'
        : cause instanceof Error ? cause.message : 'A progression suggestion could not be loaded.'
      if (preservesProjection) setAcceptanceState({ status: 'error', message })
      else setPanelState({ status: 'error', message })
    } finally {
      setIsRefreshing(false)
    }
  }

  function startNewPerformanceReview(result: RecoveryReviewResult) {
    setRecoveryContext(freshRecoveryContext(result.record.context.report))
    setPendingRecoverySubmission(null)
    setAcceptanceState({ status: 'idle' })
    setAcceptanceRequestId(null)
    setPanelState({ status: 'idle' })
  }

  async function acceptSuggestion(result: ProposalResult) {
    if (acceptanceState.status === 'accepting') return
    const requestId = acceptanceRequestId ?? globalThis.crypto.randomUUID()
    setAcceptanceRequestId(requestId)
    setAcceptanceState({ status: 'accepting' })
    try {
      const response = await fetch(`/api/training/progression/proposals/${encodeURIComponent(result.proposalId)}/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId }),
      })
      const body = await readBody(response)
      if (response.status === 403) {
        setAcceptanceState({ status: 'forbidden' })
        return
      }
      if (response.status === 409 && body && typeof body === 'object') {
        const action = (body as Record<string, unknown>).action
        if (action === 'refresh_progression') {
          setAcceptanceState({ status: 'stale' })
          return
        }
        if (action === 'rebuild_program') {
          setAcceptanceState({
            status: 'blocked',
            message: 'Your training profile changed. Rebuild the program before accepting another target.',
          })
          return
        }
      }
      if (!response.ok) throw new Error('Acceptance is not confirmed. Retry the same request to check whether the next target was updated.')
      const acceptance = TrainingProgressionAcceptanceV1Schema.safeParse(body)
      if (
        !acceptance.success
        || acceptance.data.proposalId !== result.proposalId
        || acceptance.data.assignmentId !== result.target.assignmentId
        || acceptance.data.targetSessionId !== result.target.sessionId
        || acceptance.data.targetExerciseInstanceId !== result.target.exerciseInstanceId
        || acceptance.data.programRevisionNumber <= result.target.baseProgramRevisionNumber
      ) throw new Error('The acceptance receipt could not be verified. Retry the same request to confirm its outcome.')
      setAcceptanceState({ status: 'accepted', revision: acceptance.data.programRevisionNumber })
    } catch (cause) {
      setAcceptanceState({
        status: 'error',
        message: cause instanceof Error ? cause.message : 'Acceptance is not confirmed. Retry the same request to check whether the next target was updated.',
      })
    }
  }

  return <Surface tier="tile" innerClassName={styles.sessionPlayer}>
    <div className={styles.sessionHeader}>
      <div>
        <p className="t-overline">Next target</p>
        <h3 className="t-title-2">Progression suggestion</h3>
        <p className="t-body">Review a suggestion based on saved results from this exercise. Nothing changes until you accept it.</p>
      </div>
      {panelState.status === 'idle' || panelState.status === 'error'
        ? <button type="button" className="a-secondary" onClick={() => void reviewNextTarget()}>
            {pendingRecoverySubmission
              ? 'Retry same recovery report'
              : panelState.status === 'error' ? 'Try again' : 'Review next target'}
          </button>
        : null}
    </div>

    {panelState.status === 'idle' || panelState.status === 'error'
      ? <div className={styles.pendingPanel}>
          {recoveryContext
            ? <>
                <RecoveryContextFields
                  value={recoveryContext}
                  onChange={setRecoveryContext}
                  disabled={pendingRecoverySubmission !== null}
                />
                {pendingRecoverySubmission
                  ? <p className={styles.notice}>This exact report is waiting for confirmation. Its answers and time stay locked while you retry.</p>
                  : <button type="button" className="a-secondary" onClick={() => setRecoveryContext(null)}>Remove recovery check-in</button>}
              </>
            : <button type="button" className="a-secondary" onClick={() => setRecoveryContext(freshRecoveryContext())}>Add recovery check-in</button>}
        </div>
      : null}

    {panelState.status === 'loading' ? <p role="status">Reviewing saved results…</p> : null}
    {panelState.status === 'error' ? <p role="alert" className={styles.error}>{panelState.message}</p> : null}

    {panelState.status === 'ready' && panelState.projection.result.kind === 'no_pending_target'
      ? <div className={styles.pendingPanel}>
          <h4>No later target is waiting</h4>
          <p className="t-body">There is no pending matching strength session to update.</p>
        </div>
      : null}

    {panelState.status === 'ready' && panelState.projection.result.kind === 'recovery_review'
      ? <div className={styles.pendingPanel}>
          <p className="t-overline">Recovery check-in</p>
          <h4>{recoveryReviewCopy(panelState.projection.result).heading}</h4>
          <p>{recoveryReviewCopy(panelState.projection.result).body}</p>
          <p className={styles.notice}>No numeric load, rep, or session change is available from this review.</p>
          {panelState.projection.result.review.kind === 'new_familiarization'
            ? <ActiveCalibrationPanel sessionId={sessionId} exerciseInstanceId={exerciseInstanceId} expected={panelState.projection.result.record} />
            : null}
          <button
            type="button"
            className="a-secondary"
            onClick={() => startNewPerformanceReview(panelState.projection.result as RecoveryReviewResult)}
          >Review recorded performance with a new report</button>
        </div>
      : null}

    {panelState.status === 'ready' && (panelState.projection.result.kind === 'proposal' || panelState.projection.result.kind === 'not_proposed')
      ? <>
          {isPracticeResult(panelState.projection.result)
            ? <div className={styles.practiceBanner}>
                <strong>Practice data · Simulation</strong>
                <span>This suggestion belongs to the private sample workspace.</span>
              </div>
            : null}
          <div className={styles.pendingPanel}>
            <p className="t-overline">Next matching target</p>
            <p><time dateTime={panelState.projection.result.target.scheduledLocalDate}>{panelState.projection.result.target.scheduledLocalDate}</time></p>
            {panelState.projection.result.kind === 'proposal'
              ? <>
                  <h4>{panelState.projection.result.decision.kind === 'load_proposal' ? 'Suggested load and reps' : 'Suggested reps'}</h4>
                  <p><strong>{proposedLoadLabel(panelState.projection.result.decision)}</strong></p>
                  <p>{proposalReps(panelState.projection.result.decision).join(' / ')} reps</p>
                  <p className={styles.notice}>{decisionReason(panelState.projection.result.decision)}</p>
                </>
              : <>
                  <h4>{noChangeHeading(panelState.projection.result.decision.kind)}</h4>
                  <p>{decisionReason(panelState.projection.result.decision)}</p>
                  <p className={styles.notice}>Nothing was changed or accepted.</p>
                  <ManualRecalibrationHandoff result={panelState.projection.result}
                    sessionId={sessionId} exerciseInstanceId={exerciseInstanceId} />
                </>}
          </div>

          {panelState.projection.result.kind === 'proposal'
            ? <div className={styles.targetAcceptance}>
                <div aria-live="polite">
                  {acceptanceState.status === 'idle' ? <p>Accepting updates only this pending target.</p> : null}
                  {acceptanceState.status === 'accepted' ? <p>Suggestion accepted for the next target.</p> : null}
                  {acceptanceState.status === 'stale' ? <p role="alert" className={styles.error}>This suggestion is out of date. Your saved results remain unchanged; refresh before accepting.</p> : null}
                  {acceptanceState.status === 'forbidden' ? <p role="alert" className={styles.error}>An authorized coach must accept this suggestion. Your saved results remain unchanged.</p> : null}
                  {acceptanceState.status === 'blocked' || acceptanceState.status === 'error'
                    ? <p role="alert" className={styles.error}>{acceptanceState.message}</p>
                    : null}
                  {acceptanceState.status === 'accepting' ? <p role="status">Accepting suggestion…</p> : null}
                </div>
                {acceptanceState.status === 'stale'
                  ? <button type="button" className="a-secondary" disabled={isRefreshing} onClick={() => void reviewNextTarget()}>{isRefreshing ? 'Refreshing…' : 'Refresh suggestion'}</button>
                  : acceptanceState.status === 'idle' || acceptanceState.status === 'error'
                    ? <button type="button" className="a-primary" onClick={() => void acceptSuggestion(panelState.projection.result as ProposalResult)}>{acceptanceState.status === 'error' ? 'Retry acceptance' : 'Accept suggestion'}</button>
                    : null}
              </div>
            : null}
        </>
      : null}
  </Surface>
}

export default function TrainingProgressionPanel(props: TrainingProgressionPanelProps) {
  return <TrainingProgressionPanelState
    key={`${props.sessionId}:${props.exerciseInstanceId}`}
    {...props}
  />
}

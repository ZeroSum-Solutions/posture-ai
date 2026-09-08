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
import styles from './StrengthProgramBuilder.module.css'

type Projection = TrainingProgressionProjectionV1
type ProposalResult = Extract<Projection['result'], { kind: 'proposal' }>
type NoChangeResult = Extract<Projection['result'], { kind: 'not_proposed' }>
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
  stale_session_review: 'The saved session changed and needs a fresh review.',
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

function noChangeHeading(kind: NoChangeResult['decision']['kind']): string {
  if (kind === 'hold') return 'Keep the current target'
  if (kind === 'recalibrate') return 'Recalibrate before changing the target'
  return 'Review before changing the target'
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

  async function reviewNextTarget() {
    const preservesProjection = panelState.status === 'ready'
    if (preservesProjection) setIsRefreshing(true)
    else setPanelState({ status: 'loading' })
    try {
      const response = await fetch('/api/training/progression/proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, exerciseInstanceId }),
      })
      const body = await readBody(response)
      if (response.status === 403) throw new Error('You do not have permission to review progression for this session.')
      if (response.status === 409 && body && typeof body === 'object'
        && (body as Record<string, unknown>).action === 'rebuild_program') {
        throw new Error('Your training profile changed. Rebuild the program before reviewing another target.')
      }
      if (!response.ok) throw new Error('A progression suggestion could not be loaded.')
      const projection = TrainingProgressionProjectionV1Schema.safeParse(body)
      if (!projection.success) throw new Error('The progression response was invalid.')
      setPanelState({ status: 'ready', projection: projection.data })
      setAcceptanceState({ status: 'idle' })
      setAcceptanceRequestId(null)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'A progression suggestion could not be loaded.'
      if (preservesProjection) setAcceptanceState({ status: 'error', message })
      else setPanelState({ status: 'error', message })
    } finally {
      setIsRefreshing(false)
    }
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
      if (!response.ok) throw new Error('The suggestion was not accepted. Your saved results were not changed.')
      const acceptance = TrainingProgressionAcceptanceV1Schema.safeParse(body)
      if (
        !acceptance.success
        || acceptance.data.proposalId !== result.proposalId
        || acceptance.data.assignmentId !== result.target.assignmentId
        || acceptance.data.targetSessionId !== result.target.sessionId
        || acceptance.data.targetExerciseInstanceId !== result.target.exerciseInstanceId
        || acceptance.data.programRevisionNumber <= result.target.baseProgramRevisionNumber
      ) throw new Error('The acceptance response was invalid. Your saved results were not changed.')
      setAcceptanceState({ status: 'accepted', revision: acceptance.data.programRevisionNumber })
    } catch (cause) {
      setAcceptanceState({
        status: 'error',
        message: cause instanceof Error ? cause.message : 'The suggestion was not accepted. Your saved results were not changed.',
      })
    }
  }

  return <Surface tier="tile" innerClassName={styles.sessionPlayer}>
    <div className={styles.sessionHeader}>
      <div>
        <p className="t-kicker">Next target</p>
        <h3 className="t-headline-sm">Progression suggestion</h3>
        <p className="t-body">Review a suggestion based on saved results from this exercise. Nothing changes until you accept it.</p>
      </div>
      {panelState.status === 'idle' || panelState.status === 'error'
        ? <button type="button" className="a-secondary" onClick={() => void reviewNextTarget()}>
            {panelState.status === 'error' ? 'Try again' : 'Review next target'}
          </button>
        : null}
    </div>

    {panelState.status === 'loading' ? <p role="status">Reviewing saved results…</p> : null}
    {panelState.status === 'error' ? <p role="alert" className={styles.error}>{panelState.message}</p> : null}

    {panelState.status === 'ready' && panelState.projection.result.kind === 'no_pending_target'
      ? <div className={styles.pendingPanel}>
          <h4>No later target is waiting</h4>
          <p className="t-body">There is no pending matching strength session to update.</p>
        </div>
      : null}

    {panelState.status === 'ready' && panelState.projection.result.kind !== 'no_pending_target'
      ? <>
          {panelState.projection.result.decision.executionContext.kind === 'synthetic_simulation'
            ? <div className={styles.practiceBanner}>
                <strong>Practice data · Simulation</strong>
                <span>This suggestion belongs to the private sample workspace.</span>
              </div>
            : null}
          <div className={styles.pendingPanel}>
            <p className="t-kicker">Next matching target</p>
            <p><time dateTime={panelState.projection.result.target.scheduledLocalDate}>{panelState.projection.result.target.scheduledLocalDate}</time></p>
            {panelState.projection.result.kind === 'proposal'
              ? <>
                  <h4>{panelState.projection.result.decision.kind === 'load_proposal' ? 'Suggested load and reps' : 'Suggested reps'}</h4>
                  <p><strong>{loadLabel(panelState.projection.result.decision.proposal.load)}</strong></p>
                  <p>{panelState.projection.result.decision.proposal.targetReps.join(' / ')} reps</p>
                  <p className={styles.notice}>{reasonMessages[panelState.projection.result.decision.reasonCodes[0]]}</p>
                </>
              : <>
                  <h4>{noChangeHeading(panelState.projection.result.decision.kind)}</h4>
                  <p>{reasonMessages[panelState.projection.result.decision.reasonCodes[0]]}</p>
                  <p className={styles.notice}>Nothing was changed or accepted.</p>
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

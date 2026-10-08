'use client'

import { useState } from 'react'
import { Surface } from '@/components/array/Surface'
import { Button, Radio } from '@/components/ui'
import {
  ExerciseSwapAcceptanceV1Schema,
  ExerciseSwapProposalProjectionV1Schema,
  type ExerciseSwapLoadOptionV1,
  type ExerciseSwapProposalV1,
  type ExerciseSwapProposalProjectionV1,
} from '@/lib/training/contracts/exercise-swap'
import styles from './StrengthProgramBuilder.module.css'

type PanelState =
  | { status: 'idle' | 'loading' }
  | { status: 'forbidden' }
  | { status: 'error'; message: string }
  | { status: 'ready'; projection: ExerciseSwapProposalProjectionV1 }

type Selection = Readonly<{ proposalId: string; optionIndex: number }>
type AcceptanceEnvelope = Selection & Readonly<{ requestId: string }>
type AcceptanceState =
  | { status: 'idle' | 'accepting' }
  | { status: 'unknown'; message: string }
  | { status: 'validation_error'; message: string }
  | { status: 'forbidden' }
  | { status: 'stale'; proposalId: string }
  | { status: 'accepted'; programRevisionNumber: number }

async function readBody(response: Response): Promise<unknown> {
  return response.json().catch(() => null)
}

function loadBasisLabel(option: ExerciseSwapLoadOptionV1): string {
  if (option.loadBasis === 'barbell_total') return 'total on the bar'
  if (option.loadBasis === 'dumbbell_per_hand') return 'per hand · two dumbbells'
  if (option.loadBasis === 'dumbbell_single_implement') return 'one dumbbell total · held with two hands'
  if (option.loadBasis === 'bodyweight_external') return 'external load only · excludes body mass'
  if (option.loadBasis === 'machine_assistance') return 'machine assistance · less assistance is harder'
  return 'machine stack'
}

function exactLoadLabel(option: ExerciseSwapLoadOptionV1): string {
  return `${option.quantity.entered.value} ${option.quantity.entered.unit} · ${loadBasisLabel(option)}`
}

function sameLoad(left: ExerciseSwapLoadOptionV1, right: ExerciseSwapLoadOptionV1): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameTargets(proposal: ExerciseSwapProposalV1, actual: readonly string[]): boolean {
  return actual.length === proposal.affectedFutureSessions.length
    && actual.every((sessionId, index) => sessionId === proposal.affectedFutureSessions[index]?.sessionId)
}

export type TrainingExerciseSwapPanelProps = Readonly<{
  sessionId: string
  exerciseInstanceId: string
  onAccepted?: (assignmentId: string, programRevisionNumber: number) => void
}>

function TrainingExerciseSwapPanelState({ sessionId, exerciseInstanceId, onAccepted }: TrainingExerciseSwapPanelProps) {
  const [panel, setPanel] = useState<PanelState>({ status: 'idle' })
  const [selection, setSelection] = useState<Selection | null>(null)
  const [envelope, setEnvelope] = useState<AcceptanceEnvelope | null>(null)
  const [acceptance, setAcceptance] = useState<AcceptanceState>({ status: 'idle' })

  async function loadProposals() {
    setPanel({ status: 'loading' })
    setSelection(null)
    setEnvelope(null)
    setAcceptance({ status: 'idle' })
    try {
      const response = await fetch('/api/training/exercise-swaps/proposals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, exerciseInstanceId }),
      })
      const body = await readBody(response)
      if (response.status === 401 || response.status === 403) {
        setPanel({ status: 'forbidden' })
        return
      }
      if (!response.ok) throw new Error('Exercise alternatives could not be loaded.')
      const parsed = ExerciseSwapProposalProjectionV1Schema.safeParse(body)
      if (!parsed.success) throw new Error('The exercise alternatives response was invalid.')
      setPanel({ status: 'ready', projection: parsed.data })
    } catch (cause) {
      setPanel({
        status: 'error',
        message: cause instanceof Error ? cause.message : 'Exercise alternatives could not be loaded.',
      })
    }
  }

  function chooseLoad(proposalId: string, optionIndex: number) {
    if (acceptance.status === 'accepting' || acceptance.status === 'unknown') return
    setSelection({ proposalId, optionIndex })
    setEnvelope(null)
    setAcceptance({ status: 'idle' })
  }

  async function acceptProposal(proposal: ExerciseSwapProposalV1) {
    if (!selection || selection.proposalId !== proposal.proposalId || acceptance.status === 'accepting') return
    const pending = envelope
      && envelope.proposalId === selection.proposalId
      && envelope.optionIndex === selection.optionIndex
      ? envelope
      : { ...selection, requestId: globalThis.crypto.randomUUID() }
    setEnvelope(pending)
    setAcceptance({ status: 'accepting' })
    try {
      const response = await fetch(
        `/api/training/exercise-swaps/proposals/${encodeURIComponent(proposal.proposalId)}/accept`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            requestId: pending.requestId,
            selectedLoadOptionIndex: pending.optionIndex,
          }),
        },
      )
      const body = await readBody(response)
      if (response.status === 401 || response.status === 403) {
        setEnvelope(null)
        setAcceptance({ status: 'forbidden' })
        return
      }
      if (response.status === 409) {
        setSelection(null)
        setEnvelope(null)
        setAcceptance({ status: 'stale', proposalId: proposal.proposalId })
        return
      }
      if (response.status === 422) {
        setEnvelope(null)
        setAcceptance({
          status: 'validation_error',
          message: 'That starting target is no longer valid. Choose again or refresh alternatives.',
        })
        return
      }
      if (!response.ok) throw new Error('Save not confirmed. Retry the same acceptance before choosing another option.')
      const parsed = ExerciseSwapAcceptanceV1Schema.safeParse(body)
      const selectedLoad = proposal.loadOptions[pending.optionIndex]
      if (!parsed.success || !selectedLoad
        || parsed.data.proposalId !== proposal.proposalId
        || parsed.data.assignmentId !== proposal.assignmentId
        || parsed.data.replacementExerciseVersionId !== proposal.replacementExercise.exerciseVersionId
        || parsed.data.programRevisionNumber <= proposal.baseProgramRevisionNumber
        || !sameLoad(parsed.data.selectedLoad, selectedLoad)
        || !sameTargets(proposal, parsed.data.affectedSessionIds)) {
        throw new Error('Save not confirmed. The acceptance response did not match this proposal; retry the same acceptance.')
      }
      setEnvelope(null)
      setAcceptance({ status: 'accepted', programRevisionNumber: parsed.data.programRevisionNumber })
      onAccepted?.(parsed.data.assignmentId, parsed.data.programRevisionNumber)
    } catch (cause) {
      setAcceptance({
        status: 'unknown',
        message: cause instanceof Error
          ? cause.message
          : 'Save not confirmed. Retry the same acceptance before choosing another option.',
      })
    }
  }

  return <Surface tier="tile" innerClassName={styles.sessionPlayer}>
    <div className={styles.sessionHeader} style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0, flex: '1 1 14rem' }}>
        <p className="t-overline">Future sessions</p>
        <h3 className="t-title-2">Exercise alternatives</h3>
        <p className="t-body">Review exact authored differences and choose a new starting target. Earlier and already-started sessions remain unchanged.</p>
      </div>
      {panel.status === 'idle' || panel.status === 'error' || panel.status === 'loading'
        ? <Button
            variant="secondary"
            size="sm"
            loading={panel.status === 'loading'}
            onClick={() => void loadProposals()}
          >
            {panel.status === 'error' ? 'Try alternatives again' : 'Find alternatives'}
          </Button>
        : null}
    </div>

    {panel.status === 'loading' ? <p role="status" className="t-footnote">Loading exercise alternatives…</p> : null}
    {panel.status === 'error' ? <p role="alert" className={styles.error}>{panel.message}</p> : null}
    {panel.status === 'forbidden'
      ? <p role="status" className="t-body">Exercise alternatives are available only to the athlete or the coach who owns this program.</p>
      : null}

    {panel.status === 'ready' && panel.projection.result.kind === 'no_reviewed_alternative'
      ? <div className={styles.pendingPanel}>
          <p><strong>No reviewed alternative is available</strong></p>
          <p className="t-body">The current exercise stays in future sessions. Nothing was changed.</p>
        </div>
      : null}
    {panel.status === 'ready' && panel.projection.result.kind === 'no_future_target'
      ? <div className={styles.pendingPanel}>
          <p><strong>No future session can be changed</strong></p>
          <p className="t-body">Started and completed prescriptions remain fixed. Nothing was changed.</p>
        </div>
      : null}

    {panel.status === 'ready' && panel.projection.result.kind === 'proposals'
      ? <div style={{ display: 'grid', gap: 'var(--s-16)', minWidth: 0 }}>
          {panel.projection.result.proposals.map(proposal => {
            const selectedIndex = selection?.proposalId === proposal.proposalId ? selection.optionIndex : null
            const locked = acceptance.status === 'accepting' || acceptance.status === 'unknown' || acceptance.status === 'accepted'
            return <section key={proposal.proposalId} className={styles.pendingPanel} style={{ minWidth: 0 }}>
              <p className="t-overline">Alternative for {proposal.sourceExercise.label}</p>
              <h4 className="t-headline" style={{ margin: 0 }}>{proposal.replacementExercise.label}</h4>
              <ul className="t-body" style={{ paddingLeft: 'var(--s-20)' }}>
                {proposal.replacementExercise.differences.map((difference, index) => (
                  <li key={`${difference.kind}:${index}`}>
                    <span style={{ color: 'var(--text-1)', fontWeight: 500 }}>{difference.kind.replaceAll('_', ' ')}:</span> {difference.description}
                  </li>
                ))}
              </ul>
              <p className={styles.notice}>Changing exercise variation resets its load comparison. Choose an achievable starting target to confirm; this does not infer equivalent strength.</p>
              <fieldset disabled={locked} className={styles.fieldset} style={{ minWidth: 0 }}>
                <legend>Starting target to confirm</legend>
                {proposal.loadOptions.map(option => (
                  <Radio
                    key={option.optionIndex}
                    name={`swap-load-${proposal.proposalId}`}
                    checked={selectedIndex === option.optionIndex}
                    onChange={() => chooseLoad(proposal.proposalId, option.optionIndex)}
                    label={<span style={{ overflowWrap: 'anywhere' }}>{exactLoadLabel(option)}</span>}
                  />
                ))}
              </fieldset>
              <p className="t-footnote">{proposal.affectedFutureSessions.length} future {proposal.affectedFutureSessions.length === 1 ? 'session' : 'sessions'} will use this variation after acceptance.</p>
              {acceptance.status === 'accepted' && selection?.proposalId === proposal.proposalId
                ? <p role="status" className="t-body">Exercise swap confirmed in program revision {acceptance.programRevisionNumber}.</p>
                : null}
              {acceptance.status === 'unknown' && envelope?.proposalId === proposal.proposalId
                ? <p role="alert" className={styles.error}>{acceptance.message}</p>
                : null}
              {acceptance.status === 'validation_error' && selection?.proposalId === proposal.proposalId
                ? <p role="alert" className={styles.error}>{acceptance.message}</p>
                : null}
              {acceptance.status === 'forbidden' && selection?.proposalId === proposal.proposalId
                ? <p role="alert" className={styles.error}>You no longer have permission to accept this swap.</p>
                : null}
              {acceptance.status === 'stale' && acceptance.proposalId === proposal.proposalId
                ? <p role="alert" className={styles.error}>This proposal is out of date. Refresh alternatives before choosing again.</p>
                : null}
              {acceptance.status === 'stale' && acceptance.proposalId === proposal.proposalId
                ? <Button variant="secondary" size="sm" onClick={() => void loadProposals()}>Refresh alternatives</Button>
                : acceptance.status === 'accepted' || acceptance.status === 'forbidden' || acceptance.status === 'stale'
                  ? null
                  : <button
                      type="button"
                      className="a-primary"
                      disabled={selectedIndex === null || acceptance.status === 'accepting'}
                      onClick={() => void acceptProposal(proposal)}
                    >
                      {acceptance.status === 'accepting' && selection?.proposalId === proposal.proposalId
                        ? 'Accepting swap…'
                        : acceptance.status === 'unknown' && envelope?.proposalId === proposal.proposalId
                          ? 'Retry same acceptance'
                          : 'Accept selected starting target'}
                    </button>}
            </section>
          })}
        </div>
      : null}
  </Surface>
}

export default function TrainingExerciseSwapPanel(props: TrainingExerciseSwapPanelProps) {
  return <TrainingExerciseSwapPanelState key={`${props.sessionId}:${props.exerciseInstanceId}`} {...props} />
}

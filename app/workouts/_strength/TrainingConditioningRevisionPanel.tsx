'use client'

import { useEffect, useRef, useState } from 'react'
import { Surface } from '@/components/array/Surface'
import {
  AcceptConditioningRevisionProposalInputV1Schema,
  ConditioningRevisionAcceptanceV1Schema,
  ConditioningRevisionOptionsV1Schema,
  ConditioningRevisionProposalProjectionV1Schema,
  CreateConditioningRevisionProposalInputV1Schema,
  type ConditioningRevisionAcceptanceV1,
  type ConditioningRevisionOptionsV1,
  type ConditioningRevisionProposalProjectionV1,
  type ConditioningRevisionSelectionV1,
} from '@/lib/training/contracts/conditioning-revision'
import ConditioningRevisionForm from './ConditioningRevisionForm'
import styles from './StrengthProgramBuilder.module.css'

type Options = Extract<ConditioningRevisionOptionsV1['result'], { kind: 'options' }>
type ReadyRevision = Extract<ConditioningRevisionProposalProjectionV1['revision']['result'], { kind: 'revision_ready' }>
type Props = {
  assignmentId: string
  onAccepted?: (acceptance: ConditioningRevisionAcceptanceV1) => void
}
type LoadState = 'loading' | 'ready' | 'blocked' | 'error' | 'refresh'
type AcceptanceState = 'idle' | 'accepting' | 'retry' | 'accepted'

const conflictCopy = {
  before_current_local_date: 'The selected date has already passed in the athlete’s timezone.',
  outside_source_week: 'Keep this bout inside its originally scheduled week.',
  strength_date_requires_arrangement: 'That date already has strength training. Choose strength first on the same day or select an off day.',
  conditioning_date_collision: 'Another conditioning bout already uses that date.',
  paired_arrangement_unavailable: 'This activity cannot be paired with strength on that date. Choose an off day.',
} as const

const unavailableCopy = {
  no_changeable_bouts: 'No future conditioning bouts are available to revise.',
  no_effective_change: 'The proposed schedule matches the current plan.',
  current_plan_not_two_bouts_weekly: 'This plan does not have the required two weekly conditioning bouts.',
  session_state_unavailable: 'One of these sessions has already started or is no longer changeable.',
  selection_mismatch: 'The selected bouts no longer match the current plan.',
  source_revision_mismatch: 'The program changed while this revision was being prepared.',
  catalog_context_mismatch: 'The available activity source changed. Reload the current plan.',
  modality_unavailable: 'That activity is no longer available for this plan.',
  mixed_timezone: 'The selected bouts do not share one athlete timezone.',
  new_modality_duration_requires_1_to_20_minutes: 'A newly selected activity needs a starting duration from 1 to 20 minutes.',
} as const

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function exactUniqueIds(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && new Set(expected).size === expected.length
    && expected.every(id => actual.includes(id))
}

function expectedEvidenceBoundary(revision: ReadyRevision): 'preserved' | 'reset' {
  return revision.replacements.some(replacement => replacement.evidenceBoundary.kind === 'reset')
    ? 'reset'
    : 'preserved'
}

function durationLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return remaining === 0 ? `${minutes} min` : `${minutes} min ${remaining} sec`
}

function RevisionPanel({ assignmentId, onAccepted }: Props) {
  const [options, setOptions] = useState<Options | null>(null)
  const [projection, setProjection] = useState<ConditioningRevisionProposalProjectionV1 | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [acceptanceState, setAcceptanceState] = useState<AcceptanceState>('idle')
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [message, setMessage] = useState('')
  const locked = useRef(false)
  const requestId = useRef<string | null>(null)

  async function loadOptions(signal?: AbortSignal) {
    if (locked.current) return
    locked.current = true
    setLoadState('loading')
    setMessage('')
    setOptions(null)
    setProjection(null)
    setAcceptanceState('idle')
    setIsPreviewing(false)
    requestId.current = null
    try {
      const response = await fetch(`/api/training/conditioning/revisions?assignmentId=${encodeURIComponent(assignmentId)}`, { signal })
      if (response.status === 401 || response.status === 403) {
        setLoadState('blocked')
        return
      }
      if (!response.ok) throw new Error('Conditioning options could not be loaded. Try again.')
      const parsed = ConditioningRevisionOptionsV1Schema.safeParse(await response.json())
      if (!parsed.success || (parsed.data.result.kind === 'options' && parsed.data.result.assignmentId !== assignmentId)) {
        throw new Error('The conditioning options could not be verified.')
      }
      if (parsed.data.result.kind === 'unavailable') {
        setLoadState('ready')
        setMessage(parsed.data.result.reason === 'no_changeable_bouts'
          ? 'No future conditioning bouts are available to revise.'
          : 'Conditioning revisions are unavailable for this program.')
        return
      }
      setOptions(parsed.data.result)
      setLoadState('ready')
    } catch (cause) {
      if (signal?.aborted) return
      setLoadState('error')
      setMessage(cause instanceof Error ? cause.message : 'Conditioning options could not be loaded.')
    } finally {
      locked.current = false
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return loadOptions(controller.signal)
    })
    return () => controller.abort()
    // assignmentId remounts the panel and is the only load identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function preview(selection: ConditioningRevisionSelectionV1) {
    if (locked.current || loadState !== 'ready' || !options || isPreviewing
      || acceptanceState !== 'idle' || projection?.revision.result.kind === 'revision_ready') return
    locked.current = true
    setIsPreviewing(true)
    setMessage('')
    setProjection(null)
    try {
      const input = CreateConditioningRevisionProposalInputV1Schema.parse({ assignmentId, selection })
      const response = await fetch('/api/training/conditioning/revisions/proposals', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      })
      if (response.status === 401 || response.status === 403) {
        setLoadState('blocked'); setOptions(null); setProjection(null); return
      }
      if (response.status === 409) {
        setLoadState('refresh'); setOptions(null); setProjection(null); return
      }
      if (!response.ok) throw new Error('The conditioning preview could not be prepared.')
      const parsed = ConditioningRevisionProposalProjectionV1Schema.safeParse(await response.json())
      if (!parsed.success) throw new Error('The conditioning preview could not be verified.')
      const result = parsed.data.revision.result
      if (result.kind === 'revision_ready' && (
        result.assignmentId !== options.assignmentId
        || result.subjectId !== options.subjectId
        || !sameValue(result.executionContext, options.executionContext)
        || new Set(result.replacements.map(replacement => replacement.sourceBoutId)).size !== result.replacements.length
      )) throw new Error('The conditioning preview does not match the loaded program.')
      requestId.current = null
      setAcceptanceState('idle')
      setProjection(parsed.data)
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'The conditioning preview could not be prepared.')
    } finally {
      setIsPreviewing(false)
      locked.current = false
    }
  }

  function editConfirmedPreview() {
    if (acceptanceState !== 'idle' || projection?.revision.result.kind !== 'revision_ready') return
    setProjection(null)
    requestId.current = null
    setMessage('')
  }

  async function accept() {
    const ready = projection?.revision.result.kind === 'revision_ready' ? projection.revision.result : null
    if (locked.current || loadState !== 'ready' || isPreviewing || !ready
      || !projection?.proposalId || acceptanceState === 'accepted') return
    locked.current = true
    requestId.current ??= globalThis.crypto.randomUUID()
    setAcceptanceState('accepting')
    setMessage('')
    try {
      const input = AcceptConditioningRevisionProposalInputV1Schema.parse({ requestId: requestId.current })
      const response = await fetch(`/api/training/conditioning/revisions/proposals/${encodeURIComponent(projection.proposalId)}/accept`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      })
      if (response.status === 401 || response.status === 403) {
        setLoadState('blocked'); setOptions(null); setProjection(null); return
      }
      if (response.status === 409) {
        setLoadState('refresh'); setOptions(null); setProjection(null); requestId.current = null; return
      }
      if (!response.ok) throw new Error('Acceptance is not confirmed. Retry the same request before making another change.')
      const parsed = ConditioningRevisionAcceptanceV1Schema.safeParse(await response.json())
      const expectedBoutIds = ready.replacements.map(replacement => replacement.sourceBoutId)
      if (!parsed.success
        || parsed.data.proposalId !== projection.proposalId
        || parsed.data.assignmentId !== ready.assignmentId
        || parsed.data.programRevisionNumber !== ready.baseProgramRevisionNumber + 1
        || !exactUniqueIds(parsed.data.affectedBoutIds, expectedBoutIds)
        || parsed.data.evidenceBoundary !== expectedEvidenceBoundary(ready)) {
        throw new Error('The acceptance receipt could not be verified. Retry the same request to confirm its outcome.')
      }
      setAcceptanceState('accepted')
      onAccepted?.(parsed.data)
    } catch (cause) {
      setAcceptanceState('retry')
      setMessage(cause instanceof Error ? cause.message : 'Acceptance is not confirmed. Retry the same request.')
    } finally {
      locked.current = false
    }
  }

  const result = projection?.revision.result
  const confirmed = result?.kind === 'revision_ready' ? result : null
  const formLocked = loadState !== 'ready' || isPreviewing || Boolean(confirmed)
    || acceptanceState === 'accepting' || acceptanceState === 'retry'
  const modalityLabel = (id: string) => options?.modalities.find(modality => modality.modalityId === id)?.label ?? id

  return <Surface tier="tile" innerClassName={styles.sessionPlayer}>
    <h3 className="t-headline-sm">Revise future conditioning</h3>
    <p>Review dates, duration, and activity before changing future bouts. Completed and started sessions remain unchanged.</p>
    {loadState === 'loading' ? <p role="status">Loading conditioning options…</p> : null}
    {loadState === 'blocked' ? <p role="alert">You do not have permission to revise this conditioning plan.</p> : null}
    {loadState === 'error' ? <><p role="alert">{message}</p><button type="button" className="a-secondary" onClick={() => void loadOptions()}>Try again</button></> : null}
    {loadState === 'refresh' ? <><p role="alert">This conditioning plan changed. Reload the current options before continuing.</p><button type="button" className="a-secondary" onClick={() => void loadOptions()}>Reload conditioning options</button></> : null}
    {loadState === 'ready' && !options ? <p>{message}</p> : null}
    {options?.executionContext.kind === 'synthetic_simulation' ? <p className={styles.practiceBanner}>Practice data · Simulation</p> : null}
    {options ? <ConditioningRevisionForm
      key={JSON.stringify([
        options.assignmentId,
        options.currentLocalDate,
        options.changeableBouts.map(bout => [bout.boutId, bout.modalityId, bout.scheduledLocalDate, bout.acceptedDurationSeconds, bout.arrangement]),
      ])}
      bouts={options.changeableBouts.map(bout => ({
        sourceBoutId: bout.boutId, modalityId: bout.modalityId,
        scheduledLocalDate: bout.scheduledLocalDate,
        acceptedDurationSeconds: bout.acceptedDurationSeconds,
        arrangement: bout.arrangement,
      }))}
      modalities={options.modalities.map(modality => ({
        id: modality.modalityId, label: modality.label,
        pairingAvailable: modality.strengthFirstPairingAvailable,
      }))}
      athleteTimezone={options.athleteTimezone}
      disabled={formLocked}
      onPreview={selection => void preview(selection)}
    /> : null}
    {isPreviewing ? <p role="status">Preparing conditioning preview…</p> : null}
    {message && options && loadState === 'ready' ? <p role="alert" className={styles.error}>{message}</p> : null}
    {result?.kind === 'reschedule_required' ? <section aria-label="Schedule conflicts">
      <h4>Choose another schedule</h4>
      {result.conflicts.map(conflict => <div key={`${conflict.sourceBoutId}:${conflict.requestedLocalDate}`}>
        <p>{conflict.requestedLocalDate}: {conflictCopy[conflict.reason]}</p>
        {conflict.offDayAlternatives.length > 0 ? <p>Available off days: {conflict.offDayAlternatives.join(', ')}.</p> : null}
        {conflict.pairedOptionAvailable ? <p>A same-day option is available when strength is completed first.</p> : null}
      </div>)}
    </section> : null}
    {result?.kind === 'unavailable' ? <p>{unavailableCopy[result.reason]} Nothing was changed.</p> : null}
    {confirmed ? <section aria-label="Conditioning revision preview">
      <h4>Confirm future conditioning changes</h4>
      <ul>{confirmed.replacements.map(replacement => <li key={replacement.sourceBoutId}>
        <strong>{replacement.scheduledLocalDate}</strong>: {modalityLabel(replacement.priorModalityId)} → {modalityLabel(replacement.modalityId)}; {durationLabel(replacement.acceptedDurationSeconds)}; {replacement.effortCue}. {replacement.arrangement === 'paired_strength_first' ? 'Strength is completed first on the paired day.' : 'Scheduled on a separate day from strength.'}
      </li>)}</ul>
      <p>Frequency stays the same. Effort is not increased automatically.</p>
      <p>{expectedEvidenceBoundary(confirmed) === 'reset'
        ? 'Changed duration or activity starts a new evidence window for the affected bouts. Saved history remains available.'
        : 'Comparable evidence remains connected because activity and duration are unchanged. Saved history remains available.'}</p>
      {acceptanceState === 'idle' ? <div className={styles.actionRow}>
        <button type="button" className="a-secondary" onClick={editConfirmedPreview}>Edit changes</button>
        <button type="button" className="a-primary" onClick={() => void accept()}>Accept conditioning revision</button>
      </div> : null}
      {acceptanceState === 'accepting' ? <p role="status">Confirming conditioning revision…</p> : null}
      {acceptanceState === 'retry' ? <button type="button" className="a-primary" onClick={() => void accept()}>Retry conditioning acceptance</button> : null}
      {acceptanceState === 'accepted' ? <p role="status">Conditioning revision accepted. Future sessions can now reload the updated plan.</p> : null}
    </section> : null}
  </Surface>
}

export default function TrainingConditioningRevisionPanel(props: Props) {
  return <RevisionPanel key={props.assignmentId} {...props} />
}

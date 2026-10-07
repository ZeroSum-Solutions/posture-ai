'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Surface } from '@/components/array/Surface'
import { Button } from '@/components/ui'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { TrainingSetLogEventV1 } from '@/lib/training/contracts/logs'
import type { TrainingConditioningSessionPrescriptionV1, TrainingSessionPrescriptionV1 } from '@/lib/training/contracts/session'
import {
  getTrainingOfflineBrowserOutbox,
  synchronizeTrainingOfflineAuth,
  type TrainingOfflineBrowserOutbox,
  type TrainingOfflineEnvelopeInputV1,
  TrainingOfflineDuplicateRequestError,
} from '@/lib/training/offline'
import { createLoadQuantity, type LoadUnit } from '@/lib/training/quantity'
import {
  classifyTrainingOfflineReplay,
  completeTrainingSession,
  readTrainingSession,
  replayTrainingOfflineEntry,
  saveTrainingConditioning,
  saveTrainingSet,
  startTrainingSession,
  TrainingMutationFailure,
  TrainingRevisionConflict,
  type TrainingMutationAck,
  type TrainingSessionProjection,
} from './TrainingSessionPlayer.gateway'
import styles from './StrengthProgramBuilder.module.css'
import RestTimer from './RestTimer'
import TrainingConditioningProgressionPanel from './TrainingConditioningProgressionPanel'
import TrainingPreviousPerformance from './TrainingPreviousPerformance'
import TrainingProgressionPanel from './TrainingProgressionPanel'
import TrainingExerciseMedia from './TrainingExerciseMedia'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; projection: TrainingSessionProjection }

type StrengthPrescription = TrainingSessionPrescriptionV1['exercises'][number]
type WarmupPrescription = NonNullable<StrengthPrescription['warmupSets']>[number]
type SetMutationAttempt = Parameters<typeof saveTrainingSet>[0]
type ConditioningMutationAttempt = Parameters<typeof saveTrainingConditioning>[0]
type CompletionMutationAttempt = Parameters<typeof completeTrainingSession>[0]
type OfflineMutation = TrainingOfflineEnvelopeInputV1['mutation']
type SameAsLastSetValues = Pick<TrainingSetLogEventV1, 'quantity' | 'reps' | 'rir'>
type OfflineRuntime = { outbox: TrainingOfflineBrowserOutbox; userId: string }
type OfflineQueueState = {
  status: 'initializing' | 'ready' | 'unknown' | 'unavailable'
  pendingCount: number
  conflictRequestId: string | null
}

const notSavedMessage = 'Save not confirmed. Check your connection and retry the same request.'

function exactLoadLabel(
  quantity: { value: string; unit: LoadUnit },
  loadBasis: StrengthPrescription['acceptedInitialLoad']['loadBasis'],
): string {
  if (loadBasis === 'dumbbell_single_implement') return `${quantity.value} ${quantity.unit} · one dumbbell total`
  if (loadBasis === 'dumbbell_per_hand') return `${quantity.value} ${quantity.unit} per hand · two dumbbells`
  if (loadBasis === 'barbell_total') return `${quantity.value} ${quantity.unit} total on the bar`
  if (loadBasis === 'machine_stack') return `${quantity.value} ${quantity.unit} on the machine stack`
  if (loadBasis === 'bodyweight_external') {
    return quantity.value === '0'
      ? `0 ${quantity.unit} added externally · bodyweight only`
      : `${quantity.value} ${quantity.unit} added externally`
  }
  return `${quantity.value} ${quantity.unit} assistance from the machine`
}

function loadLabel(exercise: StrengthPrescription): string {
  return exactLoadLabel(exercise.acceptedInitialLoad.quantity.entered, exercise.acceptedInitialLoad.loadBasis)
}

function replaceActual(actuals: TrainingSetLogEventV1[], event: TrainingSetLogEventV1): TrainingSetLogEventV1[] {
  return [...actuals.filter(item => item.setId !== event.setId), event]
}

function workingSetKey(exerciseInstanceId: string, setId: string): string {
  return JSON.stringify([exerciseInstanceId, setId])
}

function missingActualCount(projection: TrainingSessionProjection): number {
  const strengthPrescription = projection.prescription?.schemaVersion === 'training-session-prescription.v1'
    ? projection.prescription
    : null
  const prescribedWorkingSetKeys = new Set(strengthPrescription?.exercises.flatMap(exercise =>
    exercise.setIds.map(setId => workingSetKey(exercise.exerciseInstanceId, setId)),
  ) ?? [])
  const prescribedCount = strengthPrescription
    ? prescribedWorkingSetKeys.size
    : projection.prescription?.schemaVersion === 'training-conditioning-session-prescription.v1' ? 1 : 0
  const actualCount = projection.session.session_kind === 'conditioning'
    ? Number(projection.currentConditioningActual !== null)
    : new Set(projection.currentActuals
      .filter(actual => actual.setKind === 'working'
        && prescribedWorkingSetKeys.has(workingSetKey(actual.exerciseInstanceId, actual.setId)))
      .map(actual => workingSetKey(actual.exerciseInstanceId, actual.setId))).size
  return Math.max(0, prescribedCount - actualCount)
}

function SetEditor({ sessionId, revision, exercise, setId, setIndex, warmup, current, copyFrom, copyLocked, onSaved, onConflict, saveAttempt }: {
  sessionId: string
  revision: number
  exercise: StrengthPrescription
  setId: string
  setIndex: number
  warmup?: WarmupPrescription
  current: TrainingSetLogEventV1 | undefined
  copyFrom: SameAsLastSetValues | undefined
  copyLocked: boolean
  onSaved: (ack: TrainingMutationAck) => void
  onConflict: (cause: unknown) => void
  saveAttempt: (attempt: SetMutationAttempt) => Promise<TrainingMutationAck>
}) {
  const prescribed = warmup?.prescribedLoad.entered ?? exercise.acceptedInitialLoad.quantity.entered
  const [value, setValue] = useState(current?.quantity.entered.value ?? prescribed.value)
  const [unit, setUnit] = useState<LoadUnit>(current?.quantity.entered.unit ?? prescribed.unit)
  const targetReps = warmup?.targetReps ?? exercise.targetReps?.[setIndex]
  const [reps, setReps] = useState(String(current?.reps ?? targetReps ?? exercise.repRange.minimum))
  const [rir, setRir] = useState<string>(String(current?.rir ?? 'unknown'))
  const [symptomState, setSymptomState] = useState<'none' | 'adverse_reported'>(current?.symptomState ?? 'none')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'not_saved'>(current ? 'saved' : 'idle')
  const [error, setError] = useState('')
  const [pendingAttempt, setPendingAttempt] = useState<SetMutationAttempt | null>(null)

  function edited() {
    setState('idle')
    setPendingAttempt(null)
    setError('')
  }

  function copyLastSet() {
    if (!copyFrom) return
    setValue(copyFrom.quantity.entered.value)
    setUnit(copyFrom.quantity.entered.unit)
    setReps(String(copyFrom.reps))
    setRir(String(copyFrom.rir))
    edited()
  }

  async function save() {
    setError('')
    setState('saving')
    try {
      if (!/^\d+$/.test(reps) || Number(reps) > 100) {
        throw new Error('Enter reps as a whole number from 0 to 100.')
      }
      const side = exercise.progression?.side
      if (!side) throw new Error('Exercise side is unavailable. Refresh the session before logging.')
      const quantity = createLoadQuantity({ value, unit })
      const parsedRir = rir === 'unknown' || rir === '6_plus' ? rir : Number(rir)
      const attempt = pendingAttempt ?? {
        requestId: globalThis.crypto.randomUUID(),
        sessionId,
        setId,
        expectedRevision: revision,
        actual: {
          quantity,
          reps: Number(reps),
          rir: parsedRir as number | '6_plus' | 'unknown',
          side,
          symptomState,
          occurredAt: new Date().toISOString(),
        },
      }
      setPendingAttempt(attempt)
      const ack = await saveAttempt(attempt)
      setPendingAttempt(null)
      setState('saved')
      onSaved(ack)
    } catch (cause) {
      setState('idle')
      if (cause instanceof TrainingRevisionConflict) {
        setPendingAttempt(null)
        onConflict(cause)
      } else if (cause instanceof TrainingMutationFailure && cause.canRetryExact) {
        setState('not_saved')
        setError(notSavedMessage)
      } else {
        setPendingAttempt(null)
        setError(cause instanceof Error ? cause.message : 'Set could not be saved.')
      }
    }
  }

  const saveLabel = warmup
    ? state === 'saving'
      ? current ? 'Correcting saved warm-up…' : 'Saving warm-up…'
      : state === 'saved' ? 'Warm-up saved'
        : state === 'not_saved' ? current ? 'Retry warm-up correction' : 'Retry warm-up'
          : current ? 'Correct saved warm-up' : 'Save warm-up'
    : state === 'saving'
      ? current ? 'Correcting saved set…' : 'Saving set…'
      : state === 'saved' ? 'Set saved'
        : state === 'not_saved' ? current ? 'Retry correction' : 'Retry save'
          : current ? 'Correct saved set' : 'Save set'
  return <fieldset className={styles.setEditor}>
    <legend>{warmup ? 'Warm-up' : 'Set'} {setIndex + 1}</legend>
    {warmup
      ? <p className="t-footnote">Prescribed: {exactLoadLabel(prescribed, exercise.acceptedInitialLoad.loadBasis)} · {targetReps} reps</p>
      : targetReps !== undefined ? <p className="t-footnote">Target: {targetReps} reps</p> : null}
    <label>Load<input className="a-input" inputMode="decimal" value={value} disabled={state === 'saving'} onChange={event => { setValue(event.target.value); edited() }} /></label>
    <label>Unit<select className="a-input" value={unit} disabled={state === 'saving'} onChange={event => { setUnit(event.target.value as LoadUnit); edited() }}><option value="kg">kg</option><option value="lb">lb</option></select></label>
    <label>Reps<input className="a-input" type="number" min="0" max="100" value={reps} disabled={state === 'saving'} onChange={event => { setReps(event.target.value); edited() }} /></label>
    <label>RIR<select className="a-input" value={rir} disabled={state === 'saving'} onChange={event => { setRir(event.target.value); edited() }}>
      <option value="unknown">Not recorded</option><option value="6_plus">6+</option>{[5, 4, 3, 2, 1, 0].map(value => <option key={value} value={value}>{value}</option>)}
    </select></label>
    <label className={styles.symptomField}>During this set<select className="a-input" value={symptomState} disabled={state === 'saving'} onChange={event => { setSymptomState(event.target.value as 'none' | 'adverse_reported'); edited() }}><option value="none">No adverse symptoms reported</option><option value="adverse_reported">Adverse symptoms reported</option></select></label>
    {!warmup && setIndex > 0 ? <button
      type="button"
      className="a-secondary"
      disabled={!copyFrom || Boolean(current) || copyLocked || state === 'saving' || state === 'not_saved'}
      onClick={copyLastSet}
    >Same as last set</button> : null}
    <button type="button" className="a-secondary" disabled={state === 'saving' || state === 'saved'} onClick={() => void save()}>{saveLabel}</button>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
  </fieldset>
}

function StrengthSession({ projection, update, conflict, saveSet, copyLocked }: {
  projection: TrainingSessionProjection
  update: (ack: TrainingMutationAck) => void
  conflict: (cause: unknown) => void
  saveSet: (attempt: SetMutationAttempt) => Promise<TrainingMutationAck>
  copyLocked: boolean
}) {
  const prescription = projection.prescription
  if (!prescription || prescription.schemaVersion !== 'training-session-prescription.v1') return null
  const terminal = ['completed', 'completed_with_omissions', 'aborted'].includes(projection.session.state)
  return <div className={styles.sessionExercises}>
    {prescription.exercises.map((exercise, index) => {
      const exerciseLabel = projection.exerciseDisplay[exercise.exerciseInstanceId]?.label ?? 'Exercise name unavailable'
      return <Surface key={exercise.exerciseInstanceId} tier="tile" innerClassName={styles.sessionExercise}>
      <div className={styles.sectionHeading}>
        <div><p className="t-overline">Exercise {String(index + 1).padStart(2, '0')}</p><h3 className="t-title-2">{exerciseLabel}</h3></div>
        <span className="t-footnote">Rest {exercise.restSeconds}s</span>
      </div>
      <TrainingExerciseMedia
        binding={{ catalogVersion: prescription.catalogVersion, catalogOrigin: prescription.catalogOrigin, exerciseVersionId: exercise.exerciseVersionId }}
        media={projection.exerciseDisplay[exercise.exerciseInstanceId]?.media}
        instruction={projection.exerciseDisplay[exercise.exerciseInstanceId]?.textInstruction ?? 'Instructions are unavailable for this saved catalog version.'}
      />
      <p className="t-body">Prescribed: {loadLabel(exercise)} · {exercise.repRange.minimum}–{exercise.repRange.maximum} reps · RIR {exercise.targetRir.minimum}–{exercise.targetRir.maximum}</p>
      <TrainingPreviousPerformance sessionId={projection.session.id} exerciseInstanceId={exercise.exerciseInstanceId} />
      {exercise.warmupSets?.length ? <section aria-labelledby={`${exercise.exerciseInstanceId}-warmups`}>
        <h4 id={`${exercise.exerciseInstanceId}-warmups`}>Warm-up sets</h4>
        <div className={styles.setGrid}>
          {exercise.warmupSets.map((warmup, warmupIndex) => {
            const current = projection.currentActuals.find(actual => actual.setId === warmup.setId)
            return terminal && !current
              ? <div key={warmup.setId} role="group" aria-label={`Warm-up ${warmupIndex + 1}`} className={styles.setEditor}>
                  <strong>Warm-up {warmupIndex + 1}</strong><span>Not recorded</span>
                </div>
              : <SetEditor
                  key={`${warmup.setId}:${current?.eventRevision ?? 0}`}
                  sessionId={projection.session.id}
                  revision={projection.session.revision}
                  exercise={exercise}
                  setId={warmup.setId}
                  setIndex={warmupIndex}
                  warmup={warmup}
                  current={current}
                  copyFrom={undefined}
                  copyLocked={copyLocked}
                  onSaved={update}
                  onConflict={conflict}
                  saveAttempt={saveSet}
                />
          })}
        </div>
      </section> : null}
      <h4>Working sets</h4>
      <div className={styles.setGrid}>
        {exercise.setIds.map((setId, setIndex) => {
          const current = projection.currentActuals.find(actual => actual.setId === setId)
          const copyFrom = exercise.setIds.slice(0, setIndex).reverse()
            .map(priorSetId => projection.currentActuals.find(actual => actual.setId === priorSetId))
            .find(actual => actual?.sessionId === projection.session.id
              && actual.exerciseInstanceId === exercise.exerciseInstanceId
              && actual.setKind === 'working')
          return terminal && !current
            ? <div key={setId} role="group" aria-label={`Set ${setIndex + 1}`} className={styles.setEditor}>
                <strong>Set {setIndex + 1}</strong><span>Not recorded</span><span>Omitted when finished.</span>
              </div>
            : <SetEditor
          key={`${setId}:${current?.eventRevision ?? 0}`}
          sessionId={projection.session.id}
          revision={projection.session.revision}
          exercise={exercise}
          setId={setId}
          setIndex={setIndex}
          current={current}
          copyFrom={copyFrom}
          copyLocked={copyLocked}
          onSaved={update}
          onConflict={conflict}
          saveAttempt={saveSet}
        />})}
      </div>
      {!terminal && !projection.session.stopped_for_symptoms && exercise.setIds.length > 1
        ? <RestTimer key={`${exercise.exerciseInstanceId}:${exercise.restSeconds}`} durationSeconds={exercise.restSeconds} exerciseLabel={exerciseLabel} />
        : null}
      {terminal && exercise.progression ? <TrainingProgressionPanel
        key={`${projection.session.id}:${exercise.exerciseInstanceId}:${projection.session.revision}`}
        sessionId={projection.session.id}
        exerciseInstanceId={exercise.exerciseInstanceId}
      /> : null}
    </Surface>
    })}
  </div>
}

function ConditioningSession({ projection, update, conflict, saveConditioning }: {
  projection: TrainingSessionProjection
  update: (ack: TrainingMutationAck) => void
  conflict: (cause: unknown) => void
  saveConditioning: (attempt: ConditioningMutationAttempt) => Promise<TrainingMutationAck>
}) {
  const prescription = projection.prescription
  if (!prescription || prescription.schemaVersion !== 'training-conditioning-session-prescription.v1') return null
  const terminal = ['completed', 'completed_with_omissions', 'aborted'].includes(projection.session.state)
  if (terminal && !projection.currentConditioningActual) return <Surface tier="tile" innerClassName={styles.conditioningSession}>
    <p className="t-overline">Conditioning</p>
    <h3 className="t-title-2">{projection.conditioningDisplay?.label ?? 'Conditioning name unavailable'}</h3>
    <p className="t-body">Not recorded</p><p className="t-footnote">Omitted when finished.</p>
  </Surface>
  return <ConditioningEditor
    key={projection.currentConditioningActual?.eventRevision ?? 0}
    projection={projection}
    prescription={prescription}
    update={update}
    conflict={conflict}
    saveAttempt={saveConditioning}
  />
}

function ConditioningEditor({ projection, prescription, update, conflict, saveAttempt }: {
  projection: TrainingSessionProjection
  prescription: TrainingConditioningSessionPrescriptionV1
  update: (ack: TrainingMutationAck) => void
  conflict: (cause: unknown) => void
  saveAttempt: (attempt: ConditioningMutationAttempt) => Promise<TrainingMutationAck>
}) {
  const current = projection.currentConditioningActual
  const initialDurationSeconds = current?.durationSeconds ?? prescription.acceptedBout.acceptedDurationSeconds
  const [minutes, setMinutes] = useState(String(Math.floor(initialDurationSeconds / 60)))
  const [seconds, setSeconds] = useState(String(initialDurationSeconds % 60))
  const [effort, setEffort] = useState<string>(String(current?.perceivedEffort ?? 'unknown'))
  const [symptomState, setSymptomState] = useState<'none' | 'adverse_reported'>(current?.symptomState ?? 'none')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'not_saved'>(current ? 'saved' : 'idle')
  const [error, setError] = useState('')
  const [pendingAttempt, setPendingAttempt] = useState<ConditioningMutationAttempt | null>(null)

  function edited() {
    setState('idle')
    setPendingAttempt(null)
    setError('')
  }

  async function save() {
    setState('saving')
    setError('')
    try {
      if (!/^\d+$/.test(minutes) || !/^\d+$/.test(seconds)
        || Number(seconds) > 59 || Number(minutes) * 60 + Number(seconds) > 86_400) {
        throw new Error('Enter whole minutes and seconds, up to 24 hours. Seconds must be between 0 and 59.')
      }
      const attempt = pendingAttempt ?? {
        requestId: globalThis.crypto.randomUUID(),
        sessionId: projection.session.id,
        expectedRevision: projection.session.revision,
        actual: {
          durationSeconds: Number(minutes) * 60 + Number(seconds),
          perceivedEffort: effort === 'unknown' ? 'unknown' : Number(effort),
          symptomState,
          occurredAt: new Date().toISOString(),
        },
      }
      setPendingAttempt(attempt)
      const ack = await saveAttempt(attempt)
      setPendingAttempt(null)
      setState('saved')
      update(ack)
    } catch (cause) {
      setState('idle')
      if (cause instanceof TrainingRevisionConflict) {
        setPendingAttempt(null)
        conflict(cause)
      } else if (cause instanceof TrainingMutationFailure && cause.canRetryExact) {
        setState('not_saved')
        setError(notSavedMessage)
      } else {
        setPendingAttempt(null)
        setError(cause instanceof Error ? cause.message : 'Conditioning could not be saved.')
      }
    }
  }

  return <Surface tier="tile" innerClassName={styles.conditioningSession}>
    <p className="t-overline">Conditioning</p>
    <h3 className="t-title-2">{projection.conditioningDisplay?.label ?? 'Conditioning name unavailable'} · {prescription.acceptedBout.acceptedDurationSeconds / 60} minute starting target</h3>
    <p className="t-body">{projection.conditioningDisplay?.effortCue ?? 'Instructions are unavailable for this saved catalog version.'}</p>
    <div className={styles.conditioningFields}>
      <label>Actual duration in minutes<input className="a-input" type="number" min="0" max="1440" step="1" value={minutes} disabled={state === 'saving'} onChange={event => { setMinutes(event.target.value); edited() }} /></label>
      <label>Additional seconds<input className="a-input" type="number" min="0" max="59" step="1" value={seconds} disabled={state === 'saving'} onChange={event => { setSeconds(event.target.value); edited() }} /></label>
      <label>Perceived effort<select className="a-input" value={effort} disabled={state === 'saving'} onChange={event => { setEffort(event.target.value); edited() }}><option value="unknown">Not recorded</option>{Array.from({ length: 11 }, (_, value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>During this bout<select className="a-input" value={symptomState} disabled={state === 'saving'} onChange={event => { setSymptomState(event.target.value as 'none' | 'adverse_reported'); edited() }}><option value="none">No adverse symptoms reported</option><option value="adverse_reported">Adverse symptoms reported</option></select></label>
    </div>
    <button type="button" className="a-secondary" disabled={state === 'saving' || state === 'saved'} onClick={() => void save()}>{state === 'saving' ? current ? 'Correcting saved conditioning…' : 'Saving conditioning…' : state === 'saved' ? 'Conditioning saved' : state === 'not_saved' ? current ? 'Retry conditioning correction' : 'Retry conditioning' : current ? 'Correct saved conditioning' : 'Save conditioning'}</button>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
  </Surface>
}

export default function TrainingSessionPlayer({ sessionId }: { sessionId: string }) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [pending, setPending] = useState(false)
  const [pendingCompletion, setPendingCompletion] = useState<CompletionMutationAttempt | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueueState>({
    status: 'initializing', pendingCount: 0, conflictRequestId: null,
  })
  const offlineRuntime = useRef<OfflineRuntime | null>(null)
  const offlineRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drainOfflineQueueRef = useRef<((runtime: OfflineRuntime) => Promise<unknown>) | null>(null)

  const cancelOfflineRetry = useCallback(() => {
    if (offlineRetryTimer.current !== null) clearTimeout(offlineRetryTimer.current)
    offlineRetryTimer.current = null
  }, [])

  const scheduleOfflineRetry = useCallback((runtime: OfflineRuntime, retryAfterMs: number) => {
    cancelOfflineRetry()
    offlineRetryTimer.current = setTimeout(() => {
      offlineRetryTimer.current = null
      if (offlineRuntime.current === runtime) void drainOfflineQueueRef.current?.(runtime)
    }, retryAfterMs + 25)
  }, [cancelOfflineRetry])

  async function reload() {
    setLoad({ status: 'loading' })
    setError('')
    try {
      setLoad({ status: 'ready', projection: await readTrainingSession(sessionId) })
    } catch (cause) {
      setLoad({ status: 'error', message: cause instanceof Error ? cause.message : 'Training session could not be loaded.' })
    }
  }

  useEffect(() => {
    let active = true
    void readTrainingSession(sessionId)
      .then(projection => { if (active) setLoad({ status: 'ready', projection }) })
      .catch(cause => {
        if (active) setLoad({ status: 'error', message: cause instanceof Error ? cause.message : 'Training session could not be loaded.' })
      })
    return () => { active = false }
  }, [sessionId])

  function conflict(cause: unknown) {
    if (cause instanceof TrainingRevisionConflict) {
      setPendingCompletion(null)
      setLoad({ status: 'ready', projection: cause.current })
      setMessage('Session changed elsewhere. Latest saved values are loaded; unsaved entries without a newer saved event remain visible.')
    }
  }

  const applyAck = useCallback((ack: TrainingMutationAck) => {
    setPendingCompletion(null)
    setError('')
    setLoad(current => {
      if (current.status !== 'ready') return current
      const projection = current.projection
      const adverseReported = ack.event?.symptomState === 'adverse_reported'
        || ack.conditioningEvent?.symptomState === 'adverse_reported'
      if (ack.revision < projection.session.revision) {
        return adverseReported && !projection.session.stopped_for_symptoms
          ? { status: 'ready', projection: { ...projection, session: { ...projection.session, stopped_for_symptoms: true } } }
          : current
      }
      return { status: 'ready', projection: {
        ...projection,
        session: {
          ...projection.session,
          revision: ack.revision,
          state: ack.state,
          stopped_for_symptoms: projection.session.stopped_for_symptoms || adverseReported,
        },
        currentActuals: ack.event ? replaceActual(projection.currentActuals, ack.event) : projection.currentActuals,
        currentConditioningActual: ack.conditioningEvent ?? projection.currentConditioningActual,
      } }
    })
    setMessage('Progress saved.')
  }, [])

  const refreshOfflineQueue = useCallback(async (runtime: OfflineRuntime) => {
    const entries = await runtime.outbox.list()
    setOfflineQueue({
      status: 'ready',
      pendingCount: entries.length,
      conflictRequestId: entries.find(entry => entry.status === 'conflict')?.envelope.requestId ?? null,
    })
  }, [])

  const drainOfflineQueue = useCallback(async (runtime: OfflineRuntime) => {
    cancelOfflineRetry()
    const acknowledgements = new Map<string, TrainingMutationAck>()
    const failures = new Map<string, unknown>()
    const result = await runtime.outbox.drain(async (entry, signal) => {
      try {
        const ack = await replayTrainingOfflineEntry(entry, signal, {
          set: saveTrainingSet,
          conditioning: saveTrainingConditioning,
          completion: completeTrainingSession,
        })
        acknowledgements.set(entry.envelope.requestId, ack)
        return { kind: 'acknowledged' }
      } catch (cause) {
        failures.set(entry.envelope.requestId, cause)
        return classifyTrainingOfflineReplay(cause)
      }
    })

    for (const [requestId, ack] of acknowledgements) {
      if (ack.requestId === requestId && ack.sessionId === sessionId) applyAck(ack)
    }
    await refreshOfflineQueue(runtime)

    if (result.kind === 'drained' && result.acknowledgedCount > 0) {
      setError('')
      setMessage(`${result.acknowledgedCount} pending ${result.acknowledgedCount === 1 ? 'change is' : 'changes are'} saved on the server.`)
    } else if (result.kind === 'already_draining') {
      scheduleOfflineRetry(runtime, result.retryAfterMs)
      setMessage('Saved on this device. Waiting for server confirmation.')
    } else if (result.kind === 'retry_later') {
      setMessage('Saved on this device. Waiting for server confirmation.')
    } else if (result.kind === 'conflict') {
      const cause = failures.get(result.requestId)
      if (cause instanceof TrainingRevisionConflict && result.requestId) {
        setPendingCompletion(null)
        setLoad({ status: 'ready', projection: cause.current })
      }
      setError('A pending change conflicts with the server. Review it before discarding the local change.')
    } else if (result.kind === 'rejected') {
      setError('The server rejected one pending change. It was removed; newer pending changes were kept.')
    } else if (result.kind === 'denied') {
      setError('Access to this pending change ended. The affected offline queue was cleared.')
    } else if (result.kind === 'account_changed') {
      setError('The signed-in account changed. Pending data was not transferred.')
    }
    return { result, acknowledgements, failures }
  }, [applyAck, cancelOfflineRetry, refreshOfflineQueue, scheduleOfflineRetry, sessionId])

  useEffect(() => {
    drainOfflineQueueRef.current = drainOfflineQueue
    return () => { drainOfflineQueueRef.current = null }
  }, [drainOfflineQueue])

  const submitOfflineMutation = useCallback(async (input: {
    subjectId: string
    requestId: string
    mutation: OfflineMutation
  }): Promise<TrainingMutationAck> => {
    const runtime = offlineRuntime.current
    if (!runtime) {
      throw new TrainingMutationFailure(
        'Durable offline storage is not ready. Retry after the secure session is available.',
        true,
        'offline_identity_unknown',
      )
    }
    try {
      await runtime.outbox.enqueue({
        userId: runtime.userId,
        subjectId: input.subjectId,
        sessionId,
        requestId: input.requestId,
        mutation: input.mutation,
      })
    } catch (cause) {
      if (cause instanceof TrainingOfflineDuplicateRequestError) {
        throw new TrainingMutationFailure(cause.message, false, 'offline_request_id_conflict', 409)
      }
      throw cause
    }
    setMessage('Saved on this device. Waiting for server confirmation.')
    await refreshOfflineQueue(runtime)
    const drained = await drainOfflineQueue(runtime)
    const acknowledgement = drained.acknowledgements.get(input.requestId)
    if (acknowledgement) return acknowledgement
    const failure = 'requestId' in drained.result ? drained.failures.get(drained.result.requestId) : undefined
    if (failure instanceof Error) throw failure
    if (drained.result.kind === 'conflict') {
      throw new TrainingMutationFailure('This pending change conflicts with the server.', false, 'offline_conflict', 409)
    }
    if (drained.result.kind === 'rejected') {
      throw new TrainingMutationFailure('The server rejected this pending change.', false, drained.result.reason, 422)
    }
    if (drained.result.kind === 'denied' || drained.result.kind === 'account_changed') {
      throw new TrainingMutationFailure('Access to this pending change ended.', false, 'offline_access_ended', 403)
    }
    throw new TrainingMutationFailure('Save not confirmed. The exact change remains on this device.', true, 'offline_pending')
  }, [drainOfflineQueue, refreshOfflineQueue, sessionId])

  useEffect(() => {
    let active = true
    const supabase = createSupabaseBrowserClient()
    const handleOnline = () => {
      const runtime = offlineRuntime.current
      if (runtime) void drainOfflineQueue(runtime)
    }
    window.addEventListener('online', handleOnline)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      const runtime = offlineRuntime.current
      const nextUserId = nextSession?.user.id ?? null
      if (runtime && (event === 'SIGNED_OUT' || (nextUserId && nextUserId !== runtime.userId))) {
        cancelOfflineRetry()
        offlineRuntime.current = null
        setOfflineQueue(current => ({ ...current, status: 'unknown' }))
      }
    })
    void supabase.auth.getUser().then(async ({ data: { user }, error: authError }) => {
      if (!active) return
      if (authError || !user) {
        setOfflineQueue(current => ({ ...current, status: 'unknown' }))
        return
      }
      try {
        const outbox = getTrainingOfflineBrowserOutbox()
        await synchronizeTrainingOfflineAuth({ kind: 'authenticated', userId: user.id }, outbox)
        if (!active) return
        const runtime = { outbox, userId: user.id }
        offlineRuntime.current = runtime
        await refreshOfflineQueue(runtime)
        if (globalThis.navigator.onLine) await drainOfflineQueue(runtime)
      } catch {
        if (active) setOfflineQueue(current => ({ ...current, status: 'unavailable' }))
      }
    }).catch(() => {
      if (active) setOfflineQueue(current => ({ ...current, status: 'unknown' }))
    })
    return () => {
      active = false
      cancelOfflineRetry()
      offlineRuntime.current = null
      subscription.unsubscribe()
      window.removeEventListener('online', handleOnline)
    }
  }, [cancelOfflineRetry, drainOfflineQueue, refreshOfflineQueue])

  async function discardOfflineConflict() {
    const runtime = offlineRuntime.current
    const requestId = offlineQueue.conflictRequestId
    if (!runtime || !requestId) return
    if (await runtime.outbox.discardConflict(requestId)) {
      await refreshOfflineQueue(runtime)
      setError('')
      setMessage('The conflicting local change was discarded. Server values will be reloaded.')
      await reload()
    }
  }

  async function retryOfflineQueue() {
    const runtime = offlineRuntime.current
    if (runtime) await drainOfflineQueue(runtime)
  }

  async function start(projection: TrainingSessionProjection) {
    setPending(true)
    setError('')
    try {
      setLoad({ status: 'ready', projection: await startTrainingSession(sessionId, projection.session.revision) })
      setMessage('Session started. Save each actual before finishing.')
    } catch (cause) {
      if (cause instanceof TrainingRevisionConflict) conflict(cause)
      else setError(cause instanceof Error ? cause.message : 'Session could not be started.')
    } finally {
      setPending(false)
    }
  }

  async function finish(
    projection: TrainingSessionProjection,
    requestedMode?: CompletionMutationAttempt['finishMode'],
  ) {
    const missing = missingActualCount(projection)
    const defaultMode: CompletionMutationAttempt['finishMode'] = projection.session.stopped_for_symptoms
      ? 'abort'
      : missing > 0 ? 'finish_with_omissions' : 'complete'
    const retry = pendingCompletion?.expectedRevision === projection.session.revision
      ? pendingCompletion
      : null
    const finishMode = retry?.finishMode ?? requestedMode ?? defaultMode
    const attempt: CompletionMutationAttempt = retry
      ? retry
      : { requestId: globalThis.crypto.randomUUID(), sessionId, expectedRevision: projection.session.revision, finishMode }
    setPendingCompletion(attempt)
    setPending(true)
    setError('')
    try {
      const ack = await submitOfflineMutation({
        subjectId: projection.session.subject_id,
        requestId: attempt.requestId,
        mutation: {
          kind: 'session_completion',
          expectedRevision: attempt.expectedRevision,
          finishMode: attempt.finishMode,
        },
      })
      applyAck(ack)
      setMessage(attempt.finishMode === 'abort'
        ? projection.session.stopped_for_symptoms
          ? 'Session stopped after adverse symptoms were reported. Saved actuals remain in history and this session will not advance progression.'
          : 'Session stopped. Saved actuals remain in history and this session will not advance progression.'
        : missing > 0 ? `Session finished with ${missing} omitted item${missing === 1 ? '' : 's'}.` : 'Session complete.')
    } catch (cause) {
      if (cause instanceof TrainingRevisionConflict) conflict(cause)
      else if (cause instanceof TrainingMutationFailure && cause.canRetryExact) setError(notSavedMessage)
      else {
        setPendingCompletion(null)
        setError(cause instanceof TrainingMutationFailure && cause.code === 'training_session_stale'
          ? 'This session is over 24 hours old. Review saved work or stop the session; it cannot be completed as progression evidence.'
          : cause instanceof Error ? cause.message : 'Session could not be finished.')
      }
    } finally {
      setPending(false)
    }
  }

  if (load.status === 'loading') return <Surface tier="tile" innerClassName={styles.entryState}><p role="status">Loading training session…</p></Surface>
  if (load.status === 'error') return <Surface tier="tile" innerClassName={styles.entryState}><p role="alert">{load.message}</p><Button variant="secondary" size="md" onClick={() => void reload()}>Retry session</Button></Surface>

  const projection = load.projection
  const practice = projection.executionContext.kind === 'synthetic_simulation'
  const terminal = ['completed', 'completed_with_omissions', 'aborted'].includes(projection.session.state)
  const missing = missingActualCount(projection)
  return <section className={styles.sessionPlayer} aria-labelledby="training-session-heading">
    {practice ? <div className={styles.practiceBanner}><strong>Practice data · Simulation</strong><span>This session belongs to the private sample workspace.</span></div> : null}
    <Surface tier="feature" innerClassName={styles.sessionHeader}>
      <div><p className="t-overline">{projection.session.session_kind === 'strength' ? 'Strength session' : 'Conditioning session'}</p><h2 id="training-session-heading" className="t-title-2">{projection.session.scheduled_local_date}</h2></div>
      <div><span className="t-overline">Session state</span><strong>{projection.session.state.replaceAll('_', ' ')}</strong></div>
    </Surface>
    {message ? <p role="status" className={styles.notice}>{message}</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {offlineQueue.status === 'unknown'
      ? <p role="status" className={styles.notice}>Offline saves are paused while this browser verifies the signed-in account. Existing pending data remains on this device.</p>
      : offlineQueue.status === 'unavailable'
        ? <p role="alert" className={styles.error}>Durable offline storage is unavailable in this browser. Server saves still require a connection.</p>
        : null}
    {offlineQueue.pendingCount > 0 ? <Surface tier="tile" innerClassName={styles.entryState}>
      <p role="status"><strong>{offlineQueue.pendingCount} pending {offlineQueue.pendingCount === 1 ? 'change' : 'changes'} on this device.</strong> These changes are not saved on the server yet.</p>
      {offlineQueue.conflictRequestId
        ? <Button type="button" variant="secondary" size="md" onClick={() => void discardOfflineConflict()}>Discard conflicting local change and reload</Button>
        : <Button type="button" variant="secondary" size="md" onClick={() => void retryOfflineQueue()}>Retry pending saves</Button>}
    </Surface> : null}
    {projection.session.stopped_for_symptoms ? <p role="alert" className={styles.error}>Adverse symptoms were reported. Do not continue this session until they have been addressed.</p> : null}
    {projection.session.state === 'scheduled'
      ? <Button type="button" variant="primary" size="md" loading={pending} onClick={() => void start(projection)}>Start session</Button>
      : null}
    {projection.session.state !== 'scheduled' && projection.session.session_kind === 'strength'
      ? <StrengthSession projection={projection} update={applyAck} conflict={conflict} copyLocked={offlineQueue.pendingCount > 0 || offlineQueue.conflictRequestId !== null} saveSet={attempt => submitOfflineMutation({
        subjectId: projection.session.subject_id,
        requestId: attempt.requestId,
        mutation: { kind: 'set_actual', setId: attempt.setId, expectedRevision: attempt.expectedRevision, actual: attempt.actual },
      })} /> : null}
    {projection.session.state !== 'scheduled' && projection.session.session_kind === 'conditioning'
      ? <ConditioningSession projection={projection} update={applyAck} conflict={conflict} saveConditioning={attempt => submitOfflineMutation({
        subjectId: projection.session.subject_id,
        requestId: attempt.requestId,
        mutation: { kind: 'conditioning_actual', expectedRevision: attempt.expectedRevision, actual: attempt.actual },
      })} /> : null}
    {terminal && projection.session.session_kind === 'conditioning'
      ? <TrainingConditioningProgressionPanel sessionId={sessionId} />
      : null}
    {projection.session.state === 'in_progress'
      ? <div className={styles.finishBar}>
        <p className="t-body">Save actuals first. Finishing with missing items records omissions explicitly. Stopping preserves saved actuals without advancing progression.</p>
        {pendingCompletion
          ? <Button type="button" variant="primary" size="md" loading={pending} onClick={() => void finish(projection)}>
            {pendingCompletion.finishMode === 'abort'
              ? 'Retry stop session'
              : pendingCompletion.finishMode === 'finish_with_omissions'
                ? `Retry finish with ${missing} omission${missing === 1 ? '' : 's'}`
                : 'Retry finish session'}
          </Button>
          : projection.session.stopped_for_symptoms
            ? <Button type="button" variant="primary" size="md" loading={pending} onClick={() => void finish(projection, 'abort')}>Stop session</Button>
            : <>
              <Button type="button" variant="primary" size="md" loading={pending} onClick={() => void finish(projection)}>{missing > 0 ? `Finish with ${missing} omission${missing === 1 ? '' : 's'}` : 'Finish session'}</Button>
              <Button type="button" variant="secondary" size="md" loading={pending} onClick={() => void finish(projection, 'abort')}>Stop session</Button>
            </>}
      </div>
      : terminal
        ? <p role="status" className={styles.accepted}>{projection.session.state === 'aborted'
          ? 'This session was stopped. Saved actuals remain in history and it will not advance progression.'
          : `This session is ${projection.session.state.replaceAll('_', ' ')}.`}</p>
        : null}
  </section>
}

'use client'

import { useEffect, useState } from 'react'
import { Surface } from '@/components/array/Surface'
import type { TrainingSetLogEventV1 } from '@/lib/training/contracts/logs'
import type { TrainingConditioningSessionPrescriptionV1, TrainingSessionPrescriptionV1 } from '@/lib/training/contracts/session'
import { createLoadQuantity, type LoadUnit } from '@/lib/training/quantity'
import {
  completeTrainingSession,
  readTrainingSession,
  saveTrainingConditioning,
  saveTrainingSet,
  startTrainingSession,
  TrainingRevisionConflict,
  type TrainingMutationAck,
  type TrainingSessionProjection,
} from './TrainingSessionPlayer.gateway'
import styles from './StrengthProgramBuilder.module.css'
import RestTimer from './RestTimer'
import TrainingProgressionPanel from './TrainingProgressionPanel'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; projection: TrainingSessionProjection }

type StrengthPrescription = TrainingSessionPrescriptionV1['exercises'][number]

function loadLabel(exercise: StrengthPrescription): string {
  const quantity = exercise.acceptedInitialLoad.quantity.entered
  if (exercise.acceptedInitialLoad.loadBasis === 'dumbbell_single_implement') return `${quantity.value} ${quantity.unit} · one dumbbell total`
  if (exercise.acceptedInitialLoad.loadBasis === 'dumbbell_per_hand') return `${quantity.value} ${quantity.unit} per hand · two dumbbells`
  if (exercise.acceptedInitialLoad.loadBasis === 'barbell_total') return `${quantity.value} ${quantity.unit} total on the bar`
  return `${quantity.value} ${quantity.unit} on the machine stack`
}

function replaceActual(actuals: TrainingSetLogEventV1[], event: TrainingSetLogEventV1): TrainingSetLogEventV1[] {
  return [...actuals.filter(item => item.setId !== event.setId), event]
}

function missingActualCount(projection: TrainingSessionProjection): number {
  const prescribedCount = projection.prescription?.schemaVersion === 'training-session-prescription.v1'
    ? projection.prescription.exercises.reduce((sum, exercise) => sum + exercise.setIds.length, 0)
    : projection.prescription?.schemaVersion === 'training-conditioning-session-prescription.v1' ? 1 : 0
  const actualCount = projection.session.session_kind === 'conditioning'
    ? Number(projection.currentConditioningActual !== null)
    : new Set(projection.currentActuals.map(actual => actual.setId)).size
  return Math.max(0, prescribedCount - actualCount)
}

function SetEditor({ sessionId, revision, exercise, setId, setIndex, current, onSaved, onConflict }: {
  sessionId: string
  revision: number
  exercise: StrengthPrescription
  setId: string
  setIndex: number
  current: TrainingSetLogEventV1 | undefined
  onSaved: (ack: TrainingMutationAck) => void
  onConflict: (cause: unknown) => void
}) {
  const prescribed = exercise.acceptedInitialLoad.quantity.entered
  const [value, setValue] = useState(current?.quantity.entered.value ?? prescribed.value)
  const [unit, setUnit] = useState<LoadUnit>(current?.quantity.entered.unit ?? prescribed.unit)
  const targetReps = exercise.targetReps?.[setIndex]
  const [reps, setReps] = useState(current?.reps ?? targetReps ?? exercise.repRange.minimum)
  const [rir, setRir] = useState<string>(String(current?.rir ?? 'unknown'))
  const [symptomState, setSymptomState] = useState<'none' | 'adverse_reported'>(current?.symptomState ?? 'none')
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>(current ? 'saved' : 'idle')
  const [error, setError] = useState('')

  async function save() {
    setError('')
    setState('saving')
    try {
      const side = exercise.progression?.side
      if (!side) throw new Error('Exercise side is unavailable. Refresh the session before logging.')
      const quantity = createLoadQuantity({ value, unit })
      const parsedRir = rir === 'unknown' || rir === '6_plus' ? rir : Number(rir)
      const ack = await saveTrainingSet({
        sessionId,
        setId,
        expectedRevision: revision,
        actual: {
          quantity,
          reps,
          rir: parsedRir as number | '6_plus' | 'unknown',
          side,
          symptomState,
          occurredAt: new Date().toISOString(),
        },
      })
      setState('saved')
      onSaved(ack)
    } catch (cause) {
      setState('idle')
      if (cause instanceof TrainingRevisionConflict) onConflict(cause)
      else setError(cause instanceof Error ? cause.message : 'Set could not be saved.')
    }
  }

  return <fieldset className={styles.setEditor}>
    <legend>Set {setIndex + 1}</legend>
    {targetReps !== undefined ? <p className="t-quiet">Target: {targetReps} reps</p> : null}
    <label>Load<input className="a-input" inputMode="decimal" value={value} onChange={event => { setValue(event.target.value); setState('idle') }} /></label>
    <label>Unit<select className="a-input" value={unit} onChange={event => { setUnit(event.target.value as LoadUnit); setState('idle') }}><option value="kg">kg</option><option value="lb">lb</option></select></label>
    <label>Reps<input className="a-input" type="number" min="0" max="100" value={reps} onChange={event => { setReps(Number(event.target.value)); setState('idle') }} /></label>
    <label>RIR<select className="a-input" value={rir} onChange={event => { setRir(event.target.value); setState('idle') }}>
      <option value="unknown">Not recorded</option><option value="6_plus">6+</option>{[5, 4, 3, 2, 1, 0].map(value => <option key={value} value={value}>{value}</option>)}
    </select></label>
    <label className={styles.symptomField}>During this set<select className="a-input" value={symptomState} onChange={event => { setSymptomState(event.target.value as 'none' | 'adverse_reported'); setState('idle') }}><option value="none">No adverse symptoms reported</option><option value="adverse_reported">Adverse symptoms reported</option></select></label>
    <button type="button" className="a-secondary" disabled={state === 'saving' || state === 'saved'} onClick={() => void save()}>{state === 'saving' ? current ? 'Correcting saved set…' : 'Saving set…' : state === 'saved' ? 'Set saved' : current ? 'Correct saved set' : 'Save set'}</button>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
  </fieldset>
}

function StrengthSession({ projection, update, conflict }: {
  projection: TrainingSessionProjection
  update: (ack: TrainingMutationAck) => void
  conflict: (cause: unknown) => void
}) {
  const prescription = projection.prescription
  if (!prescription || prescription.schemaVersion !== 'training-session-prescription.v1') return null
  const terminal = ['completed', 'completed_with_omissions', 'aborted'].includes(projection.session.state)
  return <div className={styles.sessionExercises}>
    {prescription.exercises.map((exercise, index) => {
      const exerciseLabel = projection.exerciseDisplay[exercise.exerciseInstanceId]?.label ?? 'Exercise name unavailable'
      return <Surface key={exercise.exerciseInstanceId} tier="tile" innerClassName={styles.sessionExercise}>
      <div className={styles.sectionHeading}>
        <div><p className="t-kicker">Exercise {String(index + 1).padStart(2, '0')}</p><h3 className="t-headline-sm">{exerciseLabel}</h3></div>
        <span className="t-quiet">Rest {exercise.restSeconds}s</span>
      </div>
      <p className="t-body">{projection.exerciseDisplay[exercise.exerciseInstanceId]?.textInstruction ?? 'Instructions are unavailable for this saved catalog version.'}</p>
      <p className="t-body">Prescribed: {loadLabel(exercise)} · {exercise.repRange.minimum}–{exercise.repRange.maximum} reps · RIR {exercise.targetRir.minimum}–{exercise.targetRir.maximum}</p>
      <div className={styles.setGrid}>
        {exercise.setIds.map((setId, setIndex) => {
          const current = projection.currentActuals.find(actual => actual.setId === setId)
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
          onSaved={update}
          onConflict={conflict}
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

function ConditioningSession({ projection, update, conflict }: {
  projection: TrainingSessionProjection
  update: (ack: TrainingMutationAck) => void
  conflict: (cause: unknown) => void
}) {
  const prescription = projection.prescription
  if (!prescription || prescription.schemaVersion !== 'training-conditioning-session-prescription.v1') return null
  const terminal = ['completed', 'completed_with_omissions', 'aborted'].includes(projection.session.state)
  if (terminal && !projection.currentConditioningActual) return <Surface tier="tile" innerClassName={styles.conditioningSession}>
    <p className="t-kicker">Conditioning</p>
    <h3 className="t-headline-sm">{projection.conditioningDisplay?.label ?? 'Conditioning name unavailable'}</h3>
    <p className="t-body">Not recorded</p><p className="t-quiet">Omitted when finished.</p>
  </Surface>
  return <ConditioningEditor
    key={projection.currentConditioningActual?.eventRevision ?? 0}
    projection={projection}
    prescription={prescription}
    update={update}
    conflict={conflict}
  />
}

function ConditioningEditor({ projection, prescription, update, conflict }: {
  projection: TrainingSessionProjection
  prescription: TrainingConditioningSessionPrescriptionV1
  update: (ack: TrainingMutationAck) => void
  conflict: (cause: unknown) => void
}) {
  const current = projection.currentConditioningActual
  const [minutes, setMinutes] = useState((current?.durationSeconds ?? prescription.acceptedBout.acceptedDurationSeconds) / 60)
  const [effort, setEffort] = useState<string>(String(current?.perceivedEffort ?? 'unknown'))
  const [symptomState, setSymptomState] = useState<'none' | 'adverse_reported'>(current?.symptomState ?? 'none')
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>(current ? 'saved' : 'idle')
  const [error, setError] = useState('')

  async function save() {
    setState('saving')
    setError('')
    try {
      const ack = await saveTrainingConditioning({
        sessionId: projection.session.id,
        expectedRevision: projection.session.revision,
        actual: {
          durationSeconds: Math.round(minutes * 60),
          perceivedEffort: effort === 'unknown' ? 'unknown' : Number(effort),
          symptomState,
          occurredAt: new Date().toISOString(),
        },
      })
      setState('saved')
      update(ack)
    } catch (cause) {
      setState('idle')
      if (cause instanceof TrainingRevisionConflict) conflict(cause)
      else setError(cause instanceof Error ? cause.message : 'Conditioning could not be saved.')
    }
  }

  return <Surface tier="tile" innerClassName={styles.conditioningSession}>
    <p className="t-kicker">Conditioning</p>
    <h3 className="t-headline-sm">{projection.conditioningDisplay?.label ?? 'Conditioning name unavailable'} · {prescription.acceptedBout.acceptedDurationSeconds / 60} minute starting target</h3>
    <p className="t-body">{projection.conditioningDisplay?.effortCue ?? 'Instructions are unavailable for this saved catalog version.'}</p>
    <div className={styles.conditioningFields}>
      <label>Actual duration in minutes<input className="a-input" type="number" min="0" max="1440" step="1" value={minutes} onChange={event => { setMinutes(Number(event.target.value)); setState('idle') }} /></label>
      <label>Perceived effort<select className="a-input" value={effort} onChange={event => { setEffort(event.target.value); setState('idle') }}><option value="unknown">Not recorded</option>{Array.from({ length: 11 }, (_, value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>During this bout<select className="a-input" value={symptomState} onChange={event => { setSymptomState(event.target.value as 'none' | 'adverse_reported'); setState('idle') }}><option value="none">No adverse symptoms reported</option><option value="adverse_reported">Adverse symptoms reported</option></select></label>
    </div>
    <button type="button" className="a-secondary" disabled={state === 'saving' || state === 'saved'} onClick={() => void save()}>{state === 'saving' ? current ? 'Correcting saved conditioning…' : 'Saving conditioning…' : state === 'saved' ? 'Conditioning saved' : current ? 'Correct saved conditioning' : 'Save conditioning'}</button>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
  </Surface>
}

export default function TrainingSessionPlayer({ sessionId }: { sessionId: string }) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

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
      setLoad({ status: 'ready', projection: cause.current })
      setMessage('Session changed elsewhere. Latest saved values are loaded; unsaved entries without a newer saved event remain visible.')
    }
  }

  function applyAck(ack: TrainingMutationAck) {
    setLoad(current => {
      if (current.status !== 'ready') return current
      const projection = current.projection
      const adverseReported = ack.event?.symptomState === 'adverse_reported'
        || ack.conditioningEvent?.symptomState === 'adverse_reported'
      if (ack.revision <= projection.session.revision) {
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

  async function finish(projection: TrainingSessionProjection) {
    const missing = missingActualCount(projection)
    setPending(true)
    setError('')
    try {
      const ack = await completeTrainingSession({
        sessionId,
        expectedRevision: projection.session.revision,
        finishMode: projection.session.stopped_for_symptoms ? 'abort' : missing > 0 ? 'finish_with_omissions' : 'complete',
      })
      applyAck(ack)
      setMessage(projection.session.stopped_for_symptoms
        ? 'Session stopped after adverse symptoms were reported.'
        : missing > 0 ? `Session finished with ${missing} omitted item${missing === 1 ? '' : 's'}.` : 'Session complete.')
    } catch (cause) {
      if (cause instanceof TrainingRevisionConflict) conflict(cause)
      else setError(cause instanceof Error ? cause.message : 'Session could not be finished.')
    } finally {
      setPending(false)
    }
  }

  if (load.status === 'loading') return <Surface tier="tile" innerClassName={styles.entryState}><p role="status">Loading training session…</p></Surface>
  if (load.status === 'error') return <Surface tier="tile" innerClassName={styles.entryState}><p role="alert">{load.message}</p><button className="a-secondary" onClick={() => void reload()}>Retry session</button></Surface>

  const projection = load.projection
  const practice = projection.executionContext.kind === 'synthetic_simulation'
  const terminal = ['completed', 'completed_with_omissions', 'aborted'].includes(projection.session.state)
  const missing = missingActualCount(projection)
  return <section className={styles.sessionPlayer} aria-labelledby="training-session-heading">
    {practice ? <div className={styles.practiceBanner}><strong>Practice data · Simulation</strong><span>This session belongs to the private sample workspace.</span></div> : null}
    <Surface tier="feature" innerClassName={styles.sessionHeader}>
      <div><p className="t-kicker">{projection.session.session_kind === 'strength' ? 'Strength session' : 'Conditioning session'}</p><h2 id="training-session-heading" className="t-headline-sm">{projection.session.scheduled_local_date}</h2></div>
      <div><span className="t-kicker">Session state</span><strong>{projection.session.state.replaceAll('_', ' ')}</strong></div>
    </Surface>
    {message ? <p role="status" className={styles.notice}>{message}</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {projection.session.stopped_for_symptoms ? <p role="alert" className={styles.error}>Adverse symptoms were reported. Do not continue this session until they have been addressed.</p> : null}
    {projection.session.state === 'scheduled'
      ? <button type="button" className="a-primary" disabled={pending} onClick={() => void start(projection)}>{pending ? 'Starting session…' : 'Start session'}</button>
      : null}
    {projection.session.state !== 'scheduled' && projection.session.session_kind === 'strength'
      ? <StrengthSession projection={projection} update={applyAck} conflict={conflict} /> : null}
    {projection.session.state !== 'scheduled' && projection.session.session_kind === 'conditioning'
      ? <ConditioningSession projection={projection} update={applyAck} conflict={conflict} /> : null}
    {projection.session.state === 'in_progress'
      ? <div className={styles.finishBar}><p className="t-body">Save actuals first. Finishing with missing items records omissions explicitly.</p><button type="button" className="a-primary" disabled={pending} onClick={() => void finish(projection)}>{pending ? 'Finishing…' : projection.session.stopped_for_symptoms ? 'Stop session' : missing > 0 ? `Finish with ${missing} omission${missing === 1 ? '' : 's'}` : 'Finish session'}</button></div>
      : terminal ? <p role="status" className={styles.accepted}>This session is {projection.session.state.replaceAll('_', ' ')}.</p> : null}
  </section>
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Surface } from '@/components/array/Surface'
import {
  createManualRoutine,
  createManualRoutineAttempt,
  ManualRoutineCreateError,
  resolveManualRoutineSubject,
  type ManualRoutineCreateAttempt,
} from './ManualRoutine.gateway'
import ManualRoutineEditor from './ManualRoutineEditor'
import ManualRoutineList from './ManualRoutineList'
import type { ManualRoutineExerciseChoice, ManualRoutinePageIdentity } from './ManualRoutine.types'
import styles from './ManualRoutines.module.css'

type Props = {
  identity: Exclude<ManualRoutinePageIdentity, { kind: 'unavailable' }>
  mode: 'list' | 'create'
  exercises?: ManualRoutineExerciseChoice[]
  availableExercises?: ManualRoutineExerciseChoice[]
}

type CreateAttemptOwner = Readonly<{ identityKey: string; subjectId: string }>

export default function ManualRoutineSubjectWorkspace({ identity, mode, exercises = [], availableExercises = [] }: Props) {
  const router = useRouter()
  const [clientId, setClientId] = useState('')
  const [subject, setSubject] = useState<{ id: string; name: string } | null>(identity.kind === 'athlete' ? { id: identity.subjectId, name: identity.name } : null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const pending = useRef<AbortController | null>(null)
  const createAttempt = useRef<ManualRoutineCreateAttempt | null>(null)
  const createAttemptOwner = useRef<CreateAttemptOwner | null>(null)
  const createInFlight = useRef<Promise<{ routineId: string }> | null>(null)
  const [createState, setCreateState] = useState<'idle' | 'submitting' | 'uncertain'>('idle')
  const [retryError, setRetryError] = useState<string | null>(null)
  const mounted = useRef(true)
  const identityKey = identity.kind === 'athlete' ? `athlete:${identity.subjectId}` : `practitioner:${identity.clients.map(client => client.id).join(',')}`
  const [initialIdentityKey] = useState(identityKey)
  const subjectId = subject?.id ?? null
  const currentIdentityKey = useRef(identityKey)
  const currentSubjectId = useRef(subjectId)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    currentIdentityKey.current = identityKey
    currentSubjectId.current = subjectId
  }, [identityKey, subjectId])

  async function selectClient(nextClientId: string) {
    pending.current?.abort()
    setRetryError(null)
    setClientId(nextClientId)
    setSubject(null)
    if (identity.kind === 'athlete' || !nextClientId) {
      setState('idle')
      return
    }
    const controller = new AbortController()
    pending.current = controller
    setState('loading')
    try {
      const subjectId = await resolveManualRoutineSubject(nextClientId, controller.signal)
      if (controller.signal.aborted) return
      setSubject({ id: subjectId, name: identity.clients.find(client => client.id === nextClientId)?.name ?? 'Selected athlete' })
      setState('idle')
    } catch {
      if (controller.signal.aborted) return
      setState('error')
    }
  }

  if (identityKey !== initialIdentityKey) {
    return <div className={styles.subjectWorkspace}>
      <Surface tier="tile" innerClassName={styles.empty}>
        <p role="alert" className={styles.error}>The signed-in training account changed. Return to manual routines before continuing.</p>
      </Surface>
    </div>
  }

  return <div className={styles.subjectWorkspace}>
    {identity.kind === 'practitioner' ? <Surface tier="tile" innerClassName={styles.subjectPicker}>
      <div><p className="t-kicker">Athlete</p><h2 className="t-title">Choose who this routine is for</h2></div>
      <label className={styles.field}>Client
        <select className="a-input" value={clientId} disabled={createState !== 'idle'} onChange={event => void selectClient(event.target.value)}>
          <option value="">Choose a connected client</option>
          {identity.clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
      </label>
      {identity.clients.length === 0 ? <p className="t-body">No connected athlete accounts are available. Set up an athlete account before saving a routine.</p> : null}
      {state === 'loading' ? <p role="status" className="t-quiet">Loading athlete access…</p> : null}
      {state === 'error' ? <p role="alert" className={styles.error}>This client is not connected to an active athlete training account.</p> : null}
    </Surface> : null}

    {subject && mode === 'list' ? <ManualRoutineList key={subject.id} subjectId={subject.id} /> : null}
    {subject && mode === 'create' ? <>
      <ManualRoutineEditor
        key={subject.id}
        exercises={exercises}
        availableExercises={availableExercises}
        disabled={createState !== 'idle'}
        onSave={input => {
          if (createInFlight.current) return createInFlight.current
          const attempt = createManualRoutineAttempt(subject.id, input)
          const owner = { identityKey: currentIdentityKey.current, subjectId: attempt.subjectId }
          createAttempt.current = attempt
          createAttemptOwner.current = owner
          setRetryError(null)
          setCreateState('submitting')
          const operation = (async () => {
            try {
              const routine = await createManualRoutine(attempt)
              createAttempt.current = null
              createAttemptOwner.current = null
              if (mounted.current) setCreateState('idle')
              if (mounted.current && currentIdentityKey.current === owner.identityKey && currentSubjectId.current === owner.subjectId) {
                router.push(`/workouts/manual/${encodeURIComponent(routine.routineId)}`)
              }
              return { routineId: routine.routineId }
            } catch (cause) {
              if (cause instanceof ManualRoutineCreateError && cause.uncertain) {
                if (mounted.current) setCreateState('uncertain')
              } else {
                createAttempt.current = null
                createAttemptOwner.current = null
                if (mounted.current) setCreateState('idle')
              }
              throw cause
            }
          })()
          createInFlight.current = operation
          const release = () => { if (createInFlight.current === operation) createInFlight.current = null }
          void operation.then(release, release)
          return operation
        }}
      />
      {createState === 'uncertain' ? <Surface tier="tile" innerClassName={styles.empty}>
        <p role="status" className="t-body">The save may already have completed. Keep this draft unchanged and retry the original save.</p>
        <button type="button" className="a-primary" onClick={() => {
          const attempt = createAttempt.current
          const owner = createAttemptOwner.current
          if (!attempt || !owner) return
          if (currentIdentityKey.current !== owner.identityKey || currentSubjectId.current !== owner.subjectId) {
            setRetryError('The signed-in training account changed. Return to manual routines before saving again.')
            return
          }
          if (createInFlight.current) return
          setRetryError(null)
          setCreateState('submitting')
          const operation = (async () => {
            try {
              const routine = await createManualRoutine(attempt)
              createAttempt.current = null
              createAttemptOwner.current = null
              if (mounted.current) setCreateState('idle')
              if (mounted.current && currentIdentityKey.current === owner.identityKey && currentSubjectId.current === owner.subjectId) {
                router.push(`/workouts/manual/${encodeURIComponent(routine.routineId)}`)
              }
              return { routineId: routine.routineId }
            } catch (cause) {
              if (!mounted.current) throw cause
              if (cause instanceof ManualRoutineCreateError && cause.uncertain) setCreateState('uncertain')
              else {
                createAttempt.current = null
                createAttemptOwner.current = null
                setRetryError(cause instanceof Error ? cause.message : 'Routine could not be saved.')
                setCreateState('idle')
              }
              throw cause
            }
          })()
          createInFlight.current = operation
          const release = () => { if (createInFlight.current === operation) createInFlight.current = null }
          void operation.then(release, release)
        }}>Retry original save</button>
      </Surface> : null}
      {retryError ? <p role="alert" className={styles.error}>{retryError}</p> : null}
    </> : null}
  </div>
}

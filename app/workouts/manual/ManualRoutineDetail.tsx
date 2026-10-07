'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Surface } from '@/components/array/Surface'
import { archiveManualRoutine, loadManualRoutine, ManualRoutineConflictError, updateManualRoutine } from './ManualRoutine.gateway'
import ManualRoutineEditor from './ManualRoutineEditor'
import ManualRoutinePlayer from './ManualRoutinePlayer'
import type { ManualRoutine, ManualRoutineExerciseChoice } from './ManualRoutine.types'
import styles from './ManualRoutines.module.css'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; routine: ManualRoutine }

export default function ManualRoutineDetail({ routineId, availableExercises }: { routineId: string; availableExercises: ManualRoutineExerciseChoice[] }) {
  const router = useRouter()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [editing, setEditing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [conflict, setConflict] = useState<ManualRoutine | null>(null)

  async function retry() {
    setState({ status: 'loading' })
    try { setState({ status: 'ready', routine: await loadManualRoutine(routineId) }) }
    catch (cause) { setState({ status: 'error', message: cause instanceof Error ? cause.message : 'Routine could not be loaded.' }) }
  }

  useEffect(() => {
    let active = true
    void loadManualRoutine(routineId)
      .then(routine => { if (active) setState({ status: 'ready', routine }) })
      .catch(cause => { if (active) setState({ status: 'error', message: cause instanceof Error ? cause.message : 'Routine could not be loaded.' }) })
    return () => { active = false }
  }, [routineId])

  if (state.status === 'loading') return <p role="status" className="t-footnote">Loading routine…</p>
  if (state.status === 'error') return <Surface tier="tile" innerClassName={styles.empty}><p role="alert">{state.message}</p><button type="button" className="a-secondary" onClick={() => void retry()}>Retry routine</button></Surface>
  const routine = state.routine

  async function archive() {
    setArchiving(true)
    setNotice(null)
    try {
      await archiveManualRoutine(routine)
      router.push('/workouts/manual')
      router.refresh()
    } catch (cause) {
      if (cause instanceof ManualRoutineConflictError) setConflict(cause.current)
      setNotice(cause instanceof Error ? cause.message : 'Routine could not be archived.')
      setArchiving(false)
    }
  }

  return <div className={styles.detail}>
    <div className={styles.detailActions}>
      {routine.status === 'active' ? <>
        <button type="button" className="a-secondary" onClick={() => { setEditing(value => !value); setNotice(null) }}>{editing ? 'Cancel editing' : 'Edit routine'}</button>
        <button type="button" className="a-secondary" disabled={archiving} onClick={() => void archive()}>{archiving ? 'Archiving…' : 'Archive routine'}</button>
      </> : null}
    </div>
    {notice ? <p role="alert" className={styles.error}>{notice}</p> : null}
    {conflict ? <button type="button" className="a-secondary" onClick={() => { setState({ status: 'ready', routine: conflict }); setConflict(null); setNotice(null); setEditing(false) }}>Load latest saved version</button> : null}
    {routine.status === 'archived' ? <p role="status" className={styles.notice}>This routine is archived and read-only.</p> : null}
    {editing ? <ManualRoutineEditor
      key={`${routine.routineId}:${routine.revision}`}
      exercises={[]}
      availableExercises={availableExercises}
      initialTitle={routine.title}
      initialItems={routine.items}
      saveLabel="Save changes"
      onSave={async input => {
        try {
          const updated = await updateManualRoutine(routine, input)
          setState({ status: 'ready', routine: updated })
          setEditing(false)
          return { routineId: updated.routineId }
        } catch (cause) {
          if (cause instanceof ManualRoutineConflictError) setConflict(cause.current)
          throw cause
        }
      }}
    /> : <ManualRoutinePlayer routine={routine} />}
  </div>
}

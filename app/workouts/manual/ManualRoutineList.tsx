'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Surface } from '@/components/array/Surface'
import { loadManualRoutines } from './ManualRoutine.gateway'
import type { ManualRoutineSummary } from './ManualRoutine.types'
import styles from './ManualRoutines.module.css'

type State =
  | { subjectId: string; status: 'loading' }
  | { subjectId: string; status: 'error'; message: string }
  | { subjectId: string; status: 'ready'; routines: ManualRoutineSummary[]; hasMore: boolean; nextCursor: string | null; pageStatus: 'idle' | 'loading' | 'error' }

function mergeRoutines(current: ManualRoutineSummary[], incoming: ManualRoutineSummary[]): ManualRoutineSummary[] {
  const next = [...current]
  for (const routine of incoming) {
    const index = next.findIndex(candidate => candidate.routineId === routine.routineId)
    if (index >= 0) next[index] = routine
    else next.push(routine)
  }
  return next
}

export default function ManualRoutineList({ subjectId }: { subjectId: string }) {
  const [state, setState] = useState<State>({ subjectId, status: 'loading' })
  const visibleState: State = state.subjectId === subjectId ? state : { subjectId, status: 'loading' }

  async function retry() {
    setState({ subjectId, status: 'loading' })
    try {
      const page = await loadManualRoutines(subjectId)
      setState({ subjectId, status: 'ready', ...page, pageStatus: 'idle' })
    } catch (cause) {
      setState({ subjectId, status: 'error', message: cause instanceof Error ? cause.message : 'Saved routines could not be loaded.' })
    }
  }

  useEffect(() => {
    let active = true
    void loadManualRoutines(subjectId)
      .then(page => { if (active) setState({ subjectId, status: 'ready', ...page, pageStatus: 'idle' }) })
      .catch(cause => { if (active) setState({ subjectId, status: 'error', message: cause instanceof Error ? cause.message : 'Saved routines could not be loaded.' }) })
    return () => { active = false }
  }, [subjectId])

  async function loadMore() {
    if (visibleState.status !== 'ready' || visibleState.pageStatus === 'loading' || !visibleState.nextCursor) return
    const cursor = visibleState.nextCursor
    setState({ ...visibleState, pageStatus: 'loading' })
    try {
      const page = await loadManualRoutines(subjectId, cursor)
      setState(current => current.subjectId === subjectId && current.status === 'ready'
        ? { ...current, routines: mergeRoutines(current.routines, page.routines), hasMore: page.hasMore, nextCursor: page.nextCursor, pageStatus: 'idle' }
        : current)
    } catch {
      setState(current => current.subjectId === subjectId && current.status === 'ready'
        ? { ...current, pageStatus: 'error' }
        : current)
    }
  }

  if (visibleState.status === 'loading') return <p role="status" className="t-quiet">Loading manual routines…</p>
  if (visibleState.status === 'error') return <Surface tier="tile" innerClassName={styles.empty}><p role="alert">{visibleState.message}</p><button type="button" className="a-secondary" onClick={() => void retry()}>Retry routines</button></Surface>
  if (visibleState.routines.length === 0) return <Surface tier="tile" innerClassName={styles.empty}>
    <h2 className="t-headline-sm">No manual routines yet</h2>
    <p className="t-body">Choose movements from the reference library and enter your own targets.</p>
    <Link className="a-primary" href="/exercises">Choose exercises</Link>
  </Surface>

  return <section className={styles.routineList} aria-labelledby="manual-routines-heading">
    <div className={styles.sectionHeading}><div><p className="t-kicker">Saved</p><h2 id="manual-routines-heading" className="t-headline-sm">Manual routines</h2></div><span className="t-quiet">{visibleState.routines.length} routine{visibleState.routines.length === 1 ? '' : 's'}</span></div>
    {visibleState.routines.map(routine => <Surface key={routine.routineId} tier="tile" innerClassName={styles.listCard}>
      <div><strong>{routine.title}</strong><p className="t-quiet">{routine.itemCount} exercise{routine.itemCount === 1 ? '' : 's'} · Updated {routine.updatedAt.slice(0, 10)}</p></div>
      <Link className="a-secondary" href={`/workouts/manual/${encodeURIComponent(routine.routineId)}`}>Open routine</Link>
    </Surface>)}
    {visibleState.pageStatus === 'error' ? <p role="alert" className={styles.error}>More routines could not be loaded. Try again.</p> : null}
    {visibleState.hasMore ? <button type="button" className="a-secondary" disabled={visibleState.pageStatus === 'loading'} onClick={() => void loadMore()}>{visibleState.pageStatus === 'loading' ? 'Loading more…' : visibleState.pageStatus === 'error' ? 'Retry loading more' : 'Load more routines'}</button> : null}
  </section>
}

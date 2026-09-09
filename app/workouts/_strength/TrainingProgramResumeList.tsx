'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Surface } from '@/components/array/Surface'
import { requestTrainingPrograms, type TrainingProgramListProjection } from './StrengthBuilder.gateway'
import styles from './StrengthProgramBuilder.module.css'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; value: TrainingProgramListProjection }

export default function TrainingProgramResumeList({
  subjectId,
  sessionHrefBase = '/workouts',
  programHrefBase = sessionHrefBase,
}: {
  subjectId: string
  sessionHrefBase?: '/workouts' | '/train'
  programHrefBase?: '/workouts' | '/train'
}) {
  const [state, setState] = useState<State>({ status: 'loading' })

  async function load() {
    setState({ status: 'loading' })
    try {
      setState({ status: 'ready', value: await requestTrainingPrograms(subjectId) })
    } catch (cause) {
      setState({ status: 'error', message: cause instanceof Error ? cause.message : 'Saved training programs could not be loaded.' })
    }
  }

  useEffect(() => {
    let active = true
    void requestTrainingPrograms(subjectId)
      .then(value => { if (active) setState({ status: 'ready', value }) })
      .catch(cause => {
        if (active) setState({ status: 'error', message: cause instanceof Error ? cause.message : 'Saved training programs could not be loaded.' })
      })
    return () => { active = false }
  }, [subjectId])

  if (state.status === 'loading') return <p role="status" className="t-quiet">Loading saved strength programs…</p>
  if (state.status === 'error') return <Surface tier="tile" innerClassName={styles.entryState}><p role="alert">{state.message}</p><button type="button" className="a-secondary" onClick={() => void load()}>Retry programs</button></Surface>
  if (state.value.programs.length === 0) return null

  return <section className={styles.resumeList} aria-labelledby="saved-strength-heading">
    <div className={styles.sectionHeading}>
      <div><p className="t-kicker">Saved training</p><h2 id="saved-strength-heading" className="t-headline-sm">Resume a session</h2></div>
      <span className="t-quiet">{state.value.programs.length} recent program{state.value.programs.length === 1 ? '' : 's'}</span>
    </div>
    {state.value.programs.map(program => {
      const resumable = program.sessions.filter(session => session.state === 'scheduled' || session.state === 'in_progress')
      return <Surface key={program.id} tier="tile" innerClassName={styles.resumeProgram}>
        <div>
          <p className="t-kicker">{program.simulation_run_id ? 'Practice data' : 'Training program'}</p>
          <strong>{program.status === 'active' ? 'Active program' : 'Ended program'}</strong>
          <p className="t-quiet">Created {program.created_at.slice(0, 10)} · {program.sessions.length} sessions</p>
        </div>
        <div className={styles.resumeSessions}>
          <Link className="a-secondary" href={`${programHrefBase}?training_program_id=${encodeURIComponent(program.id)}`}>View program</Link>
          {resumable.slice(0, 4).map(session => <Link key={session.id} className="a-secondary" href={`${sessionHrefBase}?training_session_id=${encodeURIComponent(session.id)}`}>
            {session.state === 'in_progress' ? 'Resume' : 'Open'} {session.session_kind} · {session.scheduled_local_date}
          </Link>)}
          {resumable.length === 0 ? <span className="t-quiet">No scheduled or in-progress sessions.</span> : null}
        </div>
      </Surface>
    })}
  </section>
}

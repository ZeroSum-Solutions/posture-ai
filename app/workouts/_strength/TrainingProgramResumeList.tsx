'use client'

import { useEffect, useState } from 'react'
import { Surface } from '@/components/array/Surface'
import { Button } from '@/components/ui'
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

  if (state.status === 'loading') return <p role="status" className="t-footnote">Loading saved strength programs…</p>
  if (state.status === 'error') return <Surface tier="tile" innerClassName={styles.entryState}><p role="alert">{state.message}</p><Button variant="secondary" size="sm" onClick={() => void load()}>Retry programs</Button></Surface>
  if (state.value.programs.length === 0) return null

  return <section className={styles.resumeList} aria-labelledby="saved-strength-heading">
    <div className={styles.sectionHeading}>
      <div><p className="t-overline">Saved training</p><h2 id="saved-strength-heading" className="t-title-2">Resume a session</h2></div>
      <span className="t-footnote">{state.value.programs.length} recent program{state.value.programs.length === 1 ? '' : 's'}</span>
    </div>
    {state.value.programs.map(program => {
      const resumable = program.sessions.filter(session => session.state === 'scheduled' || session.state === 'in_progress')
      return <Surface key={program.id} tier="tile" innerClassName={styles.resumeProgram}>
        <div>
          <p className="t-overline">{program.simulation_run_id ? 'Practice data' : 'Training program'}</p>
          <strong>{program.status === 'active' ? 'Active program' : 'Ended program'}</strong>
          <p className="t-footnote">Created {program.created_at.slice(0, 10)} · {program.sessions.length} sessions</p>
        </div>
        <div className={styles.resumeSessions}>
          <Button variant="secondary" size="sm" href={`${programHrefBase}?training_program_id=${encodeURIComponent(program.id)}`}>View program</Button>
          {resumable.slice(0, 4).map(session => <Button key={session.id} variant="secondary" size="sm" href={`${sessionHrefBase}?training_session_id=${encodeURIComponent(session.id)}`}>
            {session.state === 'in_progress' ? 'Resume' : 'Open'} {session.session_kind} · {session.scheduled_local_date}
          </Button>)}
          {resumable.length === 0 ? <span className="t-footnote">No scheduled or in-progress sessions.</span> : null}
        </div>
      </Surface>
    })}
  </section>
}

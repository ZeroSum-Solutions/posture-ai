'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Surface } from '@/components/array/Surface'
import { TabStrip, tabPanelProps } from '@/components/array/Tabs'
import type {
  TrainingProgramWorkspaceProjection,
  TrainingProgramWorkspaceSession,
  TrainingProgramWorkspaceView,
} from '@/lib/training/contracts/program-workspace'
import type { ConditioningRevisionAcceptanceV1 } from '@/lib/training/contracts/conditioning-revision'
import { requestTrainingProgramWorkspace } from './TrainingProgramWorkspace.gateway'
import TrainingExerciseSwapPanel from './TrainingExerciseSwapPanel'
import TrainingConditioningRevisionPanel from './TrainingConditioningRevisionPanel'
import styles from './TrainingProgramWorkspace.module.css'

type ViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; value: TrainingProgramWorkspaceProjection; loadingMore: boolean; moreError: string | null }

const views = [
  { value: 'today', label: 'Today' },
  { value: 'program', label: 'Program' },
  { value: 'history', label: 'History' },
] as const

function sessionHref(base: '/train' | '/workouts', sessionId: string): string {
  return `${base}?training_session_id=${encodeURIComponent(sessionId)}`
}

function loadBasisLabel(basis: string): string {
  if (basis === 'dumbbell_single_implement') return 'one dumbbell total'
  if (basis === 'dumbbell_per_hand') return 'per hand · two dumbbells'
  if (basis === 'barbell_total') return 'total on the bar'
  return 'machine stack'
}

function durationLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (minutes === 0) return `${remainder}s`
  return remainder === 0 ? `${minutes} min` : `${minutes} min ${remainder}s`
}

function stateLabel(state: TrainingProgramWorkspaceSession['state']): string {
  if (state === 'in_progress') return 'In progress'
  if (state === 'completed_with_omissions') return 'Finished with omissions'
  return state.charAt(0).toUpperCase() + state.slice(1)
}

type StrengthActualSet = Extract<TrainingProgramWorkspaceSession['actual'], { kind: 'strength' }>['sets'][number]

function SessionCard({
  session,
  hrefBase,
  onSwapAccepted,
}: {
  session: TrainingProgramWorkspaceSession
  hrefBase: '/train' | '/workouts'
  onSwapAccepted: (assignmentId: string, programRevisionNumber: number) => void
}) {
  const actualByExercise = new Map<string, StrengthActualSet[]>()
  if (session.actual.kind === 'strength') {
    for (const set of session.actual.sets) {
      actualByExercise.set(set.exerciseInstanceId, [...(actualByExercise.get(set.exerciseInstanceId) ?? []), set])
    }
  }
  return <Surface tier="tile" innerClassName={styles.sessionCard}>
    <header className={styles.sessionHeading}>
      <div>
        <p className="t-kicker">Week {session.weekNumber} · {session.scheduledLocalDate} · {session.kind}</p>
        <h3 className="t-headline-sm">{stateLabel(session.state)}</h3>
      </div>
      <Link className="a-secondary" href={sessionHref(hrefBase, session.sessionId)}>
        {session.state === 'in_progress' ? 'Resume session' : 'Open session'}
      </Link>
    </header>
    {session.stoppedForSymptoms ? <p className={styles.symptomNote}>Stopped after adverse symptoms were reported.</p> : null}
    <div className={styles.comparison}>
      <section aria-label="Planned">
        <h4>Planned</h4>
        {session.planned.kind === 'strength' ? <div className={styles.exerciseList}>
          {session.planned.exercises.map(exercise => {
            const quantity = exercise.load.quantity.entered
            return <div key={exercise.exerciseInstanceId} className={styles.exerciseRow}>
              <strong>{exercise.label ?? 'Exercise name unavailable'}</strong>
              {exercise.warmupSets?.map((warmup, index) => {
                const warmupQuantity = warmup.load.quantity.entered
                return <span key={warmup.setId}>Warm-up {index + 1}: {warmupQuantity.value} {warmupQuantity.unit} · {loadBasisLabel(warmup.load.basis)} · {warmup.targetReps} reps</span>
              })}
              <span>{exercise.setIds.length} working sets · {exercise.targetReps ? exercise.targetReps.join(', ') : `${exercise.repRange.minimum}–${exercise.repRange.maximum}`} reps</span>
              <span>{quantity.value} {quantity.unit} · {loadBasisLabel(exercise.load.basis)}{exercise.side && exercise.side !== 'not_applicable' ? ` · ${exercise.side}` : ''} · RIR {exercise.targetRir.minimum}–{exercise.targetRir.maximum}</span>
              {session.state === 'scheduled'
                ? <TrainingExerciseSwapPanel
                    sessionId={session.sessionId}
                    exerciseInstanceId={exercise.exerciseInstanceId}
                    onAccepted={onSwapAccepted}
                  />
                : null}
            </div>
          })}
        </div> : <div className={styles.exerciseRow}>
          <strong>{session.planned.label ?? 'Conditioning name unavailable'}</strong>
          <span>{durationLabel(session.planned.durationSeconds)}</span>
          <span>{session.planned.effortCue}</span>
        </div>}
      </section>
      <section aria-label="Recorded actual">
        <h4>Recorded actual</h4>
        {session.actual.kind === 'strength' ? <>
          <p className="t-quiet">{session.actual.recordedSetCount} of {session.actual.prescribedSetCount} prescribed working sets recorded{session.actual.omittedSetCount > 0 ? ` · ${session.actual.omittedSetCount} not recorded` : ''}.</p>
          {session.planned.kind === 'strength' ? <div className={styles.exerciseList}>{session.planned.exercises.map(exercise => {
            const sets = actualByExercise.get(exercise.exerciseInstanceId) ?? []
            return <div key={exercise.exerciseInstanceId} className={styles.exerciseRow}>
              <strong>{exercise.label ?? 'Exercise name unavailable'}</strong>
              {sets.length === 0 ? <span>Nothing recorded.</span> : sets.map(set => {
                const warmupIndex = exercise.warmupSets?.findIndex(warmup => warmup.setId === set.setId) ?? -1
                const setLabel = set.setKind === 'warmup' && warmupIndex >= 0
                  ? `Warm-up ${warmupIndex + 1}`
                  : set.setKind === 'working' ? `Set ${set.workingSetOrdinal}` : 'Additional set'
                return <span key={set.setId}>
                  {setLabel}: {set.quantity.entered.value} {set.quantity.entered.unit} · {set.reps} reps · RIR {set.rir === 'unknown' ? 'not recorded' : set.rir}{set.side !== 'not_applicable' ? ` · ${set.side}` : ''} · {set.symptomState === 'adverse_reported' ? 'adverse symptoms reported' : 'no adverse symptoms reported'}
                </span>
              })}
            </div>
          })}</div> : null}
        </> : session.actual.recorded ? <div className={styles.exerciseRow}>
          <strong>{durationLabel(session.actual.recorded.durationSeconds)}</strong>
          <span>Effort {session.actual.recorded.perceivedEffort === 'unknown' ? 'not recorded' : `${session.actual.recorded.perceivedEffort}/10`}</span>
          <span>{session.actual.recorded.symptomState === 'adverse_reported' ? 'Adverse symptoms reported' : 'No adverse symptoms reported'}</span>
        </div> : <p className="t-quiet">Nothing recorded.</p>}
      </section>
    </div>
  </Surface>
}

function emptyCopy(view: TrainingProgramWorkspaceView, focus: TrainingProgramWorkspaceProjection['focus']): string {
  if (view === 'history') return 'No finished sessions are recorded yet.'
  if (view === 'today' && focus === 'none') return 'No session is scheduled or in progress.'
  return 'No sessions are available in this view.'
}

type WorkspaceProps = {
  assignmentId: string
  sessionHrefBase?: '/train' | '/workouts'
  backHref?: '/train' | '/workouts'
}

export default function TrainingProgramWorkspace(props: WorkspaceProps) {
  return <TrainingProgramWorkspaceInstance key={props.assignmentId} {...props} />
}

function TrainingProgramWorkspaceInstance({
  assignmentId,
  sessionHrefBase = '/train',
  backHref = '/train',
}: {
  assignmentId: string
  sessionHrefBase?: '/train' | '/workouts'
  backHref?: '/train' | '/workouts'
}) {
  const requestVersions = useRef<Record<TrainingProgramWorkspaceView, number>>({ today: 0, program: 0, history: 0 })
  const [activeView, setActiveView] = useState<TrainingProgramWorkspaceView>('today')
  const [states, setStates] = useState<Partial<Record<TrainingProgramWorkspaceView, ViewState>>>({ today: { status: 'loading' } })
  const [conditioningConfirmation, setConditioningConfirmation] = useState<ConditioningRevisionAcceptanceV1 | null>(null)
  const state = states[activeView] ?? { status: 'loading' as const }

  async function load(view: TrainingProgramWorkspaceView) {
    const version = ++requestVersions.current[view]
    setStates(current => ({ ...current, [view]: { status: 'loading' } }))
    try {
      const value = await requestTrainingProgramWorkspace({ assignmentId, view })
      if (version !== requestVersions.current[view]) return
      setStates(current => ({ ...current, [view]: { status: 'ready', value, loadingMore: false, moreError: null } }))
    } catch (cause) {
      if (version !== requestVersions.current[view]) return
      setStates(current => ({ ...current, [view]: { status: 'error', message: cause instanceof Error ? cause.message : 'The training program could not be loaded.' } }))
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    const version = ++requestVersions.current[activeView]
    void requestTrainingProgramWorkspace({ assignmentId, view: activeView })
      .then(value => {
        if (!controller.signal.aborted && version === requestVersions.current[activeView]) setStates(current => ({ ...current, [activeView]: { status: 'ready', value, loadingMore: false, moreError: null } }))
      })
      .catch(cause => {
        if (!controller.signal.aborted && version === requestVersions.current[activeView]) setStates(current => ({ ...current, [activeView]: { status: 'error', message: cause instanceof Error ? cause.message : 'The training program could not be loaded.' } }))
      })
    return () => controller.abort()
  }, [activeView, assignmentId])

  async function loadMore() {
    if (state.status !== 'ready' || !state.value.nextCursor || state.loadingMore) return
    const cursor = state.value.nextCursor
    const version = requestVersions.current[activeView]
    setStates(current => ({ ...current, [activeView]: { ...state, loadingMore: true, moreError: null } }))
    try {
      const next = await requestTrainingProgramWorkspace({ assignmentId, view: activeView, cursor })
      if (version !== requestVersions.current[activeView]) return
      setStates(current => {
        const latest = current[activeView]
        if (!latest || latest.status !== 'ready') return current
        const byId = new Map(latest.value.sessions.map(session => [session.sessionId, session]))
        next.sessions.forEach(session => byId.set(session.sessionId, session))
        return { ...current, [activeView]: { status: 'ready', loadingMore: false, moreError: null, value: { ...next, sessions: [...byId.values()] } } }
      })
    } catch (cause) {
      if (version !== requestVersions.current[activeView]) return
      setStates(current => {
        const latest = current[activeView]
        return !latest || latest.status !== 'ready' ? current : {
          ...current,
          [activeView]: { ...latest, loadingMore: false, moreError: cause instanceof Error ? cause.message : 'More sessions could not be loaded.' },
        }
      })
    }
  }

  function refreshAfterSwap(acceptedAssignmentId: string) {
    if (acceptedAssignmentId === assignmentId) void load(activeView)
  }

  function refreshAfterConditioning(receipt: ConditioningRevisionAcceptanceV1) {
    if (receipt.assignmentId !== assignmentId) return
    setConditioningConfirmation(receipt)
    void load(activeView)
  }

  function changeView(view: TrainingProgramWorkspaceView) {
    setActiveView(view)
    if (!states[view]) setStates(current => ({ ...current, [view]: { status: 'loading' } }))
  }

  const assignment = Object.values(states).find((candidate): candidate is Extract<ViewState, { status: 'ready' }> => candidate?.status === 'ready')?.value.assignment
  return <section className={styles.workspace} aria-labelledby="training-program-heading">
    <header className={styles.workspaceHeader}>
      <div>
        <p className="t-kicker">{assignment?.executionContext.kind === 'synthetic_simulation' ? assignment.executionContext.label : 'Training program'}</p>
        <h2 id="training-program-heading" className="t-display-sm">{assignment ? `${assignment.cycleLengthWeeks}-week program` : 'Program workspace'}</h2>
        {assignment ? <p className="t-body">Cycle started {assignment.cycleStartLocalDate} · {assignment.programMode === 'coach_assigned' ? 'Coach assigned' : 'Self directed'}</p> : null}
      </div>
      <Link className="a-secondary" href={backHref}>Back to training</Link>
    </header>
    {assignment?.executionContext.kind === 'synthetic_simulation' ? <p className={styles.practiceBanner}><strong>{assignment.executionContext.label}</strong><span>This saved history belongs to the private practice workspace.</span></p> : null}
    <TabStrip idBase="training-program-workspace" options={views} value={activeView} onChange={changeView} label="Training program views" />
    {conditioningConfirmation ? <p role="status" aria-live="polite" className="t-body">
      Conditioning changes saved as program revision {conditioningConfirmation.programRevisionNumber}.
    </p> : null}
    <div {...tabPanelProps('training-program-workspace', activeView, true)} className={styles.panel}>
      {state.status === 'loading' ? <p role="status" className="t-quiet">Loading {activeView}…</p> : null}
      {state.status === 'error' ? <Surface tier="tile" innerClassName={styles.errorState}>
        <p role="alert">{state.message}</p><button type="button" className="a-secondary" onClick={() => void load(activeView)}>Retry {activeView}</button>
      </Surface> : null}
      {state.status === 'ready' ? <>
        {activeView === 'program' && state.value.assignment.status === 'active' ? <details>
          <summary className="a-secondary">Change conditioning activity or schedule</summary>
          <TrainingConditioningRevisionPanel assignmentId={assignmentId} onAccepted={refreshAfterConditioning} />
        </details> : null}
        {activeView === 'program' ? <p className="t-body">The accepted cycle schedule. Open any session to review or continue it.</p> : null}
        {activeView === 'history' ? <p className="t-body">Saved planned and recorded values from finished sessions.</p> : null}
        {activeView === 'today' ? <p className="t-body">{state.value.focus === 'in_progress' ? 'Continue the session already in progress.' : state.value.focus === 'today' ? 'Sessions scheduled for today.' : state.value.focus === 'next' ? 'Your next scheduled session.' : state.value.focus === 'most_recent' ? 'Your most recent finished session.' : 'No current session.'}</p> : null}
        <div className={styles.sessionList}>{state.value.sessions.map(session => (
          <SessionCard
            key={session.sessionId}
            session={session}
            hrefBase={sessionHrefBase}
            onSwapAccepted={refreshAfterSwap}
          />
        ))}</div>
        {state.value.sessions.length === 0 ? <p className="t-quiet">{emptyCopy(activeView, state.value.focus)}</p> : null}
        {state.value.nextCursor ? <button type="button" className="a-secondary" disabled={state.loadingMore} onClick={() => void loadMore()}>{state.loadingMore ? 'Loading more sessions…' : 'Load more sessions'}</button> : null}
        {state.moreError ? <p role="alert">{state.moreError}</p> : null}
      </> : null}
    </div>
  </section>
}

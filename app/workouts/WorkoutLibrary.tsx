'use client'

import type { OperationMode } from '@/lib/prototype/runtime'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Surface } from '@/components/array/Surface'
import type { SessionSnapshot } from '@/lib/workout/generateWorkoutSession'
import {
  DEFAULT_WORKOUT_PREFERENCES,
  removeWorkoutItem,
  type WorkoutPreferences,
  WORKOUT_GOALS,
} from '@/lib/workout/personalize'
import type { WorkoutBuilderSeed, WorkoutLibraryItem } from './WorkoutLibrary.model'
import StrengthBuilderLauncher, { type StrengthBuilderClient } from './_strength/StrengthBuilderLauncher'
import TrainingSessionPlayer from './_strength/TrainingSessionPlayer'
import styles from './WorkoutsPage.module.css'

type Draft = {
  assessmentId: string
  clientName: string
  name: string
  source: 'scan' | 'ai'
  preferences: WorkoutPreferences
  snapshot: SessionSnapshot
  notice: string
}

export default function WorkoutLibrary({
  initialLibrary,
  seed,
  loadError,
  strengthClients = [],
  trainingSessionId,
  operationMode,
}: {
  initialLibrary: WorkoutLibraryItem[]
  seed?: WorkoutBuilderSeed | null
  loadError?: string | null
  strengthClients?: readonly StrengthBuilderClient[]
  trainingSessionId?: string | null
  operationMode?: OperationMode
}) {
  const router = useRouter()
  const [library, setLibrary] = useState(initialLibrary)
  const [activeSeed, setActiveSeed] = useState(seed ?? null)
  const [preferences, setPreferences] = useState<WorkoutPreferences>(() => ({
    ...DEFAULT_WORKOUT_PREFERENCES,
    capability: seed?.capability ?? 'standard',
  }))
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [archiving, setArchiving] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function build(mode: 'scan' | 'ai', sourceSeed = activeSeed, sourcePreferences = preferences) {
    if (!sourceSeed || busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/workouts/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assessment_id: sourceSeed.assessmentId,
          preferences: sourcePreferences,
          mode,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Could not build this workout.')
      setDraft({
        assessmentId: sourceSeed.assessmentId,
        clientName: sourceSeed.clientName,
        name: body.name,
        source: body.source,
        preferences: sourcePreferences,
        snapshot: body.snapshot,
        notice: body.notice,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not build this workout.')
    } finally {
      setBusy(false)
    }
  }

  async function mint(input: Draft, start: boolean) {
    if (!input.name.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/workouts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          assessment_id: input.assessmentId,
          name: input.name.trim(),
          preferences: input.preferences,
          selected_slugs: input.snapshot.items.map((entry) => entry.slug),
          generation_source: input.source,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.session_id) throw new Error(body.error ?? 'Could not save this workout.')
      if (start) router.push(`/workouts/${body.session_id}`)
      else {
        setDraft(null)
        setMessage('Workout saved. Refresh to see it in the library.')
        router.refresh()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this workout.')
    } finally {
      setBusy(false)
    }
  }

  function prepareCopy(workout: WorkoutLibraryItem) {
    const nextSeed = {
      assessmentId: workout.assessmentId,
      clientId: workout.clientId,
      clientName: workout.clientName,
      capability: workout.preferences.capability,
      approved: true,
    }
    setActiveSeed(nextSeed)
    setPreferences(workout.preferences)
    setDraft(null)
    setMessage('Preferences copied. Build a fresh plan from the current assessment catalog.')
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function playAgain(workout: WorkoutLibraryItem) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const personalized = workout.name && workout.snapshot.items.length > 0
      const response = await fetch('/api/workouts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(personalized ? {
          assessment_id: workout.assessmentId,
          name: workout.name,
          preferences: workout.preferences,
          selected_slugs: workout.snapshot.items.map((entry) => entry.slug),
          generation_source: workout.source,
        } : { assessment_id: workout.assessmentId }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.session_id) throw new Error(body.error ?? 'Could not create a new workout copy.')
      router.push(`/workouts/${body.session_id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create a new workout copy.')
    } finally {
      setBusy(false)
    }
  }

  async function archive(workout: WorkoutLibraryItem) {
    if (archiving.has(workout.id)) return
    setError('')
    setArchiving((current) => new Set(current).add(workout.id))
    try {
      const response = await fetch(`/api/workouts/${workout.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error ?? 'Could not archive this workout.')
      }
      setLibrary((current) => current.filter((entry) => entry.id !== workout.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not archive this workout.')
    } finally {
      setArchiving((current) => {
        const next = new Set(current)
        next.delete(workout.id)
        return next
      })
    }
  }

  if (trainingSessionId) return (
    <div className={`app-screen ${styles.screen}`}>
      <header className={styles.header}>
        <div><p className="t-kicker">Training program</p><h1 className="t-headline">Session</h1></div>
        <Link href="/workouts" className="a-secondary">Back to workouts</Link>
      </header>
      <main className={`app-screen-x app-stack ${styles.main}`}>
        <TrainingSessionPlayer key={trainingSessionId} sessionId={trainingSessionId} />
      </main>
    </div>
  )

  return (
    <div className={`app-screen ${styles.screen}`}>
      <header className={styles.header}>
        <div>
          <p className="t-kicker">Movement plans</p>
          <h1 className="t-headline">Workouts</h1>
        </div>
        <nav aria-label="Workout tools" className={styles.actions}>
          <Link href="/workouts/manual" className="a-secondary">My routines</Link>
          <Link href="/exercises" className="a-secondary">Exercise library</Link>
        </nav>
      </header>

      <main className={`app-screen-x app-stack ${styles.main}`}>
        {loadError && <p role="alert" className={styles.error}>{loadError}</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {message && <p role="status" className={styles.notice}>{message}</p>}

        <StrengthBuilderLauncher operationMode={operationMode} clients={strengthClients} initialClientId={activeSeed?.clientId} />

        {activeSeed && (
          <section className={styles.builder} aria-labelledby="builder-heading">
            <Surface tier="feature">
              <div className={styles.stack}>
                <div>
                  <p className="t-kicker">Build for {activeSeed.clientName}</p>
                  <h2 id="builder-heading" className="t-headline-sm">Personalize a workout</h2>
                </div>
                <label>Focus
                  <select className="a-input" value={preferences.goal} disabled={busy} onChange={(event) => setPreferences({ ...preferences, goal: event.target.value as WorkoutPreferences['goal'] })}>
                    {Object.entries(WORKOUT_GOALS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label>Time available
                  <select className="a-input" value={preferences.minutes} disabled={busy} onChange={(event) => setPreferences({ ...preferences, minutes: Number(event.target.value) as WorkoutPreferences['minutes'] })}>
                    {[10, 15, 20].map((minutes) => <option key={minutes} value={minutes}>Up to {minutes} minutes</option>)}
                  </select>
                </label>
                <label>Movement level
                  <select className="a-input" value={preferences.capability} disabled={busy} onChange={(event) => setPreferences({ ...preferences, capability: event.target.value as WorkoutPreferences['capability'] })}>
                    <option value="regression">Gentle start</option><option value="standard">Everyday movement</option><option value="progression">More challenge</option>
                  </select>
                </label>
                <fieldset className={styles.fieldset}>
                  <legend>Available equipment</legend>
                  <p className="t-quiet">Floor space, a wall, and a chair are included.</p>
                  <div className={styles.actions}>{(['band', 'roller'] as const).map((equipment) => (
                    <button key={equipment} type="button" className={styles.chip} aria-pressed={preferences.equipment.includes(equipment)} onClick={() => setPreferences({ ...preferences, equipment: preferences.equipment.includes(equipment) ? preferences.equipment.filter((entry) => entry !== equipment) : [...preferences.equipment, equipment] })}>
                      {equipment === 'band' ? 'Resistance band' : 'Foam roller'}
                    </button>
                  ))}</div>
                </fieldset>
                <div className={styles.actions}>
                  <button className="a-primary" disabled={busy || !activeSeed.approved} onClick={() => void build('ai')}>{busy ? 'Building…' : 'Create with AI'}</button>
                  <button className="a-secondary" disabled={busy || !activeSeed.approved} onClick={() => void build('scan')}>Build from assessment</button>
                </div>
                {!activeSeed.approved && <p className="t-quiet">Approve the assessment before building a workout.</p>}
                <p className="t-quiet">AI may only select from movements admitted by the saved assessment and current authored catalog.</p>
              </div>
            </Surface>

            <Surface tier="tile">
              {draft ? <div className={styles.stack}>
                <div>
                  <p className="t-kicker">{draft.source === 'ai' ? 'AI personalized' : 'Assessment based'}</p>
                  <h2 className="t-headline-sm">Review before saving</h2>
                  <p className="t-quiet">{draft.notice}</p>
                </div>
                <label>Workout name<input className="a-input" maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
                <ol className={styles.items}>{draft.snapshot.items.map((item, index) => <li key={item.slug} className={styles.item}>
                  <span className={styles.number}>{String(index + 1).padStart(2, '0')}</span>
                  <div><strong>{item.name}</strong><p className="t-quiet">{item.stepLabel} · {item.priorityLabel}</p></div>
                  <button type="button" className={styles.remove} aria-label={`Remove ${item.name}`} disabled={draft.snapshot.items.length <= 1} onClick={() => setDraft({ ...draft, snapshot: removeWorkoutItem(draft.snapshot, item.slug) })}>×</button>
                </li>)}</ol>
                <p className="t-quiet">{draft.snapshot.items.length} movements · about {Math.max(1, Math.ceil(draft.snapshot.estimatedDurationSec / 60))} min</p>
                <div className={styles.actions}>
                  <button className="a-primary" disabled={busy} onClick={() => void mint(draft, true)}>Save &amp; start</button>
                  <button className="a-secondary" disabled={busy} onClick={() => void mint(draft, false)}>Save workout</button>
                  <button className="a-secondary" disabled={busy} onClick={() => setDraft(null)}>Discard</button>
                </div>
              </div> : <div className={styles.empty}><p className="t-kicker">Assessment → plan → movement</p><h2 className="t-headline-sm">Your draft appears here.</h2><p className="t-body">Choose the focus, time, level, and equipment. Review every movement before saving.</p></div>}
            </Surface>
          </section>
        )}

        <section className={styles.stack} aria-labelledby="saved-heading">
          <div className={styles.sectionHeader}><div><p className="t-kicker">Saved plans</p><h2 id="saved-heading" className="t-headline-sm">Workout library</h2></div><span className="t-quiet">{library.length} active</span></div>
          {library.length === 0 && <Surface tier="tile"><p className="t-body">Build a workout from an approved assessment to save it here.</p></Surface>}
          <div className={styles.library}>{library.map((workout) => (
            <Surface key={workout.id} tier="tile"><article className={styles.stack}>
              <div><p className="t-kicker">{workout.clientName} · {workout.source === 'ai' ? 'AI personalized' : 'Assessment based'}</p><h3 className="t-headline-sm">{workout.name}</h3></div>
              <p className="t-quiet">{workout.snapshot.items.length} movements · about {Math.max(1, Math.ceil(workout.snapshot.estimatedDurationSec / 60))} min · {workout.run?.status.replaceAll('_', ' ') ?? 'ready'}</p>
              {!workout.playable && <p className={styles.warning}>This saved plan uses an older catalog. Regenerate a copy to review current movements before playing.</p>}
              <div className={styles.actions}>
                {workout.playable && workout.run?.status !== 'completed' && <Link className="a-primary" href={`/workouts/${workout.id}`}>{workout.run ? 'Resume' : 'Start workout'}</Link>}
                {workout.playable && workout.run?.status === 'completed' && <button className="a-primary" disabled={busy} onClick={() => void playAgain(workout)}>Play again</button>}
                <button className="a-secondary" onClick={() => prepareCopy(workout)}>{workout.playable ? 'Edit a copy' : 'Regenerate copy'}</button>
                <button className="a-secondary" disabled={archiving.has(workout.id)} onClick={() => void archive(workout)}>{archiving.has(workout.id) ? 'Archiving…' : 'Archive'}</button>
              </div>
            </article></Surface>
          ))}</div>
        </section>
      </main>
    </div>
  )
}

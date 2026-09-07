'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Surface } from '@/components/array/Surface'
import { WorkoutPlayer, type RatingPayload, type RunPatch } from '@/app/workouts/_player/WorkoutPlayer'
import { createSampleScan, type DemoScan } from '@/lib/demo/scan'
import { loadDemoScan, saveDemoScan, DEMO_SCAN_EVENT } from '@/lib/demo/scan-store'
import { DEFAULT_WORKOUT_PREFERENCES, WORKOUT_GOALS, type WorkoutPreferences, withWorkoutItems, workoutSummary, workoutCandidates, selectWorkoutItems } from '@/lib/demo/workout'
import { clearDemoWorkouts, loadDemoWorkouts, saveDemoWorkouts, type DemoWorkout } from '@/lib/demo/workout-store'
import styles from './DemoWorkouts.module.css'

type Draft = DemoWorkout & { notice?: string }
export default function DemoWorkouts() {
  const [scan, setScan] = useState<DemoScan | null>(null)
  const [preferences, setPreferences] = useState<WorkoutPreferences>(DEFAULT_WORKOUT_PREFERENCES)
  const [library, setLibrary] = useState<DemoWorkout[]>([])
  const libraryRef = useRef<DemoWorkout[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [active, setActive] = useState<DemoWorkout | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [ready, setReady] = useState(false)
  const [storageCorrupt, setStorageCorrupt] = useState(false)

  useEffect(() => {
    const refresh = () => {
      try {
        let currentScan = loadDemoScan()
        if (!currentScan) { currentScan = createSampleScan(); saveDemoScan(currentScan) }
        setScan(currentScan)
        const stored = loadDemoWorkouts()
        libraryRef.current = stored
        setLibrary(stored)
      } catch (cause) { setStorageCorrupt(true); setError(cause instanceof Error ? cause.message : 'Local storage is unavailable.') }
      setReady(true)
    }
    refresh()
    window.addEventListener(DEMO_SCAN_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener(DEMO_SCAN_EVENT, refresh); window.removeEventListener('storage', refresh) }
  }, [])

  const persist = useCallback((next: DemoWorkout[]) => {
    try {
      saveDemoWorkouts(next)
      libraryRef.current = next
      setLibrary(next)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save on this device. Free browser storage and try again.')
      return false
    }
  }, [])

  const saveRun = useCallback((patch: RunPatch) => {
    if (!active) return
    persist(libraryRef.current.map((workout) => workout.id === active.id ? { ...workout, run: { ...workout.run, ...patch } } : workout))
  }, [active, persist])
  const submitRating = useCallback(async (rating: RatingPayload) => {
    if (!active) return { ok: false, error: 'Select a workout first.' }
    const ok = persist(libraryRef.current.map((workout) => workout.id === active.id ? { ...workout, rating } : workout))
    return { ok, error: ok ? undefined : 'Rating could not be saved. Please try again.' }
  }, [active, persist])

  async function generate(useAI: boolean) {
    if (!scan || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      let result
      if (useAI) {
        const response = await fetch('/api/demo/workouts/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(25_000), body: JSON.stringify({ findings: scan.result.findings, preferences }) })
        result = await response.json()
        if (!response.ok) throw new Error(result.error ?? 'AI is unavailable. Use Build from scan to continue.')
      } else {
        const candidates = workoutCandidates(scan.result.findings, preferences)
        if (!candidates) throw new Error('No supported movements match this scan and equipment. Try the sample scan or add available equipment.')
        const snapshot = selectWorkoutItems(candidates, preferences)
        result = { name: WORKOUT_GOALS[preferences.goal], source: 'scan', snapshot, summary: workoutSummary(snapshot), notice: 'Built from your scan findings using the authored movement library.' }
      }
      setDraft({ id: crypto.randomUUID(), name: result.name, scanId: scan.id, scanLabel: scan.label, createdAt: new Date().toISOString(), preferences: { ...preferences, equipment: [...preferences.equipment] }, ...result })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create a plan. Try Build from scan.') }
    finally { setBusy(false) }
  }

  function saveDraft(start: boolean) {
    if (!draft || !draft.name.trim()) { setError('Give your workout a name.'); return }
    const workout = { ...draft, name: draft.name.trim() }
    const next = [workout, ...libraryRef.current.filter((item) => item.id !== workout.id)]
    if (!persist(next)) return
    setMessage('Workout saved on this device.')
    setDraft(null)
    if (start) setActive(workout)
  }
  function launch(workout: DemoWorkout) {
    if (workout.run?.status === 'completed') {
      const fresh = { ...workout, run: undefined, rating: undefined }
      if (persist(libraryRef.current.map((item) => item.id === workout.id ? fresh : item))) setActive(fresh)
    } else setActive(workout)
  }
  function removeExercise(index: number) {
    if (!draft || draft.snapshot.items.length <= 1) return
    const snapshot = withWorkoutItems(draft.snapshot, draft.snapshot.items.filter((_, itemIndex) => index !== itemIndex))
    setDraft({ ...draft, snapshot, summary: workoutSummary(snapshot), run: undefined, rating: undefined })
  }
  function useSample() {
    try { const sample = createSampleScan(); saveDemoScan(sample); setScan(sample); setDraft(null); setError('') }
    catch { setError('Could not save the sample scan on this device.') }
  }

  if (active) return <>
    <WorkoutPlayer key={active.id} snapshot={active.snapshot} clientFirstName={null} allowNotes={false} voiceMode="browser"
      resume={active.run && active.run.status !== 'completed' ? { index: Math.min(active.run.current_item_index ?? 0, active.snapshot.items.length - 1), items: active.run.items, revision: active.run.revision } : null}
      saveRun={saveRun} submitRating={submitRating} onExit={() => { setActive(null); setError('') }} />
    {error && <div role="alert" className={styles.playerNotice}>{error}</div>}
  </>

  return <main className={styles.page}>
    <header className={styles.top}>
      <div><div className={styles.eyebrow}>Your movement studio</div><h1>A plan that starts<br />with you.</h1><p className={styles.muted}>Turn your scan findings into a workout you can make your own.</p></div>
      <div className={styles.actions}><Link className="a-secondary" href="/demo/scan">View scan</Link></div>
    </header>
    {error && <div className={styles.error} role="alert">{error}{storageCorrupt && <div className={styles.actions}><button className="a-secondary" onClick={() => { try { clearDemoWorkouts(); libraryRef.current = []; setLibrary([]); setStorageCorrupt(false); setError('') } catch { setError('Browser storage remains unavailable.') } }}>Reset local workout library</button></div>}</div>}
    {message && <p role="status" className={styles.notice}>{message}</p>}
    <div className={styles.grid}>
      <Surface tier="feature"><div className={styles.form}>
        <div><span className={styles.eyebrow}>01 · Make it personal</span><h2 className="t-headline-sm">Build your workout</h2><p className={styles.muted}>{scan?.label ?? 'Loading scan…'} · {scan?.source === 'capture' ? 'Your scan' : 'Sample scan'}</p>
          <div className={styles.chips}>{scan?.result.findings.filter((finding) => finding.reliable && (finding.zone === 'warning' || finding.zone === 'danger')).slice(0, 3).map((finding) => <span className={styles.chip} key={finding.key}>{finding.label}</span>)}</div>
          <button className={styles.remove} style={{ fontSize: 12, padding: '12px 0 0' }} disabled={busy} onClick={useSample}>Use sample scan</button>
        </div>
        <div><label htmlFor="workout-goal">What would you like to focus on?</label><select id="workout-goal" className="a-input" value={preferences.goal} disabled={busy} onChange={(event) => setPreferences({ ...preferences, goal: event.target.value as WorkoutPreferences['goal'] })}>{Object.entries(WORKOUT_GOALS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        <div><label htmlFor="workout-minutes">Time available</label><select id="workout-minutes" className="a-input" disabled={busy} value={preferences.minutes} onChange={(event) => setPreferences({ ...preferences, minutes: Number(event.target.value) as WorkoutPreferences['minutes'] })}>{[10, 15, 20].map((minutes) => <option key={minutes} value={minutes}>Up to {minutes} minutes</option>)}</select></div>
        <div><label htmlFor="workout-level">Movement level</label><select id="workout-level" className="a-input" disabled={busy} value={preferences.capability} onChange={(event) => setPreferences({ ...preferences, capability: event.target.value as WorkoutPreferences['capability'] })}><option value="regression">Gentle start</option><option value="standard">Everyday movement</option><option value="progression">More of a challenge</option></select></div>
        <div><p className="a-label">Available equipment</p><p className={styles.notice}>Floor space, a wall and a chair are included.</p><div className={styles.chips}>{(['band', 'roller'] as const).map((equipment) => <button disabled={busy} className={styles.chip} key={equipment} aria-pressed={preferences.equipment.includes(equipment)} onClick={() => setPreferences({ ...preferences, equipment: preferences.equipment.includes(equipment) ? preferences.equipment.filter((value) => value !== equipment) : [...preferences.equipment, equipment] })}>{equipment === 'band' ? 'Resistance band' : 'Foam roller'}</button>)}</div></div>
        <button className="a-primary a-primary--bar" onClick={() => void generate(true)} disabled={!ready || !scan || busy}>{busy ? 'Creating your workout…' : 'Create with AI'}</button>
        <button className="a-secondary" onClick={() => void generate(false)} disabled={!ready || !scan || busy}>Build from scan</button>
        <p className={styles.notice}>AI selects from movements matched to your scan. Preview your plan before you begin. Workouts and progress stay in this browser.</p>
      </div></Surface>
      <div className={styles.stack}>{draft ? <Surface tier="tile"><div className={styles.stack}>
        <div><span className={styles.eyebrow}>02 · Your plan, your pace</span><h2 className="t-headline-sm">{draft.source === 'ai' ? 'AI personalized' : 'Scan-based'} workout</h2><p className={styles.notice}>{draft.notice}</p></div>
        <div><label htmlFor="workout-name">Workout name</label><input id="workout-name" className="a-input" maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
        <p className={styles.muted}>{draft.snapshot.items.length} movements · About {Math.ceil(draft.snapshot.estimatedDurationSec / 60)} min · {draft.scanLabel}</p>
        <ol className={styles.items}>{draft.snapshot.items.map((item, index) => <li className={styles.item} key={item.slug}><span className={styles.number}>{String(index + 1).padStart(2, '0')}</span><div><h3>{item.name}</h3><span className={styles.eyebrow}>{item.stepLabel} · {item.timing.sets} × {item.timing.kind === 'hold' ? `${item.timing.secondsPerSet} sec` : `${item.timing.repsPerSet} reps`}</span><p className={styles.notice}>{item.priorityLabel}</p><details><summary className={styles.notice}>How to move</summary><p className={styles.muted}>{item.instructions}</p></details></div><button className={styles.remove} aria-label={`Remove ${item.name}`} disabled={draft.snapshot.items.length <= 1} onClick={() => removeExercise(index)}>×</button></li>)}</ol>
        <div className={styles.actions}><button className="a-primary" onClick={() => saveDraft(true)}>Save & start</button><button className="a-secondary" onClick={() => saveDraft(false)}>Save workout</button><button className="a-secondary" onClick={() => setDraft(null)}>Discard</button></div>
      </div></Surface> : <Surface tier="tile"><div className={styles.stack}><span className={styles.eyebrow}>Scan → plan → movement</span><h2 className="t-headline-sm">Small steps. A clear direction.</h2><p className={styles.muted}>Choose your focus, time and equipment. Your plan will appear here with the movements, timing and scan findings behind every selection.</p><p className={styles.notice}>Then save it, press play and follow the guided session. Pause whenever you need; your exercise progress is saved for your return.</p></div></Surface>}</div>
    </div>
    <section className={styles.stack} aria-labelledby="library-heading"><div className={styles.top}><div><span className={styles.eyebrow}>Made for you</span><h2 id="library-heading" className="t-headline">Your workouts</h2></div><p className={styles.notice}>{library.filter((workout) => workout.run?.status === 'completed').length} completed · {library.length} saved</p></div>
      {!library.length && <p className={styles.muted}>Your first workout starts above. Saved plans will be ready here whenever you are.</p>}
      <div className={styles.library}>{library.map((workout) => <Surface key={workout.id} tier="tile"><div className={styles.stack}><span className={styles.eyebrow}>{workout.source === 'ai' ? 'AI personalized' : 'Scan-based'} · {workout.run?.status === 'completed' ? 'Completed' : workout.run ? 'In progress' : 'Ready to begin'}</span><h3 className="t-headline-sm">{workout.name}</h3><p className={styles.notice}>{workout.scanLabel} · {workout.snapshot.items.length} movements · {Math.ceil(workout.snapshot.estimatedDurationSec / 60)} min</p>{workout.run && <p className={styles.notice}>{workout.run.items?.filter((item) => item.completed).length ?? 0} of {workout.snapshot.items.length} movements completed{workout.rating?.clarity ? ` · Clarity ${workout.rating.clarity}/5` : ''}</p>}<div className={styles.actions}><button className="a-primary" onClick={() => launch(workout)}>{workout.run?.status === 'completed' ? 'Play again' : workout.run ? 'Resume' : 'Start workout'}</button><button className="a-secondary" onClick={() => { setDraft({ ...workout, id: crypto.randomUUID(), name: `${workout.name.slice(0, 70)} (copy)`, run: undefined, rating: undefined, createdAt: new Date().toISOString() }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Edit a copy</button><button className="a-secondary" onClick={() => persist(libraryRef.current.filter((item) => item.id !== workout.id))}>Delete</button></div></div></Surface>)}</div>
    </section>
  </main>
}

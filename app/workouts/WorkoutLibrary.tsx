'use client'

import type { OperationMode } from '@/lib/prototype/runtime'

import { useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Icon from '@/components/array/Icon'
import { Surface } from '@/components/array/Surface'
import {
  ActionBar,
  Banner,
  Button,
  ChipRow,
  EmptyState,
  FilterChip,
  IconButton,
  Select,
  Sheet,
  TextField,
  TopBar,
} from '@/components/ui'
import type { SessionSnapshot } from '@/lib/workout/generateWorkoutSession'
import { relativeDay } from '@/lib/time/relative'
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

const PAGE_SIZE = 15
const ATTENTION_PREVIEW = 3
const BUILD_SECTION_ID = 'workouts-build'

function scrollToBuildSection() {
  document.getElementById(BUILD_SECTION_ID)?.scrollIntoView({ behavior: 'smooth' })
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
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [menuWorkout, setMenuWorkout] = useState<WorkoutLibraryItem | null>(null)
  const [now] = useState(() => Date.now())
  const [whyOpen, setWhyOpen] = useState(false)
  const [showAllAttention, setShowAllAttention] = useState(false)

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
    setMenuWorkout(null)
    scrollToBuildSection()
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
      setMenuWorkout((current) => (current?.id === workout.id ? null : current))
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
      <TopBar title="Session" subtitle="Training program" back={{ href: '/workouts', label: 'Back to workouts' }} />
      <div className={`app-screen-x app-stack ${styles.main}`}>
        <TrainingSessionPlayer key={trainingSessionId} sessionId={trainingSessionId} />
      </div>
    </div>
  )

  const attentionLibrary = library.filter((workout) => !workout.playable)
  const readyLibrary = library.filter((workout) => workout.playable)
  const visibleReady = readyLibrary.slice(0, visibleCount)
  const hasMore = readyLibrary.length > visibleReady.length
  const visibleAttention = showAllAttention ? attentionLibrary : attentionLibrary.slice(0, ATTENTION_PREVIEW)

  return (
    <div className={`app-screen ${styles.screen} ${activeSeed && draft ? 'app-screen--bar' : ''}`}>
      <TopBar
        title="Workouts"
        subtitle={library.length > 0 ? `${library.length} saved · ${readyLibrary.length} ready to play` : undefined}
        actions={
          <IconButton
            icon="magnifer-linear"
            label="Exercise and muscle library"
            onClick={() => router.push('/exercises')}
          />
        }
      />
      <div className={`app-screen-x ${styles.main}`}>
        {loadError && <Banner variant="error">{loadError}</Banner>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {message && <p role="status" className={styles.notice}>{message}</p>}

        <section className={styles.saved} aria-labelledby="saved-heading">
          <header className={styles.sectionHeadRow}>
            <div className={styles.sectionHead}>
              <p className="t-micro">Saved plans</p>
              <h2 id="saved-heading" className="t-headline">Workout library</h2>
            </div>
          </header>

          {library.length === 0 ? (
            <EmptyState
              variant="inline"
              icon="dumbbell-small-linear"
              title="No saved workouts yet"
              body="Build a workout from an approved assessment to save it here."
              primary={{ label: 'New workout', onPress: scrollToBuildSection }}
            />
          ) : null}

          {readyLibrary.length > 0 ? (
            <>
              <ul className={styles.rows} aria-label="Saved workouts">
                {visibleReady.map((workout, index) => {
                  const total = workout.snapshot.items.length
                  const completed = workout.run?.status === 'completed'
                  const statusLabel = completed
                    ? 'Completed'
                    : workout.run
                      ? `In progress · ${workout.run.completedItems} done`
                      : 'Ready'
                  const dateLabel = relativeDay(workout.createdAt, now)
                  const fraction = completed ? 1 : workout.run && total > 0 ? workout.run.completedItems / total : 0
                  return (
                    <li key={workout.id} className={styles.row} style={{ '--i': Math.min(index, 8) } as CSSProperties}>
                      <div className={styles.rowText}>
                        <span className={styles.rowTitle}>{workout.name}</span>
                        <span className={styles.rowMeta}>
                          {workout.clientName}{dateLabel ? ` · Saved ${dateLabel.toLowerCase()}` : ''}
                        </span>
                        <span className={styles.rowStatus} data-state={completed ? 'done' : workout.run ? 'active' : 'ready'}>
                          {statusLabel}{total > 0 ? ` · ${total} movements` : ''}
                        </span>
                      </div>
                      <div className={styles.rowActions}>
                        {!completed ? (
                          <Link href={`/workouts/${workout.id}`} className={styles.runButton} aria-label={workout.run ? 'Resume' : 'Start workout'}>
                            <RunGlyph fraction={fraction} completed={false} started={workout.run != null} />
                          </Link>
                        ) : (
                          <button type="button" className={styles.runButton} aria-label="Play again" aria-busy={busy || undefined} disabled={busy} onClick={() => void playAgain(workout)}>
                            <RunGlyph fraction={1} completed started />
                          </button>
                        )}
                        <IconButton
                          icon="menu-dots-linear"
                          label={`More actions for ${workout.name}`}
                          onClick={() => setMenuWorkout(workout)}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
              {hasMore ? (
                <Button variant="tertiary" chevron onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>Show more</Button>
              ) : null}
            </>
          ) : null}

          {attentionLibrary.length > 0 ? (
            <div className={styles.attention}>
              <div className={styles.attentionHead}>
                <p className={styles.attentionLine}>
                  <span className={styles.attentionCount}>{attentionLibrary.length}</span>
                  <span>{attentionLibrary.length === 1 ? 'This saved plan uses an older catalog.' : 'These saved plans use an older catalog.'}</span>
                </p>
                <Button variant="tertiary" size="sm" onClick={() => setWhyOpen(true)}>Why?</Button>
              </div>
              {readyLibrary.length === 0 ? (
                <div className={styles.attentionStep}>
                  <Button variant="secondary" size="sm" icon="refresh-linear" onClick={() => prepareCopy(attentionLibrary[0])}>
                    {attentionLibrary.length === 1 ? 'Update this plan' : 'Update newest plan'}
                  </Button>
                </div>
              ) : null}
              <ul className={styles.rows} aria-label="Plans that need a fresh copy">
                {visibleAttention.map((workout, index) => {
                  const dateLabel = relativeDay(workout.createdAt, now)
                  const runLabel = workout.run?.status === 'completed'
                    ? 'Completed'
                    : workout.run ? 'In progress' : 'Not started'
                  return (
                    <li key={workout.id} className={styles.row} data-stale="true" style={{ '--i': Math.min(index, 8) } as CSSProperties}>
                      <div className={styles.rowText}>
                        <span className={styles.rowTitle}>{workout.name}</span>
                        <span className={styles.rowMeta}>
                          {workout.clientName}{dateLabel ? ` · Saved ${dateLabel.toLowerCase()}` : ''}
                        </span>
                        <span className={styles.rowStatus}>
                          {runLabel} · {workout.preferences.minutes} min · {WORKOUT_GOALS[workout.preferences.goal] ?? 'Workout'}
                        </span>
                      </div>
                      <div className={styles.rowActions}>
                        <button type="button" className={`${styles.runButton} ${styles.staleGlyph}`} aria-label="Update plan" title="Update plan" onClick={() => prepareCopy(workout)}>
                          <Icon name="refresh-linear" size={18} />
                        </button>
                        <IconButton
                          icon="menu-dots-linear"
                          label={`More actions for ${workout.name}`}
                          onClick={() => setMenuWorkout(workout)}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
              {attentionLibrary.length > ATTENTION_PREVIEW ? (
                <Button variant="tertiary" chevron aria-expanded={showAllAttention} onClick={() => setShowAllAttention((open) => !open)}>
                  {showAllAttention ? 'Show fewer' : `Show all ${attentionLibrary.length}`}
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>

        <section id={BUILD_SECTION_ID} className={styles.build} aria-label="Build a workout">
          <header className={styles.sectionHead}>
            <p className="t-micro">Build</p>
            <h2 className="t-headline">Strength program</h2>
          </header>
          <StrengthBuilderLauncher operationMode={operationMode} clients={strengthClients} initialClientId={activeSeed?.clientId} />

          {activeSeed && (
            <section className={styles.builder} aria-labelledby="builder-heading">
              <Surface tier="feature">
                <div className={styles.stack}>
                  <div className={styles.cardHead}>
                    <p className="t-micro">Build for {activeSeed.clientName}</p>
                    <h2 id="builder-heading" className="t-title">Personalize a workout</h2>
                  </div>
                  <Select label="Focus" value={preferences.goal} disabled={busy} onChange={(event) => setPreferences({ ...preferences, goal: event.target.value as WorkoutPreferences['goal'] })}>
                    {Object.entries(WORKOUT_GOALS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </Select>
                  <div className={styles.fieldPair}>
                    <Select label="Time available" value={preferences.minutes} disabled={busy} onChange={(event) => setPreferences({ ...preferences, minutes: Number(event.target.value) as WorkoutPreferences['minutes'] })}>
                      {[10, 15, 20].map((minutes) => <option key={minutes} value={minutes}>Up to {minutes} minutes</option>)}
                    </Select>
                    <Select label="Movement level" value={preferences.capability} disabled={busy} onChange={(event) => setPreferences({ ...preferences, capability: event.target.value as WorkoutPreferences['capability'] })}>
                      <option value="regression">Gentle start</option><option value="standard">Everyday movement</option><option value="progression">More challenge</option>
                    </Select>
                  </div>
                  <fieldset className={styles.fieldset}>
                    <legend>Available equipment</legend>
                    <p className="t-label">Floor space, a wall, and a chair are included.</p>
                    <ChipRow label="Available equipment">
                      {(['band', 'roller'] as const).map((equipment) => (
                        <FilterChip
                          key={equipment}
                          label={equipment === 'band' ? 'Resistance band' : 'Foam roller'}
                          selected={preferences.equipment.includes(equipment)}
                          onToggle={() => setPreferences({ ...preferences, equipment: preferences.equipment.includes(equipment) ? preferences.equipment.filter((entry) => entry !== equipment) : [...preferences.equipment, equipment] })}
                        />
                      ))}
                    </ChipRow>
                  </fieldset>
                  <div className={styles.actions}>
                    <Button
                      variant={draft ? 'secondary' : 'primary'}
                      loading={busy}
                      disabledReason={!activeSeed.approved ? 'Approve the assessment before building a workout.' : undefined}
                      onClick={() => void build('ai')}
                    >Create with AI</Button>
                    <Button
                      variant="secondary"
                      loading={busy}
                      disabledReason={!activeSeed.approved ? 'Approve the assessment before building a workout.' : undefined}
                      onClick={() => void build('scan')}
                    >Build from assessment</Button>
                  </div>
                  <p className="t-label">AI may only select from movements admitted by the saved assessment and current authored catalog.</p>
                </div>
              </Surface>

              <div className={styles.draft}>
                {draft ? <div className={styles.stack}>
                  <div className={styles.cardHead}>
                    <p className="t-micro">{draft.source === 'ai' ? 'AI personalized' : 'Assessment based'}</p>
                    <h2 className="t-headline">Review before saving</h2>
                    <p className="t-label">{draft.notice}</p>
                  </div>
                  <TextField label="Workout name" maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                  <p className={styles.draftDose}>
                    <span className={styles.draftDoseValue}>{draft.snapshot.items.length}</span> movements
                    <span className={styles.draftDoseValue}>{Math.max(1, Math.ceil(draft.snapshot.estimatedDurationSec / 60))}</span> min
                  </p>
                  <ol className={styles.draftList} aria-label="Movements in this draft">
                    {draft.snapshot.items.map((item, index) => (
                      <li key={item.slug} className={styles.draftRow} style={{ '--i': Math.min(index, 8) } as CSSProperties}>
                        <span className={styles.draftIndex} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                        <span className={styles.draftText}>
                          <span className={styles.draftName}>{item.name}</span>
                          <span className="t-label">{item.stepLabel} · {item.priorityLabel}</span>
                        </span>
                        <IconButton
                          icon="minus-circle-linear"
                          label={`Remove ${item.name}`}
                          disabledReason={draft.snapshot.items.length <= 1 ? 'At least one movement is required.' : undefined}
                          onClick={() => setDraft({ ...draft, snapshot: removeWorkoutItem(draft.snapshot, item.slug) })}
                        />
                      </li>
                    ))}
                  </ol>
                  <div className={styles.actions}>
                    <Button variant="tertiary" loading={busy} onClick={() => setDraft(null)}>Discard</Button>
                  </div>
                </div> : <div className={styles.empty}>
                  <p className="t-micro">Assessment → plan → movement</p>
                  <h2 className="t-headline">Your draft appears here.</h2>
                  <p className="t-callout">Choose the focus, time, level, and equipment. Review every movement before saving.</p>
                </div>}
              </div>
            </section>
          )}
        </section>

        <nav className={styles.libraries} aria-label="Libraries">
          <Link href="/exercises" className={styles.libraryLink}>
            <span className={styles.libraryText}>
              <span className="t-micro">Library</span>
              <span className={styles.libraryTitle}>Exercises</span>
            </span>
            <Icon name="alt-arrow-right-linear" size={20} />
          </Link>
          <Link href="/muscles" className={styles.libraryLink}>
            <span className={styles.libraryText}>
              <span className="t-micro">Guide</span>
              <span className={styles.libraryTitle}>Muscles</span>
            </span>
            <Icon name="alt-arrow-right-linear" size={20} />
          </Link>
        </nav>
      </div>

      {activeSeed && draft ? (
        <ActionBar>
          <Button block loading={busy} onClick={() => void mint(draft, true)}>Save &amp; start</Button>
          <Button variant="secondary" loading={busy} onClick={() => void mint(draft, false)}>Save workout</Button>
        </ActionBar>
      ) : null}

      <Sheet
        open={menuWorkout != null}
        onOpenChange={(open) => { if (!open) setMenuWorkout(null) }}
        title={menuWorkout?.name ?? 'Workout'}
        detents={['compact']}
        footer={menuWorkout ? (
          <div className={styles.actions}>
            <Button block onClick={() => prepareCopy(menuWorkout)}>Edit a copy</Button>
            <Button variant="secondary" block loading={archiving.has(menuWorkout.id)} onClick={() => void archive(menuWorkout)}>
              {archiving.has(menuWorkout.id) ? 'Archiving…' : 'Archive'}
            </Button>
          </div>
        ) : null}
      >
        <p className="t-body">{menuWorkout?.clientName}</p>
      </Sheet>

      <Sheet open={whyOpen} onOpenChange={setWhyOpen} title="Why a fresh copy?" detents={['compact']}>
        <p className="t-body">
          A saved plan keeps the movement catalog it was built from. When that catalog changes, regenerate a copy to review the current movements before playing. The original stays in your library until you archive it.
        </p>
      </Sheet>
    </div>
  )
}

/** Run state at a glance: an empty ring (ready), a partial arc (in progress), a filled check (done). */
function RunGlyph({ fraction, completed, started }: { fraction: number; completed: boolean; started: boolean }) {
  const r = 17
  const c = 2 * Math.PI * r
  return (
    <span className={styles.runGlyph} data-state={completed ? 'done' : started ? 'active' : 'ready'} aria-hidden="true">
      <svg viewBox="0 0 40 40" width="44" height="44">
        <circle cx="20" cy="20" r={r} fill="none" className={styles.runTrack} strokeWidth="2.5" />
        {fraction > 0 ? (
          <circle
            cx="20" cy="20" r={r} fill="none" className={styles.runArc} strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0.04, fraction))}
            transform="rotate(-90 20 20)"
          />
        ) : null}
      </svg>
      <span className={styles.runIcon}>
        {completed ? <Icon name="refresh-linear" size={16} /> : <PlayMark />}
      </span>
    </span>
  )
}

function PlayMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4.8v14.4a1 1 0 0 0 1.52.85l11.5-7.2a1 1 0 0 0 0-1.7L8.52 3.95A1 1 0 0 0 7 4.8Z" fill="currentColor" />
    </svg>
  )
}

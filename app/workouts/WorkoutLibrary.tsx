'use client'

import type { OperationMode } from '@/lib/prototype/runtime'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Icon from '@/components/array/Icon'
import { Surface } from '@/components/array/Surface'
import {
  ActionBar,
  Badge,
  Button,
  ChipRow,
  EmptyState,
  FilterChip,
  IconButton,
  ListGroup,
  ListRow,
  SegmentedControl,
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

type HubTab = 'saved' | 'builder' | 'library'

const PAGE_SIZE = 15

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
  const [tab, setTab] = useState<HubTab>(seed ? 'builder' : 'saved')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [menuWorkout, setMenuWorkout] = useState<WorkoutLibraryItem | null>(null)
  const [now] = useState(() => Date.now())

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
    setTab('builder')
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

  return (
    <div className={`app-screen ${styles.screen}`}>
      <TopBar title="Workouts" />
      <div className={`app-screen-x app-stack ${styles.main}`}>
        {loadError && <p role="alert" className={styles.error}>{loadError}</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {message && <p role="status" className={styles.notice}>{message}</p>}

        <SegmentedControl
          label="Workouts view"
          value={tab}
          onChange={(value) => {
            if (value === 'library') { router.push('/exercises'); return }
            setTab(value)
          }}
          options={[
            { value: 'saved', label: 'Saved' },
            { value: 'builder', label: 'Builder' },
            { value: 'library', label: 'Library' },
          ]}
        />

        {tab === 'saved' ? (
          <section className={styles.stack} aria-labelledby="saved-heading">
            <div className={styles.sectionHeader}>
              <div>
                <p className="t-overline">Saved plans</p>
                <h2 id="saved-heading" className="t-title-2">Workout library</h2>
              </div>
              <span className="t-footnote">{library.length} active</span>
            </div>

            {attentionLibrary.map((workout) => (
              <Surface key={workout.id} tier="tile" innerClassName={styles.attentionCard}>
                <div>
                  <p className="t-overline">{workout.clientName}</p>
                  <h3 className="t-headline">{workout.name}</h3>
                  <p className={styles.warning}>This saved plan uses an older catalog. Regenerate a copy to review current movements before playing.</p>
                </div>
                <div className={styles.actions}>
                  <Button onClick={() => prepareCopy(workout)}>Regenerate copy</Button>
                  <Button variant="secondary" loading={archiving.has(workout.id)} onClick={() => void archive(workout)}>
                    {archiving.has(workout.id) ? 'Archiving…' : 'Archive'}
                  </Button>
                </div>
              </Surface>
            ))}

            {library.length === 0 ? (
              <EmptyState
                icon="dumbbell-small-linear"
                title="No saved workouts yet"
                body="Build a workout from an approved assessment to save it here."
                primary={{ label: 'New workout', onPress: () => setTab('builder') }}
              />
            ) : readyLibrary.length === 0 ? null : (
              <>
                <ListGroup label="Saved workouts">
                  {visibleReady.map((workout) => {
                    const statusLabel = workout.run?.status === 'completed'
                      ? 'Completed'
                      : workout.run
                        ? `In progress · ${workout.run.completedItems} done`
                        : 'Ready'
                    const dateLabel = relativeDay(workout.createdAt, now)
                    return (
                      <ListRow
                        key={workout.id}
                        leading={<span className={styles.rowIcon}><Icon name="dumbbell-small-linear" size={20} /></span>}
                        title={workout.name}
                        subtitle={workout.clientName}
                        meta={dateLabel ?? undefined}
                        trailing={
                          <span className={styles.rowActions}>
                            <Badge>{statusLabel}</Badge>
                            {workout.run?.status !== 'completed' ? (
                              <Button variant="secondary" href={`/workouts/${workout.id}`}>
                                {workout.run ? 'Resume' : 'Start workout'}
                              </Button>
                            ) : (
                              <Button variant="secondary" loading={busy} onClick={() => void playAgain(workout)}>Play again</Button>
                            )}
                            <IconButton
                              icon="menu-dots-linear"
                              label={`More actions for ${workout.name}`}
                              onClick={() => setMenuWorkout(workout)}
                            />
                          </span>
                        }
                      />
                    )
                  })}
                </ListGroup>
                {hasMore ? (
                  <Button variant="secondary" block onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>Show more</Button>
                ) : null}
              </>
            )}
          </section>
        ) : null}

        {tab === 'builder' ? (
          <section className={styles.stack} aria-label="Strength and movement builders">
            <StrengthBuilderLauncher operationMode={operationMode} clients={strengthClients} initialClientId={activeSeed?.clientId} />

            {activeSeed && (
              <section className={styles.builder} aria-labelledby="builder-heading">
                <Surface tier="feature">
                  <div className={styles.stack}>
                    <div>
                      <p className="t-overline">Build for {activeSeed.clientName}</p>
                      <h2 id="builder-heading" className="t-title-2">Personalize a workout</h2>
                    </div>
                    <Select label="Focus" value={preferences.goal} disabled={busy} onChange={(event) => setPreferences({ ...preferences, goal: event.target.value as WorkoutPreferences['goal'] })}>
                      {Object.entries(WORKOUT_GOALS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </Select>
                    <Select label="Time available" value={preferences.minutes} disabled={busy} onChange={(event) => setPreferences({ ...preferences, minutes: Number(event.target.value) as WorkoutPreferences['minutes'] })}>
                      {[10, 15, 20].map((minutes) => <option key={minutes} value={minutes}>Up to {minutes} minutes</option>)}
                    </Select>
                    <Select label="Movement level" value={preferences.capability} disabled={busy} onChange={(event) => setPreferences({ ...preferences, capability: event.target.value as WorkoutPreferences['capability'] })}>
                      <option value="regression">Gentle start</option><option value="standard">Everyday movement</option><option value="progression">More challenge</option>
                    </Select>
                    <fieldset className={styles.fieldset}>
                      <legend>Available equipment</legend>
                      <p className="t-footnote">Floor space, a wall, and a chair are included.</p>
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
                    <p className="t-footnote">AI may only select from movements admitted by the saved assessment and current authored catalog.</p>
                  </div>
                </Surface>

                <Surface tier="tile">
                  {draft ? <div className={styles.stack}>
                    <div>
                      <p className="t-overline">{draft.source === 'ai' ? 'AI personalized' : 'Assessment based'}</p>
                      <h2 className="t-title-2">Review before saving</h2>
                      <p className="t-footnote">{draft.notice}</p>
                    </div>
                    <TextField label="Workout name" maxLength={80} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                    <ListGroup label="Movements in this draft">
                      {draft.snapshot.items.map((item) => (
                        <ListRow
                          key={item.slug}
                          title={item.name}
                          subtitle={`${item.stepLabel} · ${item.priorityLabel}`}
                          trailing={
                            <IconButton
                              icon="minus-circle-linear"
                              label={`Remove ${item.name}`}
                              disabledReason={draft.snapshot.items.length <= 1 ? 'At least one movement is required.' : undefined}
                              onClick={() => setDraft({ ...draft, snapshot: removeWorkoutItem(draft.snapshot, item.slug) })}
                            />
                          }
                        />
                      ))}
                    </ListGroup>
                    <p className="t-footnote">{draft.snapshot.items.length} movements · about {Math.max(1, Math.ceil(draft.snapshot.estimatedDurationSec / 60))} min</p>
                    <div className={styles.actions}>
                      <Button variant="tertiary" loading={busy} onClick={() => setDraft(null)}>Discard</Button>
                    </div>
                  </div> : <div className={styles.empty}><p className="t-overline">Assessment → plan → movement</p><h2 className="t-title-2">Your draft appears here.</h2><p className="t-body">Choose the focus, time, level, and equipment. Review every movement before saving.</p></div>}
                </Surface>
              </section>
            )}
          </section>
        ) : null}
      </div>

      {tab === 'saved' ? (
        <ActionBar>
          <Button block onClick={() => setTab('builder')}>New workout</Button>
        </ActionBar>
      ) : null}

      {tab === 'builder' && activeSeed && draft ? (
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
    </div>
  )
}

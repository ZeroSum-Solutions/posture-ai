'use client'

import { useState, type CSSProperties } from 'react'
import Image from 'next/image'
import Icon from '@/components/array/Icon'
import { Surface } from '@/components/array/Surface'
import { ActionBar, Button, ChipRow, EmptyState, FilterChip, Select, SlotNumber, TopBar } from '@/components/ui'
import { haptic } from '@/lib/haptics'
import { MAX_MANUAL_ROUTINE_URL_EXERCISES } from '@/app/workouts/manual/ManualRoutine.types'
import styles from './ExercisesPage.module.css'

type Exercise = {
  id: string
  name: string
  category: string
  instructions: string | null
  sets: number | null
  hold_seconds: number | null
  poster_url: string | null
}

export type ReferenceExercise = {
  id: string
  name: string
  category: string
  equipment: string[]
  primaryMuscles: string[]
  instructions: string
  media: {
    kind: 'image'
    posterUrl: string
    alt: string
    width: number
    height: number
    source: {
      assetUrl: string
      author: string
      license: { shortName: string; url: string }
      modifications: 'none'
    }
  } | null
  source: {
    recordUrl: string
    author: string
    license: { shortName: string; url: string }
  }
}

type LibraryExercise =
  | { kind: 'reviewed'; exercise: Exercise }
  | { kind: 'reference'; exercise: ReferenceExercise }

const PAGE_SIZE = 24

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All',
  stretch: 'Stretch',
  strengthen: 'Strengthen',
  mobility: 'Mobility',
  activation: 'Activation',
  informational: 'Informational',
}

function label(value: string): string {
  return value.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function searchText(item: LibraryExercise): string {
  const common = [item.exercise.name, item.exercise.category, item.exercise.instructions ?? '']
  if (item.kind === 'reviewed') return common.join(' ')
  return [...common, ...item.exercise.equipment, ...item.exercise.primaryMuscles, item.exercise.source.author].join(' ')
}

export default function ExercisesLibrary({
  exercises,
  referenceExercises,
}: {
  exercises: Exercise[]
  referenceExercises: ReferenceExercise[]
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [equipment, setEquipment] = useState('all')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([])

  const collection: LibraryExercise[] = [
    ...exercises.map(exercise => ({ kind: 'reviewed' as const, exercise })),
    ...referenceExercises.map(exercise => ({ kind: 'reference' as const, exercise })),
  ].sort((left, right) => left.exercise.name.localeCompare(right.exercise.name))
  const categories = ['all', ...Array.from(new Set(collection.map(item => item.exercise.category))).sort()]
  const equipmentOptions = ['all', ...Array.from(new Set(referenceExercises.flatMap(exercise => exercise.equipment))).sort()]
  const normalizedQuery = query.trim().toLocaleLowerCase('en-US')
  const filteredCollection = collection.filter(item => (
    (normalizedQuery.length === 0 || searchText(item).toLocaleLowerCase('en-US').includes(normalizedQuery))
    && (category === 'all' || item.exercise.category === category)
    && (equipment === 'all' || (item.kind === 'reference' && item.exercise.equipment.includes(equipment)))
  ))
  const visibleCollection = filteredCollection.slice(0, limit)
  const manualRoutineHref = (() => {
    const params = new URLSearchParams()
    selectedReferenceIds.forEach(id => params.append('exercise', id))
    return `/workouts/manual/new?${params.toString()}`
  })()

  function resetLimit() {
    setLimit(PAGE_SIZE)
  }

  function toggleReference(id: string) {
    setSelectedReferenceIds(current => current.includes(id)
      ? current.filter(selectedId => selectedId !== id)
      : current.length < MAX_MANUAL_ROUTINE_URL_EXERCISES ? [...current, id] : current)
  }

  return (
    <div className={`app-screen ${styles.screen} ${selectedReferenceIds.length > 0 ? 'app-screen--bar' : ''}`}>
      <TopBar title="Exercises" subtitle="Reviewed and licensed reference movements" />

      <div className={`app-screen-x ${styles.collection}`}>
        <section className={styles.section} aria-labelledby="exercise-collection-heading">
          {/* Hero: the live count is the answer — it rolls as filters narrow the set. */}
          <div className={styles.hero}>
            <div className={styles.heroRow}>
              <SlotNumber value={filteredCollection.length} className={styles.heroValue} />
              <span className={styles.heroUnit}>{filteredCollection.length === 1 ? 'movement' : 'movements'}</span>
            </div>
            <h2 id="exercise-collection-heading" className="t-headline">Find a movement</h2>
          </div>

          <div className={styles.controls}>
            {/* A plain, synchronous native search input — the shared `SearchField` debounces
                `onQueryChange`, which would desync from this screen's unit tests (they assert
                the filtered list immediately after `fireEvent.change`, with no `waitFor`). */}
            <label className={styles.search}>
              <span className="sr-only">Search exercises</span>
              <Icon name="magnifer-linear" size={20} />
              <input
                type="search"
                aria-label="Search exercises"
                value={query}
                onChange={event => { setQuery(event.target.value); resetLimit() }}
                placeholder="Name, instructions, equipment, muscle"
              />
            </label>
            <Select
              label="Equipment"
              className={styles.field}
              value={equipment}
              onChange={event => { setEquipment(event.target.value); resetLimit() }}
            >
              {equipmentOptions.map(option => <option key={option} value={option}>{option === 'all' ? 'All equipment' : option}</option>)}
            </Select>
          </div>

          <ChipRow label="Filter exercises by category" bleed>
            {categories.map(option => (
              <FilterChip
                key={option}
                label={option === 'all' ? 'All' : CATEGORY_LABELS[option] || label(option)}
                count={option === 'all' ? undefined : collection.filter(item => item.exercise.category === option).length}
                selected={category === option}
                onToggle={() => { setCategory(option); resetLimit() }}
              />
            ))}
          </ChipRow>

          <p className={styles.status} role="status">Showing {Math.min(limit, filteredCollection.length)} of {filteredCollection.length} matches</p>

          {selectedReferenceIds.length > 0 && (
            // The e2e spec reaches the "Continue to workout" link as a descendant
            // of the status: `getByRole('status', { name: 'Workout selection' })`.
            <ActionBar>
              <div className={styles.selectionTray} role="status" aria-label="Workout selection">
                <div className={styles.trayCount}>
                  <SlotNumber value={selectedReferenceIds.length} className={styles.trayValue} />
                  <span className={styles.trayText}>
                    <strong>{selectedReferenceIds.length} exercise{selectedReferenceIds.length === 1 ? '' : 's'} selected</strong>
                    <span className="t-label">Kept in the order you add them.</span>
                  </span>
                </div>
                <Button href={manualRoutineHref}>Continue to workout</Button>
              </div>
            </ActionBar>
          )}

          {filteredCollection.length === 0 && (
            <EmptyState icon="magnifer-linear" variant="inline" title="No matches" body="No exercises match these filters. Try a different search or category." />
          )}

          <div className={styles.grid}>
            {visibleCollection.map((item, index) => {
              const exercise = item.exercise
              const reviewedExercise = item.kind === 'reviewed' ? item.exercise : null
              const referenceExercise = item.kind === 'reference' ? item.exercise : null
              const isSelected = referenceExercise !== null && selectedReferenceIds.includes(referenceExercise.id)
              const selectionFull = selectedReferenceIds.length >= MAX_MANUAL_ROUTINE_URL_EXERCISES
              return (
                <Surface
                  key={`${item.kind}:${exercise.id}`}
                  tier="tile"
                  pad="flush"
                  className={styles.card}
                  style={{ '--i': Math.min(index % PAGE_SIZE, 8) } as CSSProperties}
                  innerClassName={styles.cardInner}
                  innerStyle={{ padding: 'var(--exercise-card-padding, 20px)' }}
                >
                  {reviewedExercise?.poster_url && (
                    <div className={styles.mediaFrame}>
                      <Image src={reviewedExercise.poster_url} alt="" width={640} height={400} loading="lazy" />
                    </div>
                  )}
                  {referenceExercise?.media && (
                    <>
                      <div className={styles.mediaFrame}>
                        <Image
                          src={referenceExercise.media.posterUrl}
                          alt={referenceExercise.media.alt}
                          width={referenceExercise.media.width}
                          height={referenceExercise.media.height}
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                      <p className={`t-label ${styles.source}`}>
                        Image by {referenceExercise.media.source.author} via{' '}
                        <a href={referenceExercise.media.source.assetUrl} target="_blank" rel="noreferrer" aria-label={`wger image source for ${exercise.name}`}>wger</a>
                        {' · '}
                        <a href={referenceExercise.media.source.license.url} target="_blank" rel="noreferrer" aria-label={`${referenceExercise.media.source.license.shortName} image license`}>{referenceExercise.media.source.license.shortName}</a>
                        {' · unmodified'}
                      </p>
                    </>
                  )}

                  <div className={styles.cardHeader}>
                    <p className={styles.kicker}>
                      <span>{CATEGORY_LABELS[exercise.category] || label(exercise.category)}</span>
                      <span className={styles.reviewMark} data-kind={item.kind} aria-hidden="true" />
                    </p>
                    <h3 className={styles.cardTitle}>{exercise.name}</h3>
                  </div>

                  <p className={styles.referenceStatus}>
                    {item.kind === 'reviewed' ? 'Reviewed Posture AI content' : 'Licensed reference · not program reviewed'}
                  </p>

                  {referenceExercise && (
                    <div className={styles.metadata}>
                      <p className="t-label">{referenceExercise.equipment.length > 0 ? referenceExercise.equipment.join(' · ') : 'Equipment not specified'}</p>
                      {referenceExercise.primaryMuscles.length > 0 && <p className="t-label">Primary: {referenceExercise.primaryMuscles.join(', ')}</p>}
                    </div>
                  )}

                  <div className={styles.instructionBlock}>
                    <strong>Instructions</strong>
                    <ClampedText text={exercise.instructions || 'Instructions are unavailable for this exercise.'} name={exercise.name} />
                  </div>

                  {reviewedExercise && (reviewedExercise.sets || reviewedExercise.hold_seconds) && (
                    <p className={`n ${styles.dosage}`}>
                      {reviewedExercise.sets && `${reviewedExercise.sets} sets`}{reviewedExercise.sets && reviewedExercise.hold_seconds && ' · '}{reviewedExercise.hold_seconds && `${reviewedExercise.hold_seconds}s hold`}
                    </p>
                  )}

                  <div className={styles.cardFooter}>
                    {referenceExercise ? (
                      <>
                        <button
                          type="button"
                          className={styles.addButton}
                          data-selected={isSelected ? 'true' : 'false'}
                          disabled={!isSelected && selectionFull}
                          aria-pressed={isSelected}
                          aria-label={`${isSelected ? 'Remove' : 'Add'} ${exercise.name} ${isSelected ? 'from' : 'to'} workout`}
                          onClick={() => { haptic('tap'); toggleReference(referenceExercise.id) }}
                        >
                          <Icon name={isSelected ? 'check-linear' : 'add-circle-linear'} size={18} />
                          {isSelected ? 'Added to workout' : 'Add to workout'}
                        </button>
                        <p className={`t-label ${styles.source}`}>
                          Instructions by {referenceExercise.source.author}.{' '}
                          <a href={referenceExercise.source.recordUrl} target="_blank" rel="noreferrer" aria-label={`wger source for ${exercise.name}`}>Source</a>
                          {' · '}
                          <a href={referenceExercise.source.license.url} target="_blank" rel="noreferrer" aria-label={`${referenceExercise.source.license.shortName} license`}>{referenceExercise.source.license.shortName}</a>
                        </p>
                      </>
                    ) : (
                      <>
                        <button type="button" className={styles.addButton} disabled>Add to workout</button>
                        <p className="t-label">Not yet available in custom workouts.</p>
                      </>
                    )}
                  </div>
                </Surface>
              )
            })}
          </div>

          {limit < filteredCollection.length && (
            <Button variant="secondary" className={styles.showMore} onClick={() => setLimit(current => current + PAGE_SIZE)}>Show more exercises</Button>
          )}
        </section>
      </div>
    </div>
  )
}

/** Long instructions clamp to four lines with a quiet toggle; the full text stays in the DOM. */
function ClampedText({ text, name }: { text: string; name: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 220
  return (
    <>
      <p className={styles.instructions} data-clamped={long && !open ? 'true' : undefined}>{text}</p>
      {long ? (
        <button type="button" className={styles.moreButton} aria-expanded={open} aria-label={`${open ? 'Show less' : 'Show all'} instructions for ${name}`} onClick={() => setOpen(value => !value)}>
          {open ? 'Show less' : 'Show all'}
        </button>
      ) : null}
    </>
  )
}

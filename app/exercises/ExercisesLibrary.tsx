'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { FilterChip, FilterRow, Chip } from '@/components/array/Chip'
import { Surface } from '@/components/array/Surface'
import { tone, type SeverityBand } from '@/components/array/severity'
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

const CATEGORY_BANDS: Record<string, SeverityBand> = {
  stretch: 'maintain',
  strengthen: 'info',
  mobility: 'monitor',
  activation: 'review',
  informational: 'neutral',
}

function bandForCategory(category: string): SeverityBand {
  return CATEGORY_BANDS[category] ?? 'neutral'
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
    <div className={`app-screen ${styles.screen}`}>
      <header className={styles.header}>
        <div>
          <p className="t-overline">Movement library</p>
          <h1 className="t-title-1">Exercises</h1>
          <p className="t-body">Explore exercise instructions and build your workout.</p>
        </div>
        <Surface tier="tile" pad="snug" innerClassName={styles.headerMetric}>
          <span className="t-footnote">Matching</span>
          <strong className="t-readout-md n">{filteredCollection.length}</strong>
          <em>{filteredCollection.length === 1 ? 'movement' : 'movements'}</em>
        </Surface>
      </header>

      <div className={`app-screen-x app-stack ${styles.collection}`}>
        <section className="app-stack" aria-labelledby="exercise-collection-heading">
          <div className={styles.sectionHeader}>
            <div>
              <p className="t-overline">Exercise collection</p>
              <h2 id="exercise-collection-heading" className="t-title-2">Find a movement</h2>
              <p className="t-body">Review status and source details stay attached to each exercise.</p>
            </div>
            <span className="t-footnote" role="status">Showing {Math.min(limit, filteredCollection.length)} of {filteredCollection.length} matches</span>
          </div>

          <div className={styles.controls}>
            <label className={styles.field}>
              <span>Search exercises</span>
              <input
                type="search"
                value={query}
                onChange={event => { setQuery(event.target.value); resetLimit() }}
                placeholder="Search name, instructions, equipment, or muscle"
              />
            </label>
            <label className={styles.field}>
              <span>Equipment</span>
              <select value={equipment} onChange={event => { setEquipment(event.target.value); resetLimit() }}>
                {equipmentOptions.map(option => <option key={option} value={option}>{option === 'all' ? 'All equipment' : option}</option>)}
              </select>
            </label>
          </div>

          <FilterRow label="Filter exercises by category">
            {categories.map(option => (
              <FilterChip
                key={option}
                label={option === 'all' ? 'All' : CATEGORY_LABELS[option] || label(option)}
                count={option === 'all' ? undefined : collection.filter(item => item.exercise.category === option).length}
                active={category === option}
                onClick={() => { setCategory(option); resetLimit() }}
              />
            ))}
          </FilterRow>

          {selectedReferenceIds.length > 0 && (
            <div className={styles.selectionTray} role="status" aria-label="Workout selection">
              <div>
                <strong>{selectedReferenceIds.length} exercise{selectedReferenceIds.length === 1 ? '' : 's'} selected</strong>
                <p className="t-footnote">Selections stay in the order you add them. You can refine the routine next.</p>
              </div>
              <Link className="a-primary" href={manualRoutineHref}>Continue to workout</Link>
            </div>
          )}

          {filteredCollection.length === 0 && (
            <Surface tier="tile" pad="rowy"><p className="t-body">No exercises match these filters.</p></Surface>
          )}

          <div className={styles.grid}>
            {visibleCollection.map(item => {
              const exercise = item.exercise
              const reviewedExercise = item.kind === 'reviewed' ? item.exercise : null
              const referenceExercise = item.kind === 'reference' ? item.exercise : null
              const band = bandForCategory(exercise.category)
              const isSelected = referenceExercise !== null && selectedReferenceIds.includes(referenceExercise.id)
              const selectionFull = selectedReferenceIds.length >= MAX_MANUAL_ROUTINE_URL_EXERCISES
              return (
                <Surface key={`${item.kind}:${exercise.id}`} tier="tile" pad="flush" innerClassName={styles.cardInner} innerStyle={{ padding: 'var(--exercise-card-padding, 20px)' }}>
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
                      <p className={`t-footnote ${styles.source}`}>
                        Image by {referenceExercise.media.source.author} via{' '}
                        <a href={referenceExercise.media.source.assetUrl} target="_blank" rel="noreferrer" aria-label={`wger image source for ${exercise.name}`}>wger</a>
                        {' · '}
                        <a href={referenceExercise.media.source.license.url} target="_blank" rel="noreferrer" aria-label={`${referenceExercise.media.source.license.shortName} image license`}>{referenceExercise.media.source.license.shortName}</a>
                        {' · unmodified'}
                      </p>
                    </>
                  )}

                  <div className={styles.cardHeader}>
                    <h3 className="t-headline">{exercise.name}</h3>
                    <Chip band={band} size="sm">{CATEGORY_LABELS[exercise.category] || label(exercise.category)}</Chip>
                  </div>

                  <p className={styles.referenceStatus}>
                    {item.kind === 'reviewed' ? 'Reviewed Posture AI content' : 'Licensed reference · not program reviewed'}
                  </p>

                  {referenceExercise && (
                    <div className={styles.metadata}>
                      <p className="t-footnote">{referenceExercise.equipment.length > 0 ? referenceExercise.equipment.join(' · ') : 'Equipment not specified'}</p>
                      {referenceExercise.primaryMuscles.length > 0 && <p className="t-footnote">Primary: {referenceExercise.primaryMuscles.join(', ')}</p>}
                    </div>
                  )}

                  <div className={styles.instructionBlock}>
                    <strong>Instructions</strong>
                    <p className="t-body">{exercise.instructions || 'Instructions are unavailable for this exercise.'}</p>
                  </div>

                  {reviewedExercise && (reviewedExercise.sets || reviewedExercise.hold_seconds) && (
                    <p className={`n ${styles.dosage}`} style={{ color: tone(band) }}>
                      {reviewedExercise.sets && `${reviewedExercise.sets} sets`}{reviewedExercise.sets && reviewedExercise.hold_seconds && ' · '}{reviewedExercise.hold_seconds && `${reviewedExercise.hold_seconds}s hold`}
                    </p>
                  )}

                  <div className={styles.cardFooter}>
                    {referenceExercise ? (
                      <>
                        <button
                          type="button"
                          className={isSelected ? 'a-secondary' : 'a-primary'}
                          disabled={!isSelected && selectionFull}
                          aria-pressed={isSelected}
                          aria-label={`${isSelected ? 'Remove' : 'Add'} ${exercise.name} ${isSelected ? 'from' : 'to'} workout`}
                          onClick={() => toggleReference(referenceExercise.id)}
                        >
                          {isSelected ? 'Added to workout' : 'Add to workout'}
                        </button>
                        <p className={`t-footnote ${styles.source}`}>
                          Instructions by {referenceExercise.source.author}.{' '}
                          <a href={referenceExercise.source.recordUrl} target="_blank" rel="noreferrer" aria-label={`wger source for ${exercise.name}`}>Source</a>
                          {' · '}
                          <a href={referenceExercise.source.license.url} target="_blank" rel="noreferrer" aria-label={`${referenceExercise.source.license.shortName} license`}>{referenceExercise.source.license.shortName}</a>
                        </p>
                      </>
                    ) : (
                      <>
                        <button type="button" className="a-secondary" disabled>Add to workout</button>
                        <p className="t-footnote">Not yet available in custom workouts.</p>
                      </>
                    )}
                  </div>
                </Surface>
              )
            })}
          </div>

          {limit < filteredCollection.length && (
            <button type="button" className={`a-secondary ${styles.showMore}`} onClick={() => setLimit(current => current + PAGE_SIZE)}>Show more exercises</button>
          )}
        </section>
      </div>
    </div>
  )
}

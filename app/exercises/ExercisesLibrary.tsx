'use client'

import { useId, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import Image from 'next/image'
import Icon from '@/components/array/Icon'
import { ActionBar, Button, ChipRow, EmptyState, FilterChip, Select, SlotNumber, TopBar } from '@/components/ui'
import { haptic } from '@/lib/haptics'
import { reduced, spring } from '@/lib/motion'
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
  const [openKey, setOpenKey] = useState<string | null>(null)

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


  const selectionFull = selectedReferenceIds.length >= MAX_MANUAL_ROUTINE_URL_EXERCISES

  return (
    <div className={`app-screen ${styles.screen} ${selectedReferenceIds.length > 0 ? 'app-screen--bar' : ''}`}>
      <TopBar title="Exercises" subtitle="Licensed movement references" />

      <div className={`app-screen-x ${styles.collection}`}>
        {/* Hero: the live count is the answer — it rolls as filters narrow the set. */}
        <div className={styles.hero}>
          <SlotNumber value={filteredCollection.length} className={styles.heroValue} />
          <span className={styles.heroUnit}>{filteredCollection.length === 1 ? 'movement' : 'movements'}</span>
        </div>

        <section className={styles.section} aria-labelledby="exercise-collection-heading">
          <h2 id="exercise-collection-heading" className="t-headline">Find a movement</h2>

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
                placeholder="Search movements or muscles"
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

          {selectedReferenceIds.length > 0 && (
            // The e2e spec reaches the "Continue to workout" link as a descendant
            // of the status: `getByRole('status', { name: 'Workout selection' })`.
            <ActionBar>
              <div className={styles.selectionTray} role="status" aria-label="Workout selection">
                <div className={styles.trayCount}>
                  <SlotNumber value={selectedReferenceIds.length} className={styles.trayValue} />
                  <span className={styles.trayText}>
                    <strong>{selectedReferenceIds.length} exercise{selectedReferenceIds.length === 1 ? '' : 's'} selected</strong>
                    <span className={`t-label ${styles.trayHint}`}>Kept in the order you add them.</span>
                  </span>
                </div>
                <Button href={manualRoutineHref}>Continue to workout</Button>
              </div>
            </ActionBar>
          )}

          {filteredCollection.length === 0 && (
            <EmptyState icon="magnifer-linear" variant="inline" title="No matches" body="No exercises match these filters. Try a different search or category." />
          )}

          {/* Results are hairline rows on the canvas: name, category · equipment, and a
              compact add. Tapping the row opens that movement in place (one at a time). */}
          <ul className={styles.rows}>
            {visibleCollection.map((item, index) => {
              const key = `${item.kind}:${item.exercise.id}`
              const referenceExercise = item.kind === 'reference' ? item.exercise : null
              const isSelected = referenceExercise !== null && selectedReferenceIds.includes(referenceExercise.id)
              return (
                <ExerciseRow
                  key={key}
                  item={item}
                  index={index}
                  open={openKey === key}
                  onToggleOpen={() => setOpenKey(current => current === key ? null : key)}
                  selected={isSelected}
                  selectionFull={selectionFull}
                  onToggleSelected={referenceExercise ? () => { haptic('tap'); toggleReference(referenceExercise.id) } : undefined}
                />
              )
            })}
          </ul>

          <div className={styles.listFoot}>
            <p className={styles.status} role="status">Showing {Math.min(limit, filteredCollection.length)} of {filteredCollection.length} matches</p>
            {limit < filteredCollection.length && (
              <Button variant="secondary" className={styles.showMore} onClick={() => setLimit(current => current + PAGE_SIZE)}>Show more exercises</Button>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

const BODYWEIGHT = /^none \(bodyweight/i

/** Row meta: the category word, then the first equipment (bodyweight shortened). */
function rowMeta(item: LibraryExercise): string {
  const categoryWord = CATEGORY_LABELS[item.exercise.category] || label(item.exercise.category)
  if (item.kind === 'reviewed') return categoryWord
  const gear = item.exercise.equipment.map(entry => (BODYWEIGHT.test(entry) ? 'Bodyweight' : entry))
  return [categoryWord, ...gear].join(' · ')
}

function ExerciseRow({
  item,
  index,
  open,
  onToggleOpen,
  selected,
  selectionFull,
  onToggleSelected,
}: {
  item: LibraryExercise
  index: number
  open: boolean
  onToggleOpen: () => void
  selected: boolean
  selectionFull: boolean
  onToggleSelected?: () => void
}) {
  const exercise = item.exercise
  const detailId = useId()
  const reduceMotion = useReducedMotion()
  return (
    <li className={styles.row} data-open={open ? 'true' : undefined} style={{ '--i': Math.min(index % PAGE_SIZE, 8) } as CSSProperties}>
      <div className={styles.rowHead}>
        <button type="button" className={styles.rowTrigger} aria-expanded={open} aria-controls={detailId} onClick={onToggleOpen}>
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>{exercise.name}</span>
            <span className={styles.rowMeta}>
              {item.kind === 'reviewed' && <span className={styles.reviewedMark}>Reviewed</span>}
              {rowMeta(item)}
            </span>
          </span>
          <span className={styles.chevron} aria-hidden="true"><Icon name="alt-arrow-down-linear" size={18} /></span>
        </button>
        {/* Reviewed movements can't join a custom workout yet; a blank slot keeps chevrons aligned. */}
        {!onToggleSelected && <span className={styles.addSlot} aria-hidden="true" />}
        {onToggleSelected && (
          <button
            type="button"
            className={styles.addButton}
            data-selected={selected ? 'true' : 'false'}
            disabled={!selected && selectionFull}
            aria-pressed={selected}
            aria-label={`${selected ? 'Remove' : 'Add'} ${exercise.name} ${selected ? 'from' : 'to'} workout`}
            onClick={onToggleSelected}
          >
            <Icon name={selected ? 'check-linear' : 'add-circle-linear'} size={20} />
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={detailId}
            key="detail"
            className={styles.detail}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduceMotion ? reduced : spring.morph}
          >
            <ExerciseDetail item={item} selected={selected} selectionFull={selectionFull} onToggleSelected={onToggleSelected} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  )
}

function ExerciseDetail({
  item,
  selected,
  selectionFull,
  onToggleSelected,
}: {
  item: LibraryExercise
  selected: boolean
  selectionFull: boolean
  onToggleSelected?: () => void
}) {
  const exercise = item.exercise
  const reviewedExercise = item.kind === 'reviewed' ? item.exercise : null
  const referenceExercise = item.kind === 'reference' ? item.exercise : null
  return (
    <div className={styles.detailInner}>
      {reviewedExercise?.poster_url && (
        <div className={styles.mediaFrame}>
          <Image src={reviewedExercise.poster_url} alt="" width={640} height={400} loading="lazy" />
        </div>
      )}
      {referenceExercise?.media && (
        <figure className={styles.figure}>
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
          <figcaption className={`t-label ${styles.source}`}>
            Image by {referenceExercise.media.source.author} via{' '}
            <a href={referenceExercise.media.source.assetUrl} target="_blank" rel="noreferrer" aria-label={`wger image source for ${exercise.name}`}>wger</a>
            {' · '}
            <a href={referenceExercise.media.source.license.url} target="_blank" rel="noreferrer" aria-label={`${referenceExercise.media.source.license.shortName} image license`}>{referenceExercise.media.source.license.shortName}</a>
            {' · unmodified'}
          </figcaption>
        </figure>
      )}

      {referenceExercise && (
        <dl className={styles.facts}>
          <div>
            <dt>Equipment</dt>
            <dd>{referenceExercise.equipment.length > 0 ? referenceExercise.equipment.join(' · ') : 'Equipment not specified'}</dd>
          </div>
          {referenceExercise.primaryMuscles.length > 0 && (
            <div>
              <dt>Primary</dt>
              <dd>{referenceExercise.primaryMuscles.join(', ')}</dd>
            </div>
          )}
        </dl>
      )}

      {reviewedExercise && (reviewedExercise.sets || reviewedExercise.hold_seconds) && (
        <p className={`n ${styles.dosage}`}>
          {reviewedExercise.sets && `${reviewedExercise.sets} sets`}{reviewedExercise.sets && reviewedExercise.hold_seconds && ' · '}{reviewedExercise.hold_seconds && `${reviewedExercise.hold_seconds}s hold`}
        </p>
      )}

      <div className={styles.instructionBlock}>
        <strong>Instructions</strong>
        <p className={styles.instructions}>{exercise.instructions || 'Instructions are unavailable for this exercise.'}</p>
      </div>

      {referenceExercise && onToggleSelected && (
        <button
          type="button"
          className={styles.detailAdd}
          data-selected={selected ? 'true' : 'false'}
          disabled={!selected && selectionFull}
          aria-pressed={selected}
          onClick={onToggleSelected}
        >
          <Icon name={selected ? 'check-linear' : 'add-circle-linear'} size={18} />
          {selected ? 'Added to workout' : 'Add to workout'}
        </button>
      )}

      <div className={styles.provenance}>
        <p className={styles.referenceStatus}>
          {item.kind === 'reviewed' ? 'Reviewed Posture AI content' : 'Licensed reference · not program reviewed'}
        </p>
        {referenceExercise ? (
          <p className={`t-label ${styles.source}`}>
            Instructions by {referenceExercise.source.author}.{' '}
            <a href={referenceExercise.source.recordUrl} target="_blank" rel="noreferrer" aria-label={`wger source for ${exercise.name}`}>Source</a>
            {' · '}
            <a href={referenceExercise.source.license.url} target="_blank" rel="noreferrer" aria-label={`${referenceExercise.source.license.shortName} license`}>{referenceExercise.source.license.shortName}</a>
          </p>
        ) : (
          <p className="t-label">Not yet available in custom workouts.</p>
        )}
      </div>
    </div>
  )
}

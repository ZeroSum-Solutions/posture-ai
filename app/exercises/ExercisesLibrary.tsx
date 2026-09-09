'use client'

// Reviewed program content and attributable reference instructions stay distinct.
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

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All',
  stretch: 'Stretch',
  strengthen: 'Strengthen',
  mobility: 'Mobility',
  activation: 'Activation',
  informational: 'Informational',
}

/** Category is coded through the same severity bands as everywhere else in
 * the app, not a bespoke palette — stretch reads as calm, activation as the
 * most demanding, informational as unscored. */
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

export default function ExercisesLibrary({
  exercises,
  referenceExercises,
}: {
  exercises: Exercise[]
  referenceExercises: ReferenceExercise[]
}) {
  const [approvedFilter, setApprovedFilter] = useState<string>('all')
  const [referenceQuery, setReferenceQuery] = useState('')
  const [referenceCategory, setReferenceCategory] = useState('all')
  const [referenceEquipment, setReferenceEquipment] = useState('all')
  const [referenceLimit, setReferenceLimit] = useState(24)
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([])

  const categories = ['all', ...Array.from(new Set(exercises.map(e => e.category))).sort()]
  const filteredApproved = approvedFilter === 'all' ? exercises : exercises.filter(e => e.category === approvedFilter)
  const referenceCategories = ['all', ...Array.from(new Set(referenceExercises.map(e => e.category))).sort()]
  const equipmentOptions = ['all', ...Array.from(new Set(referenceExercises.flatMap(e => e.equipment))).sort()]
  const normalizedQuery = referenceQuery.trim().toLocaleLowerCase('en-US')
  const filteredReferences = referenceExercises.filter(exercise => {
    const haystack = [exercise.name, exercise.category, ...exercise.equipment, ...exercise.primaryMuscles]
      .join(' ').toLocaleLowerCase('en-US')
    return (normalizedQuery.length === 0 || haystack.includes(normalizedQuery))
      && (referenceCategory === 'all' || exercise.category === referenceCategory)
      && (referenceEquipment === 'all' || exercise.equipment.includes(referenceEquipment))
  })
  const manualRoutineHref = (() => {
    const params = new URLSearchParams()
    selectedReferenceIds.forEach(id => params.append('exercise', id))
    return `/workouts/manual/new?${params.toString()}`
  })()

  function toggleReference(id: string) {
    setSelectedReferenceIds(current => current.includes(id)
      ? current.filter(selectedId => selectedId !== id)
      : current.length < MAX_MANUAL_ROUTINE_URL_EXERCISES ? [...current, id] : current)
  }

  return (
    <div className={`app-screen ${styles.screen}`}>
      <header className={styles.header}>
        <div>
          <p className="t-kicker" style={{ marginBottom: 10 }}>Movement library</p>
          <h1 className="t-headline">Exercises</h1>
        </div>
        <Surface tier="tile" pad="snug" innerClassName={styles.headerMetric}>
          <span className="t-quiet">Matching</span>
          <strong className="t-readout-md n">{filteredApproved.length + filteredReferences.length}</strong>
          <em>{filteredApproved.length + filteredReferences.length === 1 ? 'movement' : 'movements'}</em>
        </Surface>
      </header>

      <div className="app-screen-x app-stack">
        {exercises.length > 0 && (
          <section className="app-stack" aria-labelledby="reviewed-exercises-heading">
            <div className={styles.sectionHeader}>
              <div><p className="t-kicker">Program content</p><h2 id="reviewed-exercises-heading" className="t-headline-sm">Reviewed Posture AI exercises</h2></div>
              <span className="t-quiet">{filteredApproved.length} shown</span>
            </div>
            <FilterRow label="Filter reviewed exercises by category">
              {categories.map(cat => (
                <FilterChip
                  key={cat}
                  label={CATEGORY_LABELS[cat] || label(cat)}
                  count={cat === 'all' ? undefined : exercises.filter(e => e.category === cat).length}
                  active={approvedFilter === cat}
                  onClick={() => setApprovedFilter(cat)}
                />
              ))}
            </FilterRow>
            <div className={styles.grid}>
              {filteredApproved.map((ex) => {
                const band = bandForCategory(ex.category)
                return (
                  <Surface key={ex.id} tier="tile" pad="flush" innerClassName={styles.cardInner}>
                    {ex.poster_url && <div className={styles.mediaFrame}><img src={ex.poster_url} alt="" loading="lazy" /></div>}
                    <div className={styles.cardHeader}>
                      <span className="t-title">{ex.name}</span>
                      <Chip band={band} size="sm">{CATEGORY_LABELS[ex.category] || ex.category}</Chip>
                    </div>
                    {ex.instructions && <p className={`t-body ${styles.instructions}`}>{ex.instructions.length > 120 ? `${ex.instructions.slice(0, 117)}...` : ex.instructions}</p>}
                    {(ex.sets || ex.hold_seconds) && (
                      <p className={`n ${styles.dosage}`} style={{ color: tone(band) }}>
                        {ex.sets && `${ex.sets} sets`}{ex.sets && ex.hold_seconds && ' · '}{ex.hold_seconds && `${ex.hold_seconds}s hold`}
                      </p>
                    )}
                  </Surface>
                )
              })}
            </div>
          </section>
        )}

        <section className="app-stack" aria-labelledby="reference-exercises-heading">
          <div className={styles.sectionHeader}>
            <div>
              <p className="t-kicker">Reference index</p>
              <h2 id="reference-exercises-heading" className="t-headline-sm">Explore exercise instructions</h2>
              <p className="t-body">Licensed source instructions for browsing. These entries are not reviewed for your program.</p>
            </div>
            <span className="t-quiet" role="status">Showing {Math.min(referenceLimit, filteredReferences.length)} of {filteredReferences.length} matches</span>
          </div>

          <div className={styles.controls}>
            <label className={styles.field}>
              <span>Search reference exercises</span>
              <input
                type="search"
                value={referenceQuery}
                onChange={event => { setReferenceQuery(event.target.value); setReferenceLimit(24) }}
                placeholder="Search name, equipment, or muscle"
              />
            </label>
            <label className={styles.field}>
              <span>Equipment</span>
              <select value={referenceEquipment} onChange={event => { setReferenceEquipment(event.target.value); setReferenceLimit(24) }}>
                {equipmentOptions.map(equipment => <option key={equipment} value={equipment}>{equipment === 'all' ? 'All equipment' : equipment}</option>)}
              </select>
            </label>
          </div>

          <FilterRow label="Filter reference exercises by category">
            {referenceCategories.map(category => (
              <FilterChip
                key={category}
                label={category === 'all' ? 'All' : label(category)}
                count={category === 'all' ? undefined : referenceExercises.filter(exercise => exercise.category === category).length}
                active={referenceCategory === category}
                onClick={() => { setReferenceCategory(category); setReferenceLimit(24) }}
              />
            ))}
          </FilterRow>

          {selectedReferenceIds.length > 0 && (
            <div className={styles.selectionTray} role="status" aria-label="Routine selection">
              <div>
                <strong>{selectedReferenceIds.length} exercise{selectedReferenceIds.length === 1 ? '' : 's'} selected</strong>
                <p className="t-quiet">Selections stay in the order you add them. You can search all 280 entries in the editor.</p>
              </div>
              <Link className="a-primary" href={manualRoutineHref}>Continue to routine</Link>
            </div>
          )}

          {filteredReferences.length === 0 && <Surface tier="tile" pad="rowy"><p className="t-body">No reference exercises match these filters.</p></Surface>}
          <div className={styles.grid}>
            {filteredReferences.slice(0, referenceLimit).map(exercise => (
              <Surface key={exercise.id} tier="tile" pad="flush" innerClassName={styles.cardInner}>
                {exercise.media && <>
                  <div className={styles.mediaFrame}>
                    <Image
                      src={exercise.media.posterUrl}
                      alt={exercise.media.alt}
                      width={exercise.media.width}
                      height={exercise.media.height}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <p className={`t-quiet ${styles.source}`}>
                    Image by {exercise.media.source.author} via{' '}
                    <a href={exercise.media.source.assetUrl} target="_blank" rel="noreferrer" aria-label={`wger image source for ${exercise.name}`}>wger</a>
                    {' · '}
                    <a href={exercise.media.source.license.url} target="_blank" rel="noreferrer" aria-label={`${exercise.media.source.license.shortName} image license`}>{exercise.media.source.license.shortName}</a>
                    {' · unmodified'}
                  </p>
                </>}
                <div className={styles.cardHeader}>
                  <span className="t-title">{exercise.name}</span>
                  <Chip band="neutral" size="sm">{label(exercise.category)}</Chip>
                </div>
                <p className={styles.referenceStatus}>Reference · unreviewed</p>
                <p className="t-quiet">{exercise.equipment.length > 0 ? exercise.equipment.join(' · ') : 'Equipment not specified'}</p>
                {exercise.primaryMuscles.length > 0 && <p className="t-quiet">Primary: {exercise.primaryMuscles.join(', ')}</p>}
                <button
                  type="button"
                  className={selectedReferenceIds.includes(exercise.id) ? 'a-secondary' : 'a-primary'}
                  disabled={!selectedReferenceIds.includes(exercise.id) && selectedReferenceIds.length >= MAX_MANUAL_ROUTINE_URL_EXERCISES}
                  aria-pressed={selectedReferenceIds.includes(exercise.id)}
                  aria-label={`${selectedReferenceIds.includes(exercise.id) ? 'Remove' : 'Add'} ${exercise.name} ${selectedReferenceIds.includes(exercise.id) ? 'from' : 'to'} routine`}
                  onClick={() => toggleReference(exercise.id)}
                >
                  {selectedReferenceIds.includes(exercise.id) ? 'Selected' : 'Add to routine'}
                </button>
                <details className={styles.detail}>
                  <summary>Instructions and source</summary>
                  <p className="t-body">{exercise.instructions}</p>
                  <p className={`t-quiet ${styles.source}`}>
                    By {exercise.source.author}.{' '}
                    <a href={exercise.source.recordUrl} target="_blank" rel="noreferrer" aria-label={`wger source for ${exercise.name}`}>wger source</a>
                    {' · '}
                    <a href={exercise.source.license.url} target="_blank" rel="noreferrer" aria-label={`${exercise.source.license.shortName} license`}>{exercise.source.license.shortName}</a>
                  </p>
                </details>
              </Surface>
            ))}
          </div>
          {referenceLimit < filteredReferences.length && <button type="button" className="a-secondary" onClick={() => setReferenceLimit(limit => limit + 24)}>Show more exercises</button>}
        </section>
      </div>
    </div>
  )
}

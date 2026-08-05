'use client'

// Loaded only after the server-side HG-03 clinical-content gate passes.
import { useState } from 'react'
import { FilterChip, FilterRow, Chip } from '@/components/array/Chip'
import { Surface } from '@/components/array/Surface'
import { tone, type SeverityBand } from '@/components/array/severity'
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

export default function ExercisesLibrary({ exercises }: { exercises: Exercise[] }) {
  const [activeFilter, setActiveFilter] = useState<string>('all')

  const categories = ['all', ...Array.from(new Set(exercises.map(e => e.category))).sort()]
  const filtered = activeFilter === 'all' ? exercises : exercises.filter(e => e.category === activeFilter)

  return (
    <div className="app-screen">
      <header className={styles.header}>
        <div>
          <p className="t-kicker" style={{ marginBottom: 10 }}>Movement library</p>
          <h1 className="t-headline">Exercises</h1>
        </div>
        <Surface tier="tile" pad="snug" innerClassName={styles.headerMetric}>
          <span className="t-quiet">Showing</span>
          <strong className="t-readout-md n">{filtered.length}</strong>
          <em>{filtered.length === 1 ? 'movement' : 'movements'}</em>
        </Surface>
      </header>

      <div className="app-screen-x app-stack">
        <FilterRow label="Filter exercises by category">
          {categories.map(cat => (
            <FilterChip
              key={cat}
              label={CATEGORY_LABELS[cat] || cat.charAt(0).toUpperCase() + cat.slice(1)}
              count={cat === 'all' ? undefined : exercises.filter(e => e.category === cat).length}
              active={activeFilter === cat}
              onClick={() => setActiveFilter(cat)}
            />
          ))}
        </FilterRow>

        {filtered.length === 0 && (
          <Surface tier="tile" pad="rowy">
            <p className="t-body">
              No exercises found{activeFilter !== 'all' ? ` for category "${CATEGORY_LABELS[activeFilter] || activeFilter}"` : ''}.
            </p>
          </Surface>
        )}

        <div className={styles.grid}>
          {filtered.map((ex) => {
            const band = bandForCategory(ex.category)
            return (
              <Surface key={ex.id} tier="tile" pad="flush" innerClassName={styles.cardInner}>
                {ex.poster_url && (
                  <div className={styles.mediaFrame}>
                    <img
                      src={ex.poster_url}
                      alt=""
                      loading="lazy"
                    />
                  </div>
                )}
                <div className={styles.cardHeader}>
                  <span className="t-title">{ex.name}</span>
                  <Chip band={band} size="sm">{CATEGORY_LABELS[ex.category] || ex.category}</Chip>
                </div>
                {ex.instructions && (
                  <p className={`t-body ${styles.instructions}`}>
                    {ex.instructions.length > 120 ? ex.instructions.slice(0, 117) + '...' : ex.instructions}
                  </p>
                )}
                {(ex.sets || ex.hold_seconds) && (
                  <p className={`n ${styles.dosage}`} style={{ color: tone(band) }}>
                    {ex.sets && `${ex.sets} sets`}{ex.sets && ex.hold_seconds && ' · '}{ex.hold_seconds && `${ex.hold_seconds}s hold`}
                  </p>
                )}
              </Surface>
            )
          })}
        </div>
      </div>
    </div>
  )
}

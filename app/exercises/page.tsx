'use client'
import { useState, useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
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

function getCategoryColor(cat: string): { bg: string; text: string } {
  const colors: Record<string, { bg: string; text: string }> = {
    stretch: { bg: 'color-mix(in oklab, var(--maintain) 16%, transparent)', text: 'var(--maintain)' },
    strengthen: { bg: 'color-mix(in oklab, var(--brand) 16%, transparent)', text: 'var(--brand)' },
    mobility: { bg: 'color-mix(in oklab, var(--warning) 16%, transparent)', text: 'var(--warning)' },
    activation: { bg: 'color-mix(in oklab, var(--danger) 16%, transparent)', text: 'var(--danger)' },
    informational: { bg: 'color-mix(in oklab, var(--text-muted) 16%, transparent)', text: 'var(--text-muted)' },
  }
  return colors[cat] || { bg: 'color-mix(in oklab, var(--text-muted) 16%, transparent)', text: 'var(--text-muted)' }
}

export default function ExercisesPage() {
  const router = useRouter()
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<string>('all')

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push('/auth/sign-in'); return }
      supabase
        .from('exercises')
        .select('id, name, category, instructions, sets, hold_seconds, poster_url')
        .order('name')
        .then(({ data, error: err }) => {
          setLoading(false)
          if (err) { setError(err.message); return }
          setExercises(data || [])
        })
    })
  }, [router])

  const categories = ['all', ...Array.from(new Set(exercises.map(e => e.category))).sort()]
  const filtered = activeFilter === 'all' ? exercises : exercises.filter(e => e.category === activeFilter)

  return (
    <div className="app-standard-page">
      <div className="app-page-header">
        <div>
          <p className="app-page-kicker">Movement library</p>
          <h1 className="app-page-heading">Exercises</h1>
          <p className="app-page-lede">Browse the movement building blocks used to shape a focused routine.</p>
        </div>
        <div className={styles.headerMetric}>
          <span>Showing</span>
          <strong className="data-readout">{filtered.length}</strong>
          <em>{filtered.length === 1 ? 'movement' : 'movements'}</em>
        </div>
      </div>

      <div className={styles.filterBar} role="group" aria-label="Filter exercises by category">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveFilter(cat)}
            aria-pressed={activeFilter === cat}
            className={styles.filterButton}
          >
            {CATEGORY_LABELS[cat] || cat.charAt(0).toUpperCase() + cat.slice(1)}
            {cat !== 'all' && (
              <span className="data-readout">
                ({exercises.filter(e => e.category === cat).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <p className={styles.statePanel}>Loading exercises...</p>}
      {error && <p className={styles.statePanel} role="alert" data-tone="danger">Error loading exercises: {error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <p className={styles.statePanel}>No exercises found{activeFilter !== 'all' ? ` for category "${activeFilter}"` : ''}.</p>
      )}

      <div className={styles.grid}>
        {filtered.map((ex) => {
          const { bg, text } = getCategoryColor(ex.category)
          const categoryStyle = {
            '--exercise-accent': text,
            '--exercise-tint': bg,
          } as React.CSSProperties
          return (
            <article
              key={ex.id}
              className={`app-panel exercise-library-card ${styles.card}`}
              style={categoryStyle}
            >
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
                <span>{ex.name}</span>
                <span className={styles.categoryPill}>
                  {ex.category}
                </span>
              </div>
              {ex.instructions && (
                <p className={styles.instructions}>
                  {ex.instructions.length > 120 ? ex.instructions.slice(0, 117) + '...' : ex.instructions}
                </p>
              )}
              {(ex.sets || ex.hold_seconds) && (
                <p className={`data-readout ${styles.dosage}`}>
                  {ex.sets && `${ex.sets} sets`}{ex.sets && ex.hold_seconds && ' · '}{ex.hold_seconds && `${ex.hold_seconds}s hold`}
                </p>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}

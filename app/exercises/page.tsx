'use client'
import { useState, useEffect } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

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
    stretch: { bg: 'rgba(16,185,129,0.15)', text: 'var(--maintain)' },
    strengthen: { bg: 'rgba(0,152,243,0.15)', text: 'var(--brand)' },
    mobility: { bg: 'rgba(255,137,24,0.15)', text: 'var(--warning)' },
    activation: { bg: 'rgba(239,68,68,0.15)', text: 'var(--danger)' },
    informational: { bg: 'rgba(107,114,128,0.15)', text: '#9CA3AF' },
  }
  return colors[cat] || { bg: 'rgba(107,114,128,0.15)', text: '#9CA3AF' }
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
        <div><p className="app-page-kicker">Movement library</p><h1 className="app-page-heading">Exercises</h1><p className="app-page-lede">Browse the movement building blocks used to shape a focused routine.</p></div>
        <span className="data-readout" style={{ color: 'var(--text-secondary)', fontSize: '.8rem' }}>{filtered.length} movements</span>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '24px' }} role="group" aria-label="Filter exercises by category">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveFilter(cat)}
            aria-pressed={activeFilter === cat}
            style={{
              padding: '7px 16px',
              borderRadius: '20px',
              border: activeFilter === cat ? '1.5px solid var(--brand)' : '1px solid rgba(255,255,255,0.12)',
              background: activeFilter === cat ? 'rgba(0,152,243,0.15)' : 'transparent',
              color: activeFilter === cat ? 'var(--brand)' : 'var(--text-secondary)',
              fontWeight: activeFilter === cat ? 600 : 400,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            {CATEGORY_LABELS[cat] || cat.charAt(0).toUpperCase() + cat.slice(1)}
            {cat !== 'all' && (
              <span style={{ marginLeft: '6px', fontSize: '0.75rem' }}>
                ({exercises.filter(e => e.category === cat).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: 'var(--text-secondary)' }}>Loading exercises...</p>}
      {error && <p role="alert" style={{ color: 'var(--danger)' }}>Error loading exercises: {error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <p style={{ color: 'var(--text-secondary)' }}>No exercises found{activeFilter !== 'all' ? ` for category "${activeFilter}"` : ''}.</p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
        {filtered.map((ex) => {
          const { bg, text } = getCategoryColor(ex.category)
          return (
            <article
              key={ex.id}
              className="app-panel exercise-library-card"
              style={{
                background: 'var(--surface)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '10px',
                padding: '16px',
              }}
            >
              {ex.poster_url && (
                <img
                  src={ex.poster_url}
                  alt=""
                  loading="lazy"
                  style={{ width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: 8, marginBottom: 10, background: 'var(--background)' }}
                />
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem', lineHeight: 1.3 }}>{ex.name}</span>
                <span style={{
                  fontSize: '0.7rem',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: bg,
                  color: text,
                  textTransform: 'uppercase',
                  flexShrink: 0,
                  marginLeft: '8px',
                }}>
                  {ex.category}
                </span>
              </div>
              {ex.instructions && (
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '8px' }}>
                  {ex.instructions.length > 120 ? ex.instructions.slice(0, 117) + '...' : ex.instructions}
                </p>
              )}
              {(ex.sets || ex.hold_seconds) && (
                <p style={{ fontSize: '0.8rem', color: 'var(--brand)', marginTop: '4px' }}>
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

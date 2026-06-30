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
    stretch: { bg: 'rgba(16,185,129,0.15)', text: '#34D399' },
    strengthen: { bg: 'rgba(99,102,241,0.15)', text: '#818CF8' },
    mobility: { bg: 'rgba(245,158,11,0.15)', text: '#FCD34D' },
    activation: { bg: 'rgba(239,68,68,0.15)', text: '#F87171' },
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
        .select('id, name, category, instructions, sets, hold_seconds')
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
    <div style={{ padding: '32px 24px', maxWidth: '960px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5', marginBottom: '24px' }}>
        Exercise Library
      </h1>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '24px' }} role="group" aria-label="Filter exercises by category">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveFilter(cat)}
            aria-pressed={activeFilter === cat}
            style={{
              padding: '7px 16px',
              borderRadius: '20px',
              border: activeFilter === cat ? '1.5px solid #6366F1' : '1px solid rgba(255,255,255,0.12)',
              background: activeFilter === cat ? 'rgba(99,102,241,0.15)' : 'transparent',
              color: activeFilter === cat ? '#818CF8' : '#A1A1AA',
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

      {loading && <p style={{ color: '#A1A1AA' }}>Loading exercises...</p>}
      {error && <p role="alert" style={{ color: '#EF4444' }}>Error loading exercises: {error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <p style={{ color: '#A1A1AA' }}>No exercises found{activeFilter !== 'all' ? ` for category "${activeFilter}"` : ''}.</p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
        {filtered.map((ex) => {
          const { bg, text } = getCategoryColor(ex.category)
          return (
            <div
              key={ex.id}
              style={{
                background: '#161618',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '10px',
                padding: '16px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <span style={{ fontWeight: 600, color: '#F5F5F5', fontSize: '0.95rem', lineHeight: 1.3 }}>{ex.name}</span>
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
                <p style={{ fontSize: '0.85rem', color: '#A1A1AA', lineHeight: 1.5, marginBottom: '8px' }}>
                  {ex.instructions.length > 120 ? ex.instructions.slice(0, 117) + '...' : ex.instructions}
                </p>
              )}
              {(ex.sets || ex.hold_seconds) && (
                <p style={{ fontSize: '0.8rem', color: '#818CF8', marginTop: '4px' }}>
                  {ex.sets && `${ex.sets} sets`}{ex.sets && ex.hold_seconds && ' · '}{ex.hold_seconds && `${ex.hold_seconds}s hold`}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

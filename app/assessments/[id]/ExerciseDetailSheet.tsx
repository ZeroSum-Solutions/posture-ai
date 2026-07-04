'use client'
/**
 * Bottom-sheet exercise detail for the coach-facing program: demo loop (or
 * poster), authored instructions, dose, and muscle roles. Read-only; fetched
 * on open from the exercises KB (RLS: authenticated read).
 */
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

type Detail = {
  name: string
  category: string
  instructions: string | null
  sets: number | null
  hold_seconds: number | null
  video_url: string | null
  poster_url: string | null
}
type MuscleRole = { muscle_slug: string; role: 'stretch' | 'strengthen' }

export default function ExerciseDetailSheet({ slug, name, onClose }: { slug: string; name: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [muscles, setMuscles] = useState<MuscleRole[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    let cancelled = false
    // One call: exercises row + its exercise_muscles rows via embedded
    // foreign-table select (FK exercise_muscles.exercise_id → exercises.id).
    supabase
      .from('exercises')
      .select('name, category, instructions, sets, hold_seconds, video_url, poster_url, exercise_muscles(muscle_slug, role)')
      .eq('slug', slug)
      .single()
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err || !data) { setError('Could not load exercise details.'); return }
        const { exercise_muscles, ...detailRow } = data as Detail & { exercise_muscles: MuscleRole[] }
        setDetail(detailRow)
        setMuscles(exercise_muscles ?? [])
      })
    return () => { cancelled = true }
  }, [slug])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const prettyMuscle = (s: string) => s.replace(/-/g, ' ')

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${name} details`}
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', background: '#161618', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px 16px 0 0', padding: 20 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#F5F5F5' }}>{name}</h3>
          <button onClick={onClose} aria-label="Close" style={{ width: 36, height: 36, minHeight: 36, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(0,0,0,0.35)', color: '#D4D4D8', cursor: 'pointer' }}>✕</button>
        </div>

        {error && <p role="alert" style={{ color: '#EF4444', fontSize: '0.85rem' }}>{error}</p>}
        {!detail && !error && <p style={{ color: '#A1A1AA', fontSize: '0.85rem' }}>Loading…</p>}

        {detail && (
          <>
            {detail.video_url ? (
              <video src={detail.video_url} poster={detail.poster_url ?? undefined} muted loop playsInline autoPlay controls={false} style={{ width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: 10, background: '#0A0A0B', marginBottom: 14 }} />
            ) : detail.poster_url ? (
              <img src={detail.poster_url} alt="" style={{ width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: 10, background: '#0A0A0B', marginBottom: 14 }} />
            ) : null}

            {(detail.sets || detail.hold_seconds) && (
              <p style={{ fontSize: '0.8rem', color: '#818CF8', margin: '0 0 10px' }}>
                {detail.sets && `${detail.sets} sets`}{detail.sets && detail.hold_seconds && ' · '}{detail.hold_seconds && `${detail.hold_seconds}s hold`}
              </p>
            )}
            {detail.instructions && (
              <p style={{ fontSize: '0.88rem', color: '#D4D4D8', lineHeight: 1.6, margin: '0 0 14px' }}>{detail.instructions}</p>
            )}
            {muscles.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {muscles.map((m) => (
                  <span key={m.muscle_slug} style={{ padding: '2px 10px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 600, textTransform: 'capitalize', background: m.role === 'stretch' ? 'rgba(16,185,129,0.15)' : 'rgba(99,102,241,0.15)', color: m.role === 'stretch' ? '#34D399' : '#818CF8' }}>
                    {prettyMuscle(m.muscle_slug)} · {m.role}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

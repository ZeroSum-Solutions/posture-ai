'use client'
/**
 * Bottom-sheet exercise detail for the coach-facing program: demo loop (or
 * poster), authored instructions, dose, and muscle roles. Read-only; fetched
 * on open through a practitioner-gated server route.
 */
import { useEffect, useState } from 'react'
import { useFocusTrap } from './useFocusTrap'

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
    const controller = new AbortController()
    ;(async () => {
      try {
        const response = await fetch(`/api/clinical-content/exercises/${encodeURIComponent(slug)}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        const body = await response.json().catch(() => ({})) as { detail?: Detail; muscles?: MuscleRole[] }
        if (!response.ok || !body.detail) throw new Error('unavailable')
        setDetail(body.detail)
        setMuscles(Array.isArray(body.muscles) ? body.muscles : [])
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.name === 'AbortError') return
        setError('Could not load exercise details.')
      }
    })()
    return () => controller.abort()
  }, [slug])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const dialogRef = useFocusTrap<HTMLDivElement>()

  const prettyMuscle = (s: string) => s.replace(/-/g, ' ')

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${name} details`}
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', background: 'var(--surface-glass)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '16px 16px 0 0', padding: 20 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>{name}</h3>
          <button onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, minHeight: 44, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(0,0,0,0.35)', color: 'var(--text-secondary)', cursor: 'pointer' }}>✕</button>
        </div>

        {error && <p role="alert" style={{ color: 'var(--review)', fontSize: '0.85rem' }}>{error}</p>}
        {!detail && !error && <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Loading…</p>}

        {detail && (
          <>
            {detail.video_url ? (
              <video src={detail.video_url} poster={detail.poster_url ?? undefined} muted loop playsInline autoPlay controls={false} style={{ width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: 10, background: 'var(--background)', marginBottom: 14 }} />
            ) : detail.poster_url ? (
              <img src={detail.poster_url} alt="" style={{ width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: 10, background: 'var(--background)', marginBottom: 14 }} />
            ) : null}

            {(detail.sets || detail.hold_seconds) && (
              <p style={{ fontSize: '0.8rem', color: 'var(--info)', margin: '0 0 10px' }}>
                {detail.sets && `${detail.sets} sets`}{detail.sets && detail.hold_seconds && ' · '}{detail.hold_seconds && `${detail.hold_seconds}s hold`}
              </p>
            )}
            {detail.instructions && (
              <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px' }}>{detail.instructions}</p>
            )}
            {muscles.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {muscles.map((m) => (
                  <span key={m.muscle_slug} style={{ padding: '2px 10px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 600, textTransform: 'capitalize', background: m.role === 'stretch' ? 'rgba(16,185,129,0.15)' : 'rgba(10,131,201,0.15)', color: m.role === 'stretch' ? 'var(--maintain)' : 'var(--info)' }}>
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

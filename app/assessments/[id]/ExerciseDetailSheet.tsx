'use client'
/**
 * Bottom-sheet exercise detail for the coach-facing program: demo loop (or
 * poster), authored instructions, dose, and muscle roles. Read-only; fetched
 * on open through a practitioner-gated server route.
 */
import { useEffect, useState } from 'react'
import { useFocusTrap } from './useFocusTrap'
import { Surface } from '@/components/array/Surface'
import { Chip } from '@/components/array/Chip'

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
      {/* Stops the backdrop's onClose from firing when the click lands on the sheet itself. */}
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560 }}>
        <Surface
          tier="feature"
          /* Bottom sheets sit flush with the viewport edge; flatten the tier-1
             shell's bottom corners rather than inventing a fourth radius family. */
          style={{ borderRadius: '24px 24px 0 0' }}
          innerStyle={{ maxHeight: '85vh', overflowY: 'auto' }}
        >
          <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${name} details`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 className="t-title-2">{name}</h3>
              <button onClick={onClose} aria-label="Close" className="a-secondary" style={{ width: 44, padding: 0 }}>✕</button>
            </div>

            {error && <p role="alert" className="a-error">{error}</p>}
            {!detail && !error && <p className="t-body">Loading…</p>}

            {detail && (
              <>
                {detail.video_url ? (
                  <video src={detail.video_url} poster={detail.poster_url ?? undefined} muted loop playsInline autoPlay controls={false} style={{ width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: 'var(--radius-sm)', background: 'var(--background)', marginBottom: 14 }} />
                ) : detail.poster_url ? (
                  <img src={detail.poster_url} alt="" style={{ width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: 'var(--radius-sm)', background: 'var(--background)', marginBottom: 14 }} />
                ) : null}

                {(detail.sets || detail.hold_seconds) && (
                  <p className="t-body" style={{ color: 'var(--info)', margin: '0 0 10px' }}>
                    {detail.sets && `${detail.sets} sets`}{detail.sets && detail.hold_seconds && ' · '}{detail.hold_seconds && `${detail.hold_seconds}s hold`}
                  </p>
                )}
                {detail.instructions && (
                  <p className="t-body" style={{ margin: '0 0 14px' }}>{detail.instructions}</p>
                )}
                {muscles.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {muscles.map((m) => (
                      // Muscle-role tint mirrors the pre-migration mapping (stretch → maintain
                      // green, strengthen → info blue), now routed through the Chip primitive
                      // instead of ad hoc rgba fills.
                      <Chip key={m.muscle_slug} band={m.role === 'stretch' ? 'maintain' : 'info'} size="sm">
                        <span style={{ textTransform: 'capitalize' }}>{prettyMuscle(m.muscle_slug)} · {m.role}</span>
                      </Chip>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </Surface>
      </div>
    </div>
  )
}

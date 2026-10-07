'use client'
/**
 * Bottom-sheet exercise detail for the coach-facing program: demo loop (or
 * poster), authored instructions, dose, and muscle roles. Read-only; fetched
 * on open through a practitioner-gated server route. Shell is the shared
 * components/ui Sheet (DESIGN.md › 3.8) — this file now owns content only.
 */
import { useEffect, useState } from 'react'
import { Sheet } from '@/components/ui'
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

  const prettyMuscle = (s: string) => s.replace(/-/g, ' ')

  return (
    <Sheet
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      title={`${name} details`}
      detents={['medium']}
      data-testid={`exercise-detail-sheet-${slug}`}
    >
      {error && <p role="alert" className="a-error">{error}</p>}
      {!detail && !error && <p className="t-body">Loading…</p>}

      {detail && (
        <>
          {detail.video_url ? (
            <video src={detail.video_url} poster={detail.poster_url ?? undefined} muted loop playsInline autoPlay controls={false} style={{ width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: 'var(--r-sm)', background: 'var(--bg)', marginBottom: 'var(--s-16)' }} />
          ) : detail.poster_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={detail.poster_url} alt="" style={{ width: '100%', aspectRatio: '16 / 10', objectFit: 'cover', borderRadius: 'var(--r-sm)', background: 'var(--bg)', marginBottom: 'var(--s-16)' }} />
          ) : null}

          {(detail.sets || detail.hold_seconds) && (
            <p className="t-body" style={{ color: 'var(--accent)', margin: '0 0 var(--s-12)' }}>
              {detail.sets && `${detail.sets} sets`}{detail.sets && detail.hold_seconds && ' · '}{detail.hold_seconds && `${detail.hold_seconds}s hold`}
            </p>
          )}
          {detail.instructions && (
            <p className="t-body" style={{ color: 'var(--text-2)', margin: '0 0 var(--s-16)' }}>{detail.instructions}</p>
          )}
          {muscles.length > 0 && (
            <div style={{ display: 'flex', gap: 'var(--s-8)', flexWrap: 'wrap' }}>
              {muscles.map((m) => (
                // Muscle-role tint mirrors the pre-migration mapping (stretch → maintain
                // green, strengthen → info blue), routed through the Chip primitive.
                <Chip key={m.muscle_slug} band={m.role === 'stretch' ? 'maintain' : 'info'} size="sm">
                  <span style={{ textTransform: 'capitalize' }}>{prettyMuscle(m.muscle_slug)} · {m.role}</span>
                </Chip>
              ))}
            </div>
          )}
        </>
      )}
    </Sheet>
  )
}

'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { WorkoutPlayer, type RatingPayload, type RunPatch } from '../../workouts/_player/WorkoutPlayer'
import type { SessionSnapshot } from '@/lib/workout/generateWorkoutSession'

interface PublicSession {
  snapshot: SessionSnapshot
  estimatedDurationSec: number | null
  clientFirstName: string | null
  expiresAt: string | null
}

/**
 * Public follow-along landing for a shared workout. No auth — the hashed token in
 * the URL is the credential, resolved server-side by /api/workouts/token/[token]
 * (resolve_workout_token RPC: expiry/revocation/approval/tombstone gates + a
 * redacted projection). Playback resumes from localStorage (there is no
 * server-side run-write on the public path); ratings post to the token rate route
 * with NO free-text notes (allowNotes={false}). The screening disclaimer travels
 * on the snapshot and renders on the start card.
 */
export default function ShareTokenPage() {
  const params = useParams<{ token: string }>()
  const token = params.token
  const [data, setData] = useState<PublicSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/workouts/token/${token}`)
        if (!res.ok) {
          if (!cancelled) {
            setError('This session link is not available or has expired.')
            setLoading(false)
          }
          return
        }
        const json = (await res.json()) as PublicSession
        if (!cancelled) {
          setData(json)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setError('Something went wrong loading this session.')
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  const resumeKey = `postureai:resume:${token}`
  const readResume = (): { index: number; items?: { slug: string; completed: boolean; skipped: boolean }[] } | null => {
    if (typeof window === 'undefined') return null
    try {
      const raw = localStorage.getItem(resumeKey)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return typeof parsed?.index === 'number' ? parsed : null
    } catch {
      return null
    }
  }
  const saveRun = (patch: RunPatch) => {
    try {
      localStorage.setItem(resumeKey, JSON.stringify({ index: patch.current_item_index ?? 0, items: patch.items ?? [] }))
    } catch {
      /* private mode / quota — resume is best-effort */
    }
  }
  const submitRating = async (payload: RatingPayload): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`/api/workouts/token/${token}/rate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        return { ok: false, error: j.error ?? 'Could not save your feedback.' }
      }
      return { ok: true }
    } catch {
      return { ok: false, error: 'Network error — please try again.' }
    }
  }

  if (loading) return <CenteredMessage>Loading your session…</CenteredMessage>
  if (error || !data) return <CenteredMessage>{error ?? 'This session link is not available.'}</CenteredMessage>

  return (
    <WorkoutPlayer
      snapshot={data.snapshot}
      clientFirstName={data.clientFirstName}
      allowNotes={false}
      resume={readResume()}
      saveRun={saveRun}
      submitRating={submitRating}
      onExit={() => window.location.reload()}
    />
  )
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: '#08080A',
        color: '#A1A1AA',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        textAlign: 'center',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '0.95rem',
      }}
    >
      {children}
    </div>
  )
}

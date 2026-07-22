'use client'

import { useCallback, useEffect, useState } from 'react'
import { WorkoutPlayer, type RatingPayload, type RunPatch } from '../../workouts/_player/WorkoutPlayer'
import type { SessionSnapshot } from '@/lib/workout/generateWorkoutSession'

interface PublicSession {
  snapshot: SessionSnapshot
  estimatedDurationSec: number | null
  clientFirstName: string | null
  expiresAt: string | null
}

/**
 * Client-only public player. The parent server component verifies that workout
 * content is enabled before this code is rendered or hydrated.
 */
export default function ShareTokenClient({ token }: { token: string }) {
  const [data, setData] = useState<PublicSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // no-store: a PHI-adjacent bearer-token response must never be served
        // from a shared cache after the link is revoked or expired.
        const res = await fetch(`/api/workouts/token/${token}`, { cache: 'no-store' })
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
  const readResume = (): { index: number; items?: { slug: string; completed: boolean; skipped: boolean }[]; revision?: number } | null => {
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
  // Stable identity — saveRun sits in the player's persistence-effect deps.
  const saveRun = useCallback((patch: RunPatch) => {
    try {
      localStorage.setItem(
        resumeKey,
        JSON.stringify({ index: patch.current_item_index ?? 0, items: patch.items ?? [], revision: patch.revision ?? 0 }),
      )
    } catch {
      /* private mode / quota — resume is best-effort */
    }
  }, [resumeKey])
  const submitRating = useCallback(async (payload: RatingPayload): Promise<{ ok: boolean; error?: string }> => {
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
  }, [token])

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
        background: 'var(--background)',
        color: 'var(--text-secondary)',
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

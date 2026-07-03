'use client'
import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { WorkoutPlayer, type RunPatch, type RatingPayload } from '../_player/WorkoutPlayer'
import type { SessionSnapshot } from '@/lib/workout/generateWorkoutSession'

/**
 * Authenticated (in-clinic) player adapter: wires the reusable WorkoutPlayer to
 * the practitioner-scoped run/rate routes. Notes are allowed on this path
 * (lint-checked server-side).
 */
export default function AuthedPlayer({
  sessionId,
  snapshot,
  clientFirstName,
  resume,
  backHref,
}: {
  sessionId: string
  snapshot: SessionSnapshot
  clientFirstName?: string | null
  resume?: { index: number; items?: { slug: string; completed: boolean; skipped: boolean }[]; revision?: number } | null
  backHref: string
}) {
  const router = useRouter()

  // Stable identities: saveRun sits in the player's persistence-effect deps, so
  // a fresh function per render would re-run that effect for nothing.
  const saveRun = useCallback((patch: RunPatch) => {
    fetch(`/api/workouts/${sessionId}/run`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
      keepalive: true,
    }).catch(() => {})
  }, [sessionId])

  const submitRating = useCallback(async (payload: RatingPayload): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`/api/workouts/${sessionId}/rate`, {
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
  }, [sessionId])

  const onExit = useCallback(() => router.push(backHref), [router, backHref])

  return (
    <WorkoutPlayer
      snapshot={snapshot}
      clientFirstName={clientFirstName}
      allowNotes
      resume={resume}
      saveRun={saveRun}
      submitRating={submitRating}
      onExit={onExit}
    />
  )
}

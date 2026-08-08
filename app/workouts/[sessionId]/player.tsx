'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  WorkoutPlayer,
  type RunPatch,
  type RatingPayload,
} from '../_player/WorkoutPlayer'
import type { SessionSnapshot } from '@/lib/workout/generateWorkoutSession'

interface RunSaveResult {
  ok: boolean
  revision?: number
  conflict?: boolean
  conflictRevision?: number
  error?: string
}

type RunSaveStatus = 'saved' | 'saving' | 'unsaved' | 'conflict'
const RUN_SAVE_ATTEMPTS = 3
const RUN_SAVE_RETRY_MS = [250, 750] as const

export async function saveWorkoutRun(sessionId: string, patch: RunPatch): Promise<RunSaveResult> {
  try {
    const response = await fetch(`/api/workouts/${sessionId}/run`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
      keepalive: true,
    })
    const body = await response.json().catch(() => ({})) as {
      error?: string
      stale?: boolean
      revision?: number
      current_revision?: number
    }
    if (!response.ok) {
      return {
        ok: false,
        error: body.error ?? 'Failed to save progress.',
        ...(response.status === 409 ? { conflict: true } : {}),
        ...(response.status === 409 && typeof body.current_revision === 'number'
          ? { conflictRevision: body.current_revision }
          : {}),
      }
    }
    if (body.stale === true) {
      // The route uses a successful stale response for idempotent server-side
      // writes, but this client queues full authoritative snapshots. Handle that
      // response as a conflict so a queued stale snapshot cannot advance above
      // newer progress using the returned server revision.
      return {
        ok: false,
        error: 'Workout progress changed in another request.',
        conflict: true,
        ...(typeof body.revision === 'number' ? { conflictRevision: body.revision } : {}),
      }
    }
    return { ok: true, revision: body.revision ?? patch.revision }
  } catch {
    return { ok: false, error: 'Network error while saving progress.' }
  }
}

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function useRunSaveQueue(
  sessionId: string,
  initialRevision: number,
): {
  enqueue: (patch: RunPatch) => void
  retry: () => void
  status: RunSaveStatus
  error: string
} {
  const queueRef = useRef<RunPatch[]>([])
  const isDrainingRef = useRef(false)
  const hasConflictRef = useRef(false)
  const acknowledgedRevisionRef = useRef(initialRevision)
  const mountedRef = useRef(true)
  const [status, setStatus] = useState<RunSaveStatus>('saved')
  const [error, setError] = useState('')

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const drain = useCallback(async () => {
    if (isDrainingRef.current || hasConflictRef.current || queueRef.current.length === 0) return
    isDrainingRef.current = true
    if (mountedRef.current) {
      setStatus('saving')
      setError('')
    }

    while (queueRef.current.length > 0) {
      const patch = queueRef.current[0]!
      let didSave = false
      let lastError = 'Failed to save progress.'

      for (let attempt = 0; attempt < RUN_SAVE_ATTEMPTS; attempt += 1) {
        const revision = acknowledgedRevisionRef.current + 1
        const result = await saveWorkoutRun(sessionId, { ...patch, revision })
        if (result.ok) {
          acknowledgedRevisionRef.current = Math.max(revision, result.revision ?? revision)
          queueRef.current.shift()
          didSave = true
          break
        }

        lastError = result.error ?? lastError
        if (result.conflict) {
          // Revisioned patches are full authoritative snapshots, not deltas.
          // Promoting this rejected snapshot above the server's revision could
          // replace newer progress from another tab/device, so conflict is a
          // terminal queue state until the latest server row is reloaded.
          hasConflictRef.current = true
          isDrainingRef.current = false
          if (mountedRef.current) {
            setError('Progress changed in another tab or device. Reload the latest progress before continuing.')
            setStatus('conflict')
          }
          return
        }
        if (attempt < RUN_SAVE_ATTEMPTS - 1) {
          await waitForRetry(RUN_SAVE_RETRY_MS[attempt] ?? RUN_SAVE_RETRY_MS[1])
        }
      }

      if (!didSave) {
        isDrainingRef.current = false
        if (mountedRef.current) {
          setError(lastError)
          setStatus('unsaved')
        }
        return
      }
    }

    isDrainingRef.current = false
    if (mountedRef.current) setStatus('saved')
  }, [sessionId])

  const enqueue = useCallback((patch: RunPatch) => {
    // WorkoutPlayer's fire-and-forget counter is advisory on this authenticated
    // path. The queue owns the transmitted revision and advances it only on ack.
    const { revision, ...unversionedPatch } = patch
    void revision
    queueRef.current.push(unversionedPatch)
    void drain()
  }, [drain])

  const retry = useCallback(() => {
    void drain()
  }, [drain])

  return { enqueue, retry, status, error }
}

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
  const { enqueue: saveRun, retry, status: saveStatus, error: saveError } = useRunSaveQueue(
    sessionId,
    resume?.revision ?? 0,
  )

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
    <>
      <WorkoutPlayer
        snapshot={snapshot}
        clientFirstName={clientFirstName}
        allowNotes
        resume={resume}
        saveRun={saveRun}
        submitRating={submitRating}
        onExit={onExit}
      />
      {saveStatus !== 'saved' && (
        <div
          role={saveStatus === 'unsaved' || saveStatus === 'conflict' ? 'alert' : 'status'}
          aria-live={saveStatus === 'unsaved' || saveStatus === 'conflict' ? 'assertive' : 'polite'}
          style={{
            position: 'fixed',
            top: 'max(12px, env(safe-area-inset-top, 0px))',
            left: 'max(12px, env(safe-area-inset-left, 0px))',
            zIndex: 107,
            maxWidth: 300,
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            border: `1px solid ${saveStatus === 'unsaved' || saveStatus === 'conflict' ? 'var(--review)' : 'var(--hairline)'}`,
            background: 'var(--surface-glass-strong)',
            color: 'var(--text-primary)',
            fontSize: 13,
          }}
        >
          {saveStatus === 'saving' ? (
            'Saving workout progress…'
          ) : saveStatus === 'conflict' ? (
            <>
              <div>{saveError}</div>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="a-secondary"
                style={{ marginTop: 8, minHeight: 36 }}
              >
                Reload latest progress
              </button>
            </>
          ) : (
            <>
              <div>Progress is not saved. {saveError}</div>
              <button type="button" onClick={retry} className="a-secondary" style={{ marginTop: 8, minHeight: 36 }}>
                Retry saving
              </button>
            </>
          )}
        </div>
      )}
    </>
  )
}

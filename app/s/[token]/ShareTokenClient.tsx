'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { WorkoutPlayer, type RatingPayload, type RunPatch } from '../../workouts/_player/WorkoutPlayer'
import type { SessionItem, SessionSnapshot } from '@/lib/workout/generateWorkoutSession'
import ActionBar from '@/components/ui/ActionBar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import Icon from '@/components/array/Icon'
import { Sheet } from '@/components/ui/Sheet'
import { Skeleton } from '@/components/ui/Skeleton'
import styles from './ShareToken.module.css'

interface PublicSession {
  snapshot: SessionSnapshot
  estimatedDurationSec: number | null
  clientFirstName: string | null
  expiresAt: string | null
}

function timingLabel(item: SessionItem): string {
  const { timing } = item
  if (timing.kind === 'hold') return `${timing.sets} × ${timing.secondsPerSet}s hold`
  return `${timing.sets} × ${timing.repsPerSet} reps`
}

function durationLabel(estimatedDurationSec: number | null): string | null {
  if (!estimatedDurationSec) return null
  const minutes = Math.max(1, Math.round(estimatedDurationSec / 60))
  return `${minutes} min`
}

/**
 * Client-only public player. The parent server component verifies that workout
 * content is enabled before this code is rendered or hydrated.
 *
 * Shows a preview of the session (spec §5 "Share") before handing off to the
 * existing immersive `WorkoutPlayer` — the player itself, its persistence and
 * its API calls are unchanged.
 */
export default function ShareTokenClient({ token }: { token: string }) {
  const [data, setData] = useState<PublicSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [activeStep, setActiveStep] = useState<SessionItem | null>(null)

  const fetchSession = useCallback(async (): Promise<{ ok: true; session: PublicSession } | { ok: false; error: string }> => {
    try {
      // no-store: a PHI-adjacent bearer-token response must never be served
      // from a shared cache after the link is revoked or expired.
      const res = await fetch(`/api/workouts/token/${token}`, { cache: 'no-store' })
      if (!res.ok) return { ok: false, error: 'This session link is not available or has expired.' }
      return { ok: true, session: (await res.json()) as PublicSession }
    } catch {
      return { ok: false, error: 'Something went wrong loading this session.' }
    }
  }, [token])

  // Fetch once on mount. No polling: this is a single link opened once from a
  // text message or QR code, not a live-updating view (audit #13).
  useEffect(() => {
    let cancelled = false
    void fetchSession().then((result) => {
      if (cancelled) return
      if (result.ok) setData(result.session)
      else setError(result.error)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [fetchSession])

  async function retry() {
    setRetrying(true)
    setError(null)
    const result = await fetchSession()
    if (result.ok) setData(result.session)
    else setError(result.error)
    setRetrying(false)
  }

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

  if (loading) {
    return (
      <div className={`app-screen app-screen-x app-stack ${styles.page}`} aria-busy="true">
        <Skeleton shape="line" lines={2} />
        <Skeleton shape="card" />
        <Skeleton shape="row" lines={3} />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className={`app-screen app-screen-x ${styles.page}`}>
        <ErrorState
          variant="page"
          headingLevel="h1"
          title="Session link unavailable"
          body={error ?? 'This session link is not available.'}
          onRetry={() => void retry()}
          retrying={retrying}
        />
      </div>
    )
  }

  if (playing) {
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

  const items = data.snapshot.items
  const duration = durationLabel(data.estimatedDurationSec)

  return (
    <div className={`app-screen app-screen--bar app-screen-x ${styles.page}`}>
      <header className={styles.header}>
        <p className="t-micro">Shared workout</p>
        <h1 className="t-display">
          {data.clientFirstName ? `${data.clientFirstName}’s session` : 'Your session'}
        </h1>
        <p className={styles.stats}>
          <span className={styles.stat}>
            <span className={styles.statValue}>{items.length}</span>
            <span className="t-micro">exercise{items.length === 1 ? '' : 's'}</span>
          </span>
          {duration && (
            <span className={styles.stat}>
              <span className={styles.statValue}>{duration}</span>
              <span className="t-micro">estimated</span>
            </span>
          )}
        </p>
      </header>

      {items.length === 0 ? (
        <EmptyState
          icon="dumbbell-small-linear"
          title="Nothing to show yet"
          body="This session does not have any exercises in it."
        />
      ) : (
        <ol className={styles.list} aria-label="Exercises in this session">
          {items.map((item, position) => (
            <li key={item.index} className={styles.item} style={{ '--i': Math.min(position, 8) } as CSSProperties}>
              <button
                type="button"
                className={styles.row}
                onClick={() => setActiveStep(item)}
                data-testid={`share-exercise-${item.slug}`}
              >
                <span className={styles.index} aria-hidden="true">{String(position + 1).padStart(2, '0')}</span>
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>{item.name}</span>
                  <span className="t-label">{timingLabel(item)}</span>
                </span>
                <Icon name="alt-arrow-right-linear" size={18} className={styles.chevron} />
              </button>
            </li>
          ))}
        </ol>
      )}

      <p className="t-label">
        Screening support only — not a medical diagnosis.
      </p>

      <Sheet
        open={activeStep !== null}
        onOpenChange={(open) => { if (!open) setActiveStep(null) }}
        title={activeStep?.name ?? ''}
      >
        {activeStep ? (
          <div className="app-stack">
            <p className="t-callout">{timingLabel(activeStep)}</p>
            {activeStep.steps && activeStep.steps.length > 0 ? (
              <ol className="t-body" style={{ display: 'grid', gap: 'var(--s-12)', paddingLeft: '1.2em' }}>
                {activeStep.steps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            ) : (
              <p className="t-body">{activeStep.instructions}</p>
            )}
          </div>
        ) : null}
      </Sheet>

      <ActionBar>
        <Button variant="primary" size="lg" block onClick={() => setPlaying(true)} data-testid="share-start-workout">
          Start workout
        </Button>
      </ActionBar>
    </div>
  )
}

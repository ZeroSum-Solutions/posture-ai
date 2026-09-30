'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnatomyGlyph } from '../../../components/SignalGlyphs'
import { findingsToMuscleStates, type AssessmentFinding } from './findingsToMuscleStates'
import {
  musclesForFinding,
  spotlightIds,
  viewerStates,
  type BodySide,
  type MuscleSides,
  type SideState,
} from './anatomyFocus'
import styles from './MuscleModel3D.module.css'

// Same-origin viewer build (public/muscle-viewer/**). card=0: this page shows its own muscle
// detail modal on the viewer's `selection` event instead of the viewer's built-in card.
const VIEWER_SRC = '/muscle-viewer/index.html?embed=1&legend=0&card=0'
const HELLO_INTERVAL_MS = 300
const HELLO_MAX_TRIES = 40
const MODEL_READY_TIMEOUT_MS = 30_000
// The live model shares this page's main thread (same-origin iframe). It mounts once the page
// has gone idle, so parsing three.js and the ~11 MB of anatomy never competes with first paint
// or the first interactions.
const IDLE_MOUNT_TIMEOUT_MS = 2_500

export interface AnatomySpotlight {
  /** Finding label shown on the spotlight bar, e.g. "Forward head posture". */
  label: string
  finding: AssessmentFinding
}

type Status = 'idle' | 'loading' | 'ready' | 'unavailable'

function prefersDataSaving(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return connection?.saveData === true
}

function sideTone(state: SideState | null): string | undefined {
  if (!state) return undefined
  return state.role === 'tight' ? 'var(--review)' : 'var(--info)'
}

function MuscleChip({ muscle, active, onSelect }: { muscle: MuscleSides; active: boolean; onSelect: () => void }) {
  const left = sideTone(muscle.left)
  const right = sideTone(muscle.right)
  const describe = (label: string, s: SideState | null) =>
    s ? `${label} ${s.role === 'tight' ? 'tight' : 'weak'}` : `${label} no finding`
  return (
    <button
      type="button"
      className={styles.muscleChip}
      aria-pressed={active}
      onClick={onSelect}
      aria-label={`${muscle.name}: ${describe('left', muscle.left)}, ${describe('right', muscle.right)}. Open details`}
    >
      <span className={styles.chipDots} aria-hidden>
        <span style={{ background: right ?? 'var(--hairline)' }} />
        <span style={{ background: left ?? 'var(--hairline)' }} />
      </span>
      {muscle.name}
    </button>
  )
}

/**
 * Hero 3D posture map for the results page. Paints every finding's muscles per side (tight red,
 * weak blue, shaded by severity × evidence), spotlights one finding's muscles when the page
 * selects it, and reports taps on the model through `onSelectMuscle` so the page can open its
 * muscle detail modal. `referenceOnly` shows plain anatomy with no assessment mapping.
 */
export default function MuscleModel3D({
  findings,
  referenceOnly = false,
  spotlight = null,
  onClearSpotlight,
  selectedMuscle = null,
  onSelectMuscle,
}: {
  findings: AssessmentFinding[]
  referenceOnly?: boolean
  spotlight?: AnatomySpotlight | null
  onClearSpotlight?: () => void
  /** Viewer id of the muscle whose detail is open, or null. */
  selectedMuscle?: string | null
  onSelectMuscle?: (viewerId: string | null, side: BodySide | null) => void
}) {
  const { notShown } = useMemo(() => findingsToMuscleStates(referenceOnly ? [] : findings), [findings, referenceOnly])
  const allStates = useMemo(
    () => viewerStates(findingsToMuscleStates(referenceOnly ? [] : findings).states),
    [findings, referenceOnly],
  )
  const spotlightMuscles = useMemo(() => (spotlight ? musclesForFinding(spotlight.finding) : []), [spotlight])
  const spotlightStates = useMemo(
    () => (spotlight ? viewerStates(findingsToMuscleStates([spotlight.finding]).states) : null),
    [spotlight],
  )
  const highlight = useMemo(() => (spotlight ? spotlightIds(spotlightMuscles) : null), [spotlight, spotlightMuscles])

  const [mounted, setMounted] = useState(false)
  const [frameKey, setFrameKey] = useState(0)
  const [status, setStatus] = useState<Status>('idle')
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const readyRef = useRef(false)
  const viewerSelectionRef = useRef<string | null>(null)
  const latest = useRef({ states: spotlightStates ?? allStates, highlight, selectedMuscle, onSelectMuscle })
  useEffect(() => {
    latest.current = { states: spotlightStates ?? allStates, highlight, selectedMuscle, onSelectMuscle }
  })

  // Mount the live model once the page is idle (or on tap when the browser asks to save data).
  useEffect(() => {
    // Reference-only anatomy (no assessment mapped) stays an explicit tap: nothing to show yet.
    if (mounted || referenceOnly || prefersDataSaving()) return
    const start = () => {
      setStatus('loading')
      setMounted(true)
    }
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback
    if (idle) {
      const id = idle(start, { timeout: IDLE_MOUNT_TIMEOUT_MS })
      return () => (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id)
    }
    const timer = window.setTimeout(start, IDLE_MOUNT_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [mounted, referenceOnly])

  const post = (message: Record<string, unknown>) => {
    const frame = iframeRef.current?.contentWindow
    if (!frame) return
    try {
      frame.postMessage({ source: 'posture-ai', ...message }, window.location.origin)
    } catch {
      // The frame may be torn down while navigation completes.
    }
  }
  const postRef = useRef(post)
  useEffect(() => {
    postRef.current = post
  })

  // Handshake + event intake for the mounted frame.
  useEffect(() => {
    if (!mounted) return
    const origin = window.location.origin
    let tries = 0
    let ping: ReturnType<typeof setInterval> | null = null
    const stopPing = () => {
      if (ping) clearInterval(ping)
      ping = null
    }
    const sync = () => {
      const { states, highlight: ids, selectedMuscle: selected } = latest.current
      postRef.current({ type: 'applyMuscleStates', states })
      postRef.current({ type: 'highlight', muscles: ids })
      if (selected) postRef.current({ type: 'select', muscle: selected })
    }
    const timeout = window.setTimeout(() => {
      if (!readyRef.current) setStatus('unavailable')
    }, MODEL_READY_TIMEOUT_MS)

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as { source?: string; type?: string; muscle?: unknown; side?: unknown; origin?: unknown } | null
      if (!data || data.source !== 'muscle-viewer') return
      if (data.type === 'ready') {
        stopPing()
        sync()
      } else if (data.type === 'model-ready') {
        readyRef.current = true
        stopPing()
        window.clearTimeout(timeout)
        setStatus('ready')
        sync()
      } else if (data.type === 'model-unavailable') {
        stopPing()
        window.clearTimeout(timeout)
        setStatus('unavailable')
      } else if (data.type === 'selection') {
        // Only the practitioner's own picks in the viewer drive the page; selections the viewer
        // makes in response to this page's commands must not echo back (e.g. close the modal).
        if (data.origin === 'host') return
        const muscle = typeof data.muscle === 'string' ? data.muscle : null
        const side = data.side === 'left' || data.side === 'right' ? data.side : null
        viewerSelectionRef.current = muscle
        latest.current.onSelectMuscle?.(muscle, side)
      }
    }
    window.addEventListener('message', onMessage)
    const hello = () => {
      postRef.current({ type: 'hello' })
      tries += 1
      if (tries >= HELLO_MAX_TRIES) stopPing()
    }
    hello()
    ping = setInterval(hello, HELLO_INTERVAL_MS)

    return () => {
      window.removeEventListener('message', onMessage)
      stopPing()
      window.clearTimeout(timeout)
      postRef.current({ type: 'clear' })
      readyRef.current = false
    }
  }, [frameKey, mounted])

  // Keep the viewer in step with the page: states + spotlight, and the open muscle.
  useEffect(() => {
    if (!mounted) return
    post({ type: 'applyMuscleStates', states: spotlightStates ?? allStates })
    post({ type: 'highlight', muscles: highlight })
  }, [mounted, allStates, spotlightStates, highlight])

  useEffect(() => {
    if (!mounted || viewerSelectionRef.current === selectedMuscle) return
    viewerSelectionRef.current = selectedMuscle
    post({ type: 'select', muscle: selectedMuscle })
  }, [mounted, selectedMuscle])

  const load = () => {
    setStatus('loading')
    setMounted(true)
  }
  const retry = () => {
    readyRef.current = false
    setStatus('loading')
    setFrameKey((key) => key + 1)
  }

  return (
    <section className={styles.hero} aria-labelledby="anatomy-viewer-title">
      <h2 id="anatomy-viewer-title" className="sr-only">
        {referenceOnly ? 'Explore anatomy in 3D' : 'Posture map'}
      </h2>

      <div className={styles.viewerFrame}>
        {mounted ? (
          <iframe
            key={frameKey}
            ref={iframeRef}
            src={VIEWER_SRC}
            title="Interactive 3D anatomy model"
            className={styles.iframe}
            data-status={status}
          />
        ) : null}

        {!mounted && (
          <button type="button" onClick={load} className={styles.launchButton}>
            <span className={styles.glyph} aria-hidden><AnatomyGlyph size={54} /></span>
            <span className={styles.launchTitle}>Open interactive 3D anatomy</span>
            <span className={styles.launchMeta}>About 11 MB · loads once</span>
          </button>
        )}
        {mounted && status === 'loading' && (
          <div className={styles.statusOverlay} role="status">
            <span className={styles.glyphPulse} aria-hidden><AnatomyGlyph size={46} /></span>
            Loading your posture map…
          </div>
        )}
        {status === 'unavailable' && (
          <div className={styles.statusOverlay} role="alert">
            <p>The 3D view did not load. Findings and measurements remain available below.</p>
            <button type="button" onClick={retry} className={styles.retryButton}>Try again</button>
          </div>
        )}

        {spotlight && (
          <div className={styles.spotlight}>
            <div className={styles.spotlightHead}>
              <span className={styles.spotlightLabel}>{spotlight.label}</span>
              <button type="button" className={styles.clear} onClick={onClearSpotlight} aria-label="Show all findings">
                ✕
              </button>
            </div>
            {spotlightMuscles.length > 0 ? (
              <div className={styles.chips} role="group" aria-label={`${spotlight.label} muscles`}>
                {spotlightMuscles.map((m) => (
                  <MuscleChip
                    key={m.slug}
                    muscle={m}
                    active={!!m.viewerId && m.viewerId === selectedMuscle}
                    onSelect={() => onSelectMuscle?.(m.viewerId ?? m.slug.replace(/-/g, '_'), null)}
                  />
                ))}
              </div>
            ) : (
              <p className={styles.spotlightEmpty}>No muscles are linked to this finding.</p>
            )}
          </div>
        )}
      </div>

      {!referenceOnly && (
        <div className={styles.legend} aria-label="3D model legend">
          <span><i style={{ background: 'var(--review)' }} aria-hidden />Tight</span>
          <span><i style={{ background: 'var(--info)' }} aria-hidden />Weak</span>
          <span className={styles.legendNote}>shaded by severity</span>
        </div>
      )}
      <p className={styles.boundary}>
        {referenceOnly
          ? 'A general anatomy illustration, not a reconstruction of the captured person.'
          : 'Screening indication, not a diagnosis. Colors show where this scan suggests muscles may be tight or weak; confirm with hands-on testing.'}
        {notShown.length > 0 && !referenceOnly
          ? ` Not drawn in this model: ${notShown.map((item) => item.name).join(', ')}.`
          : ''}
      </p>
      <p className={styles.attribution}>Anatomy: BodyParts3D, © The Database Center for Life Science — CC BY-SA 2.1 JP.</p>
    </section>
  )
}

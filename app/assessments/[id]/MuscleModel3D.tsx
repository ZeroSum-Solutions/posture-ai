'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnatomyGlyph } from '../../../components/SignalGlyphs'
import { BAND_TONE, tone, type SeverityBand } from '@/components/array/severity'
import { findingsToMuscleStates, type AssessmentFinding } from './findingsToMuscleStates'
import {
  STATE_COLORS,
  musclesForFinding,
  prettySlug,
  sidesBySlug,
  sidesSummary,
  spotlightIds,
  viewerStates,
  type BodySide,
  type MuscleSides,
  type SideState,
} from './anatomyFocus'
import styles from './MuscleModel3D.module.css'

// Same-origin viewer build (public/muscle-viewer/**). The page owns the controls and the muscle
// detail, so the viewer shows anatomy plus its two edge rails: muscles head-to-toe on the left
// (drag a finger, release to isolate) and this assessment's findings on the right. No card
// (card=0), no in-canvas control panel (controls=0).
const VIEWER_SRC = '/muscle-viewer/index.html?embed=1&legend=0&card=0&controls=0'
const HELLO_INTERVAL_MS = 300
const HELLO_MAX_TRIES = 40
const MODEL_READY_TIMEOUT_MS = 30_000
// The live model shares this page's main thread (same-origin iframe). It mounts once the page
// has gone idle, so parsing three.js and the ~11 MB of anatomy never competes with first paint
// or the first interactions.
const IDLE_MOUNT_TIMEOUT_MS = 2_500

/** A finding that can be spotlighted on the map. */
export interface FindingOption {
  key: string
  label: string
  zoneLabel: string
  band: SeverityBand
  finding: AssessmentFinding
}

type Status = 'idle' | 'loading' | 'ready' | 'unavailable'

function prefersDataSaving(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return connection?.saveData === true
}

function sideColor(state: SideState | null): string {
  if (!state) return 'var(--hairline)'
  return state.role === 'tight' ? STATE_COLORS.tight : STATE_COLORS.weak
}

function SideDots({ muscle }: { muscle: Pick<MuscleSides, 'left' | 'right'> }) {
  // Subject's right then left, mirroring the front view.
  return (
    <span className={styles.sideDots} aria-hidden>
      <span style={{ background: sideColor(muscle.right) }} />
      <span style={{ background: sideColor(muscle.left) }} />
    </span>
  )
}

/** "2 tight · 3 weak" — a muscle tight on one side and weak on the other counts in both. */
function muscleCounts(muscles: MuscleSides[]): string {
  if (muscles.length === 0) return 'no muscles linked'
  const has = (role: SideState['role']) => muscles.filter((m) => m.left?.role === role || m.right?.role === role).length
  return [
    has('tight') > 0 ? `${has('tight')} tight` : null,
    has('weak') > 0 ? `${has('weak')} weak` : null,
  ].filter(Boolean).join(' · ')
}

/**
 * The results-page posture map and everything that drives it. The 3D view is never covered:
 * one box under it holds a readout slot, the view controls and the anatomy credit. The viewer's two
 * edge rails do the picking — muscles head to toe on the left, this scan's findings on the right.
 * Picking a finding spotlights its muscles; picking a muscle (rail or model) isolates it and the
 * readout shows a one-line summary with a Details button — the page opens the detail pop-up only
 * from there.
 */
export default function MuscleModel3D({
  findings,
  referenceOnly = false,
  findingOptions = [],
  spotlightKey = null,
  onSpotlight,
  selectedMuscle = null,
  onSelectMuscle,
  onOpenDetails,
}: {
  findings: AssessmentFinding[]
  referenceOnly?: boolean
  findingOptions?: FindingOption[]
  spotlightKey?: string | null
  onSpotlight?: (key: string | null) => void
  /** Viewer id of the isolated muscle, or null. */
  selectedMuscle?: string | null
  onSelectMuscle?: (viewerId: string | null, side: BodySide | null) => void
  onOpenDetails?: (viewerId: string) => void
}) {
  const adapted = useMemo(() => findingsToMuscleStates(referenceOnly ? [] : findings), [findings, referenceOnly])
  const allStates = useMemo(() => viewerStates(adapted.states), [adapted])
  const allMuscles = useMemo(() => {
    const names: Record<string, string> = {}
    for (const f of findings)
      for (const l of [...(f.tight_muscle_links ?? []), ...(f.weak_muscle_links ?? [])])
        if (l?.slug && l.name) names[l.slug] = l.name
    return sidesBySlug(adapted.states, names)
  }, [adapted, findings])

  const spotlight = findingOptions.find((o) => o.key === spotlightKey) ?? null
  const spotlightMuscles = useMemo(() => (spotlight ? musclesForFinding(spotlight.finding) : []), [spotlight])
  const spotlightStates = useMemo(
    () => (spotlight ? viewerStates(findingsToMuscleStates([spotlight.finding]).states) : null),
    [spotlight],
  )
  const highlight = useMemo(() => (spotlight ? spotlightIds(spotlightMuscles) : null), [spotlight, spotlightMuscles])
  // The viewer's right-hand rail: one group per finding (hex tone — CSS vars don't cross the frame).
  const groups = useMemo(
    () =>
      findingOptions.map((o) => ({
        id: o.key,
        label: o.label,
        meta: o.zoneLabel,
        tone: BAND_TONE[o.band],
        muscles: spotlightIds(musclesForFinding(o.finding)),
      })),
    [findingOptions],
  )

  const selectedInfo = useMemo(() => {
    if (!selectedMuscle) return null
    const m =
      spotlightMuscles.find((x) => x.viewerId === selectedMuscle) ??
      allMuscles.find((x) => x.viewerId === selectedMuscle)
    return { name: m?.name ?? prettySlug(selectedMuscle), sides: m ?? null }
  }, [selectedMuscle, spotlightMuscles, allMuscles])

  const [mounted, setMounted] = useState(false)
  const [frameKey, setFrameKey] = useState(0)
  const [status, setStatus] = useState<Status>('idle')
  const [xray, setXray] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const readyRef = useRef(false)
  const viewerSelectionRef = useRef<string | null>(null)
  const latest = useRef({ states: spotlightStates ?? allStates, highlight, selectedMuscle, onSelectMuscle, onSpotlight, xray, groups, spotlightKey })
  useEffect(() => {
    latest.current = { states: spotlightStates ?? allStates, highlight, selectedMuscle, onSelectMuscle, onSpotlight, xray, groups, spotlightKey }
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
      const { states, highlight: ids, selectedMuscle: selected, xray: depth, groups: rail, spotlightKey: active } = latest.current
      postRef.current({ type: 'applyMuscleStates', states })
      postRef.current({ type: 'groups', groups: rail, active })
      postRef.current({ type: 'highlight', muscles: ids })
      postRef.current({ type: 'setXray', value: depth })
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
      } else if (data.type === 'group-select') {
        // A finding picked (or cleared) on the viewer's right-hand rail.
        const id = typeof (data as { id?: unknown }).id === 'string' ? (data as { id: string }).id : null
        latest.current.onSpotlight?.(id)
      } else if (data.type === 'selection') {
        // Only the practitioner's own picks in the viewer drive the page; selections the viewer
        // makes in response to this page's commands must not echo back.
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

  // Keep the viewer in step with the page: states + spotlight, and the isolated muscle.
  useEffect(() => {
    if (!mounted) return
    post({ type: 'applyMuscleStates', states: spotlightStates ?? allStates })
    post({ type: 'highlight', muscles: highlight })
    post({ type: 'groups', groups, active: spotlightKey })
  }, [mounted, allStates, spotlightStates, highlight, groups, spotlightKey])

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
  const changeXray = (value: number) => {
    setXray(value)
    post({ type: 'setXray', value })
  }

  const controlsDisabled = status !== 'ready'

  return (
    <section className={styles.hero} aria-labelledby="anatomy-viewer-title">
      <h2 id="anatomy-viewer-title" className="sr-only">
        {referenceOnly ? 'Explore anatomy in 3D' : 'Posture map'}
      </h2>

      <div className={styles.card}>
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
        </div>

        {/* The box under the model holds everything that drives it, so nothing ever covers it:
            the readout, the view controls, and the anatomy credit along the very bottom. */}
        <div className={styles.dock}>
          {/* Readout: the isolated muscle, else the spotlighted finding, else the color key and
              how to use the two edge rails. A fixed-height slot, so the page never shifts. */}
          <div className={styles.readout}>
            {selectedMuscle && selectedInfo ? (
              <div className={styles.infoBar} role="status" aria-live="polite" aria-label="Selected muscle">
                {selectedInfo.sides && <SideDots muscle={selectedInfo.sides} />}
                <div className={styles.infoText}>
                  <span className={styles.infoName}>{selectedInfo.name}</span>
                  <span className={styles.infoSummary}>{sidesSummary(selectedInfo.sides)}</span>
                </div>
                <button type="button" className={styles.detailsButton} onClick={() => onOpenDetails?.(selectedMuscle)}>
                  Details
                </button>
                <button
                  type="button"
                  className={styles.clear}
                  aria-label="Clear muscle selection"
                  onClick={() => onSelectMuscle?.(null, null)}
                >
                  ✕
                </button>
              </div>
            ) : spotlight ? (
              <div className={styles.infoBar} role="status" aria-live="polite" aria-label="Spotlighted finding">
                <span className={styles.zoneDot} style={{ background: tone(spotlight.band) }} aria-hidden />
                <div className={styles.infoText}>
                  <span className={styles.infoName}>{spotlight.label}</span>
                  <span className={styles.infoSummary}>
                    {spotlight.zoneLabel} · {muscleCounts(spotlightMuscles)}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.clear}
                  aria-label="Show all findings"
                  onClick={() => onSpotlight?.(null)}
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className={styles.idle}>
                {referenceOnly ? (
                  <span className={styles.idleNote}>
                    A general anatomy illustration, not a reconstruction of the captured person.
                  </span>
                ) : (
                  <div className={styles.key} aria-label="3D model legend">
                    <span><i style={{ background: STATE_COLORS.tight }} aria-hidden />Tight</span>
                    <span><i style={{ background: STATE_COLORS.weak }} aria-hidden />Weak</span>
                    {adapted.notShown.length > 0 && (
                      <span className={styles.idleNote}>
                        Not drawn: {adapted.notShown.map((item) => item.name).join(', ')}
                      </span>
                    )}
                  </div>
                )}
                {mounted && (
                  <span className={styles.hint}>
                    {referenceOnly || findingOptions.length === 0
                      ? 'Drag along the left edge to pick a muscle.'
                      : 'Drag the left edge to pick a muscle, the right edge to spotlight a finding.'}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className={styles.controls} role="toolbar" aria-label="3D view controls">
            <div className={styles.segment}>
              <button type="button" disabled={controlsDisabled} onClick={() => post({ type: 'view', direction: 'front' })}>Front</button>
              <button type="button" disabled={controlsDisabled} onClick={() => post({ type: 'view', direction: 'back' })}>Back</button>
              <button type="button" disabled={controlsDisabled} onClick={() => post({ type: 'reset' })}>Reset</button>
            </div>
            <label className={styles.xray}>
              <span>X-ray</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(xray * 100)}
                disabled={controlsDisabled}
                onChange={(e) => changeXray(Number(e.target.value) / 100)}
                aria-label="X-ray depth"
                style={{ ['--fill' as string]: `${Math.round(xray * 100)}%` }}
              />
            </label>
          </div>
          <p className={styles.attribution}>
            BodyParts3D, © The Database Center for Life Science — CC BY-SA 2.1 JP
          </p>
        </div>
      </div>
    </section>
  )
}

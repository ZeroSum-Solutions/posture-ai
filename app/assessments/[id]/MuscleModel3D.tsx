'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnatomyGlyph } from '../../../components/SignalGlyphs'
import { Surface } from '../../../components/array/Surface'
import {
  findingsToMuscleStates,
  slugToViewerId,
  type AssessmentFinding,
  type MuscleStateInput,
} from './findingsToMuscleStates'
import styles from './MuscleModel3D.module.css'

interface ViewerEntry {
  muscle: string
  side: 'left' | 'right'
  color: 'amber'
  intensity: 2
}

/** Static scans do not establish a muscle condition, so historical roles never cross this wire. */
export function toNeutralViewerEntries(states: MuscleStateInput[]): ViewerEntry[] {
  const entries = new Map<string, ViewerEntry>()
  for (const state of states) {
    const muscle = slugToViewerId(state.slug)
    if (!muscle) continue
    const sides: Array<'left' | 'right'> =
      state.side === 'left' ? ['left'] : state.side === 'right' ? ['right'] : ['left', 'right']
    for (const side of sides) {
      const entry = { muscle, side, color: 'amber', intensity: 2 } as const
      entries.set(`${muscle}:${side}`, entry)
    }
  }
  return [...entries.values()]
}

const VIEWER_SRC = '/muscle-viewer/index.html?embed=1&legend=0'
const HELLO_INTERVAL_MS = 300
const HELLO_MAX_TRIES = 40
const MODEL_READY_TIMEOUT_MS = 30_000

export default function MuscleModel3D({ findings, referenceOnly = false }: { findings: AssessmentFinding[]; referenceOnly?: boolean }) {
  const { states, notShown } = useMemo(() => findingsToMuscleStates(referenceOnly ? [] : findings), [findings, referenceOnly])
  const allEntries = useMemo(() => toNeutralViewerEntries(states), [states])
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)
  const regions = useMemo(() => [...new Set(allEntries.map(entry => entry.muscle))], [allEntries])
  const activeRegion = regions.includes(selectedRegion ?? '') ? selectedRegion : null
  const entries = useMemo(() => activeRegion ? allEntries.filter(entry => entry.muscle === activeRegion) : allEntries, [allEntries, activeRegion])
  const referencedRegions = useMemo(
    () => regions.length,
    [regions],
  )
  const [mounted, setMounted] = useState(false)
  const [frameKey, setFrameKey] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const readyRef = useRef(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const modelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const entriesRef = useRef(entries)

  useEffect(() => {
    entriesRef.current = entries
  }, [entries])

  useEffect(() => {
    if (!mounted) return
    const origin = window.location.origin
    const post = (message: unknown) => {
      const frame = iframeRef.current?.contentWindow
      if (!frame) return
      try {
        frame.postMessage(message, origin)
      } catch {
        // The frame may be torn down while navigation completes.
      }
    }
    const applyEntries = () => post({ source: 'posture-ai', type: 'set', entries: entriesRef.current })
    const clearPing = () => {
      if (!intervalRef.current) return
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    const clearModelTimeout = () => {
      if (!modelTimeoutRef.current) return
      clearTimeout(modelTimeoutRef.current)
      modelTimeoutRef.current = null
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as { source?: string; type?: string } | null
      if (!data || data.source !== 'muscle-viewer') return
      if (data.type === 'model-ready') {
        readyRef.current = true
        setStatus('ready')
        clearPing()
        clearModelTimeout()
        applyEntries()
        return
      }
      if (data.type === 'model-unavailable') {
        setStatus('unavailable')
        clearPing()
        clearModelTimeout()
        return
      }
      if (data.type !== 'ready') return
      readyRef.current = true
      clearPing()
      applyEntries()
    }
    window.addEventListener('message', onMessage)

    let tries = 0
    const ping = () => {
      if (readyRef.current) return clearPing()
      post({ source: 'posture-ai', type: 'hello' })
      tries += 1
      if (tries >= HELLO_MAX_TRIES) {
        clearPing()
        if (!readyRef.current) setStatus('unavailable')
      }
    }
    ping()
    intervalRef.current = setInterval(ping, HELLO_INTERVAL_MS)
    modelTimeoutRef.current = setTimeout(() => {
      setStatus('unavailable')
    }, MODEL_READY_TIMEOUT_MS)

    return () => {
      window.removeEventListener('message', onMessage)
      clearPing()
      clearModelTimeout()
      post({ source: 'posture-ai', type: 'clear' })
      readyRef.current = false
    }
  }, [frameKey, mounted])

  useEffect(() => {
    if (!mounted || !readyRef.current) return
    iframeRef.current?.contentWindow?.postMessage(
      { source: 'posture-ai', type: 'set', entries },
      window.location.origin,
    )
  }, [entries, mounted])

  const retryViewer = () => {
    readyRef.current = false
    setStatus('loading')
    setFrameKey((key) => key + 1)
  }

  return (
    <Surface tier="feature">
      <section className={styles.shell} aria-labelledby="anatomy-viewer-title">
        <header className={styles.header}>
          <div className={styles.headingCopy}>
            <span className={styles.eyebrow}>Interactive anatomy</span>
            <h2 id="anatomy-viewer-title" className="t-title">{referenceOnly ? 'Explore anatomy in 3D' : 'Explore assessment-linked regions'}</h2>
            <p className="t-body">{referenceOnly ? 'Rotate the model to explore general anatomy. No assessment findings are mapped onto this view.' : 'Rotate the model to locate anatomy referenced by this saved assessment.'}</p>
          </div>
          {!referenceOnly && <div className={styles.legend} aria-label="3D model legend">
            <span className={styles.swatch} aria-hidden />
            <span>{referencedRegions} linked {referencedRegions === 1 ? 'region' : 'regions'}</span>
          </div>}
        </header>

        {!referenceOnly && regions.length > 0 && <div className={styles.regionButtons} role="group" aria-label="Assessment-linked regions">
          <button type="button" className="a-secondary" aria-pressed={activeRegion === null} onClick={() => setSelectedRegion(null)}>All regions</button>
          {regions.map(region => <button type="button" key={region} className="a-secondary" aria-pressed={activeRegion === region} onClick={() => {
            setSelectedRegion(region)
            if (!mounted) { setStatus('loading'); setMounted(true) }
          }}>{region.replaceAll('_', ' ')}</button>)}
        </div>}
        {activeRegion && <p role="status" className="t-caption">Showing {activeRegion.replaceAll('_', ' ')}. Rotate the model to see the highlighted anatomy.</p>}

        <div className={styles.viewerFrame}>
          {!mounted ? (
            <button
              type="button"
              onClick={() => { setStatus('loading'); setMounted(true) }}
              className={styles.launchButton}
            >
              <span className={styles.glyph} aria-hidden><AnatomyGlyph size={54} /></span>
              <span className={styles.launchTitle}>Open interactive 3D anatomy</span>
              <span className={styles.launchMeta}>Loads once on request · about 9 MB</span>
              <span className={styles.launchAction}>Explore in 3D</span>
            </button>
          ) : (
            <>
              <iframe
                key={frameKey}
                ref={iframeRef}
                src={VIEWER_SRC}
                title="Interactive 3D anatomy model"
                loading="lazy"
                className={styles.iframe}
              />
              {status === 'loading' && (
                <div className={styles.statusOverlay} role="status">Loading interactive anatomy…</div>
              )}
              {status === 'unavailable' && (
                <div className={styles.statusOverlay} role="alert">
                  <p>The 3D view did not load. The recorded scan values remain available above.</p>
                  <button type="button" onClick={retryViewer} className={styles.retryButton}>Try again</button>
                </div>
              )}
            </>
          )}
        </div>

        <div className={styles.instructions} aria-label="3D model instructions">
          <span>Drag to rotate</span>
          <span>Pinch or scroll to zoom</span>
          <span>Use Front and Back to reorient</span>
        </div>

        {notShown.length > 0 && (
          <p className="t-body">
            {notShown.length} referenced {notShown.length === 1 ? 'area is' : 'areas are'} not available in this anatomy model: {notShown.map((item) => item.name).join(', ')}.
          </p>
        )}

        <p className={styles.boundary}>
          {referenceOnly ? 'This is a general anatomy illustration, not a reconstruction of the captured person.' : 'Gold marks anatomy referenced by the assessment record.'} The scan did not test muscle
          tightness, strength, inhibition, or injury.
        </p>
        <p className={styles.attribution}>
          Anatomy: BodyParts3D, © The Database Center for Life Science — CC BY-SA 2.1 JP.
        </p>
      </section>
    </Surface>
  )
}

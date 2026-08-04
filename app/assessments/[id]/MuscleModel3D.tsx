'use client'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { findingsToMuscleStates, type AssessmentFinding, type MuscleStateInput } from './findingsToMuscleStates'
import { evidenceWeight } from '../../../lib/program/evidenceWeight'
import { AnatomyGlyph } from '../../../components/SignalGlyphs'

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

function withIntensity(states: MuscleStateInput[]) {
  return states.map((s) => ({
    ...s,
    intensity: clamp01((s.severity ?? 50) / 100) * evidenceWeight(s.confidence),
  }))
}

// Same-origin viewer build (public/muscle-viewer/**). embed=1 hides its demo chrome + own
// legend/attribution (the host supplies both below); legend=0 hides its built-in legend.
const VIEWER_SRC = '/muscle-viewer/index.html?embed=1&legend=0'
const HELLO_INTERVAL_MS = 300
const HELLO_MAX_TRIES = 40 // ~12s of pinging before we surface "unavailable" (still recovers late)

const CARD: CSSProperties = {
  background: 'var(--surface-glass)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 16,
  padding: 24,
  marginBottom: 24,
}
const HEADING: CSSProperties = {
  fontSize: '1rem',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  margin: 0,
}
const NOTE: CSSProperties = { marginTop: 8, fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.5 }

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />
      <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{label}</span>
    </div>
  )
}

/**
 * Aggregate whole-body 3D "Posture Summary" for the results page. Embeds the same-origin
 * muscle-viewer in an iframe and drives it with this assessment's findings (tight=red,
 * weak=blue, shaded by severity). Click-to-mount so the ~9 MB GLB never downloads without
 * intent. The per-finding 2D maps below remain the always-on primary source.
 */
export default function MuscleModel3D({ findings }: { findings: AssessmentFinding[] }) {
  const { states, notShown, collapsedConflicts } = useMemo(
    () => findingsToMuscleStates(findings),
    [findings],
  )
  const [mounted, setMounted] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const readyRef = useRef(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const statesRef = useRef(states)
  // Keep the latest states reachable from the mount-scoped handshake effect without
  // re-running it (which would tear down + re-add the listener on every states change).
  useEffect(() => {
    statesRef.current = states
  }, [states])

  // Handshake + lifecycle. Runs once the user clicks to mount the iframe (same commit the
  // iframe is inserted, so iframeRef is populated before this effect body runs).
  useEffect(() => {
    if (!mounted) return
    const origin = window.location.origin
    const post = (message: unknown) => {
      const w = iframeRef.current?.contentWindow
      if (!w) return
      try {
        w.postMessage(message, origin)
      } catch {
        /* frame torn down mid-post — harmless */
      }
    }
    const applyStates = () =>
      post({ source: 'posture-ai', type: 'applyMuscleStates', states: withIntensity(statesRef.current) })
    const clearPing = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    // Accept ONLY a same-origin ready from our own iframe.
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== iframeRef.current?.contentWindow) return
      const data = e.data as { source?: string; type?: string } | null
      if (!data || data.source !== 'muscle-viewer' || data.type !== 'ready') return
      readyRef.current = true
      setStatus('ready')
      clearPing()
      applyStates() // re-apply on EVERY ready (StrictMode remount / late reply are safe)
    }
    window.addEventListener('message', onMessage)

    // Request/response: ping until the viewer answers ready, so a mount-order race can't drop
    // the first apply. Keep the message listener attached past the cap for late recovery.
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

    return () => {
      window.removeEventListener('message', onMessage)
      clearPing()
      post({ source: 'posture-ai', type: 'clear' })
      readyRef.current = false
    }
  }, [mounted])

  // Re-apply when the assessment's states change (after the viewer is ready).
  useEffect(() => {
    if (!mounted || !readyRef.current) return
    const w = iframeRef.current?.contentWindow
    if (!w) return
    try {
      w.postMessage(
        { source: 'posture-ai', type: 'applyMuscleStates', states: withIntensity(states) },
        window.location.origin,
      )
    } catch {
      /* frame torn down — harmless */
    }
  }, [states, mounted])

  return (
    <div style={CARD}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <h2 style={HEADING}>3D Posture Summary</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Swatch color="var(--review)" label="Tight" />
          <Swatch color="var(--info)" label="Weak" />
          <span style={{ fontSize: '0.66rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
            shaded by severity
          </span>
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          height: 'clamp(360px, 58vh, 540px)',
          borderRadius: 12,
          overflow: 'hidden',
          border: '1px solid rgba(255,255,255,0.08)',
          background: '#0a0a0f',
        }}
      >
        {!mounted ? (
          <button
            type="button"
            onClick={() => setMounted(true)}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <span style={{ display: 'grid', placeItems: 'center', width: 48, height: 48 }} aria-hidden>
              <AnatomyGlyph size={42} />
            </span>
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Show 3D model
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
              Loads an interactive anatomy model (~9 MB)
            </span>
          </button>
        ) : (
          <>
            <iframe
              ref={iframeRef}
              src={VIEWER_SRC}
              title="Posture Summary 3D model"
              loading="lazy"
              style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            />
            {status === 'unavailable' && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  padding: 24,
                  color: 'var(--text-secondary)',
                  background: 'rgba(10,10,15,0.85)',
                  fontSize: '0.8rem',
                }}
              >
                3D view unavailable — the muscle maps below show the same findings.
              </div>
            )}
          </>
        )}
      </div>

      {collapsedConflicts.length > 0 && (
        <p style={NOTE}>
          {collapsedConflicts.length} muscle{collapsedConflicts.length > 1 ? 's' : ''} show a mixed
          tight/weak signal across findings and {collapsedConflicts.length > 1 ? 'are' : 'is'} shown
          as tight here: {collapsedConflicts.map((c) => c.name).join(', ')}.
        </p>
      )}
      {notShown.length > 0 && (
        <p style={NOTE}>
          {notShown.length} muscle{notShown.length > 1 ? 's' : ''} not shown in 3D:{' '}
          {notShown.map((m) => m.name).join(', ')}.
        </p>
      )}

      <p style={{ marginTop: 14, fontSize: '0.62rem', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
        Anatomy: BodyParts3D, © The Database Center for Life Science — CC BY-SA 2.1 JP. Red =
        tight/overactive, blue = weak/inhibited; depth of color reflects severity.
      </p>
    </div>
  )
}

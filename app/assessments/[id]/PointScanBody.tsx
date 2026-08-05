'use client'
import { useEffect, useRef, useState } from 'react'
import { BAND_TONE, type SeverityBand } from '@/components/array/severity'
import styles from './AssessmentReview.module.css'

/**
 * A schematic body rendered as a point cloud, with the flagged regions glowing in
 * the particles themselves.
 *
 * This is deliberately NOT anatomy. It replaced a stick figure whose joints
 * implied a precision the measurement does not have; a diffuse cloud reads as
 * "region of interest", which is what a 2D monocular screening can actually
 * support. The caption says so, and the markers carry numbers that lead to the
 * rows underneath rather than to body parts.
 *
 * The canvas is decoration: it is `aria-hidden`, the SVG overlay's markers are
 * `aria-hidden`, and the zone rows beneath are the accessible representation.
 * Under `prefers-reduced-motion` the cloud is drawn once and never animated.
 */

export interface ScanMarker {
  /** 1-based, matching the numbered row beneath. */
  number: number
  /** Vertical position down the body, 0 (crown) to 1 (feet). */
  at: number
  band: SeverityBand
  label: string
}

const VIEW = { width: 132, height: 330 } as const
const DPR_CAP = 2
/** Particle count is fixed so the cloud's density never encodes a value. */
const PARTICLE_COUNT = 520
const BREATH_MS = 4000

/** Body outline as a set of horizontal spans, sampled down the figure. */
const SIDE_SPANS: ReadonlyArray<{ at: number; centre: number; halfWidth: number }> = [
  { at: 0.04, centre: 0.60, halfWidth: 0.10 },
  { at: 0.09, centre: 0.58, halfWidth: 0.09 },
  { at: 0.13, centre: 0.55, halfWidth: 0.05 },
  { at: 0.20, centre: 0.55, halfWidth: 0.11 },
  { at: 0.32, centre: 0.54, halfWidth: 0.13 },
  { at: 0.45, centre: 0.53, halfWidth: 0.12 },
  { at: 0.56, centre: 0.52, halfWidth: 0.11 },
  { at: 0.66, centre: 0.51, halfWidth: 0.09 },
  { at: 0.78, centre: 0.51, halfWidth: 0.07 },
  { at: 0.90, centre: 0.52, halfWidth: 0.06 },
  { at: 0.98, centre: 0.54, halfWidth: 0.08 },
]

const FRONT_SPANS: ReadonlyArray<{ at: number; centre: number; halfWidth: number }> = [
  { at: 0.04, centre: 0.50, halfWidth: 0.09 },
  { at: 0.09, centre: 0.50, halfWidth: 0.08 },
  { at: 0.13, centre: 0.50, halfWidth: 0.05 },
  { at: 0.20, centre: 0.50, halfWidth: 0.19 },
  { at: 0.32, centre: 0.50, halfWidth: 0.17 },
  { at: 0.45, centre: 0.50, halfWidth: 0.14 },
  { at: 0.56, centre: 0.50, halfWidth: 0.13 },
  { at: 0.66, centre: 0.50, halfWidth: 0.14 },
  { at: 0.78, centre: 0.50, halfWidth: 0.12 },
  { at: 0.90, centre: 0.50, halfWidth: 0.11 },
  { at: 0.98, centre: 0.50, halfWidth: 0.12 },
]

function spanAt(
  spans: ReadonlyArray<{ at: number; centre: number; halfWidth: number }>,
  at: number,
): { centre: number; halfWidth: number } {
  const upperIndex = spans.findIndex(span => span.at >= at)
  if (upperIndex <= 0) return spans[0]
  const lower = spans[upperIndex - 1]
  const upper = spans[upperIndex]
  const span = upper.at - lower.at
  const ratio = span === 0 ? 0 : (at - lower.at) / span
  return {
    centre: lower.centre + (upper.centre - lower.centre) * ratio,
    halfWidth: lower.halfWidth + (upper.halfWidth - lower.halfWidth) * ratio,
  }
}

interface Particle {
  at: number
  across: number
  /** 0 (far) to 1 (near); drives both size and alpha so the cloud reads as depth. */
  depth: number
  phase: number
}

/**
 * A deterministic generator. `Math.random()` would give a different cloud on the
 * server and the client, and a hydration mismatch on a clinical screen is not
 * worth a slightly more organic scatter.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function buildParticles(view: 'side' | 'front'): Particle[] {
  const random = makeRandom(view === 'side' ? 0x5eed : 0xf00d)
  const spans = view === 'side' ? SIDE_SPANS : FRONT_SPANS
  const particles: Particle[] = []
  while (particles.length < PARTICLE_COUNT) {
    const at = random()
    const { centre, halfWidth } = spanAt(spans, at)
    // Reject outside the outline rather than clamping to it: clamping piles
    // particles on the silhouette's edge and draws a hard border.
    const across = centre + (random() * 2 - 1) * halfWidth
    if (Math.abs(across - centre) > halfWidth) continue
    particles.push({ at, across, depth: random(), phase: random() * Math.PI * 2 })
  }
  return particles
}

export default function PointScanBody({
  view,
  onViewChange,
  markers,
  caption,
}: {
  view: 'side' | 'front'
  onViewChange: (view: 'side' | 'front') => void
  markers: readonly ScanMarker[]
  caption: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [reducedMotion, setReducedMotion] = useState(true)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReducedMotion(query.matches)
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    // Narrowed once here; the draw closure below runs after this guard.
    const paint = context

    const particles = buildParticles(view)
    const scale = Math.min(window.devicePixelRatio || 1, DPR_CAP)
    canvas.width = VIEW.width * scale
    canvas.height = VIEW.height * scale
    context.scale(scale, scale)

    // Marker bands bleed into nearby particles so a flagged region reads in the
    // cloud, not only in its label.
    const glows = markers.map(marker => ({
      at: marker.at,
      colour: BAND_TONE[marker.band],
    }))

    function draw(elapsed: number) {
      paint.clearRect(0, 0, VIEW.width, VIEW.height)
      const breath = reducedMotion
        ? 0
        : Math.sin((elapsed / BREATH_MS) * Math.PI * 2)

      for (const particle of particles) {
        const drift = reducedMotion ? 0 : Math.sin(particle.phase + breath * 1.2) * 0.6
        const x = particle.across * VIEW.width + drift
        const y = particle.at * VIEW.height
        const near = 0.35 + particle.depth * 0.65

        let colour = `rgba(255,255,255,${(0.12 + particle.depth * 0.4).toFixed(3)})`
        for (const glow of glows) {
          const distance = Math.abs(particle.at - glow.at)
          if (distance < 0.055) {
            const strength = (1 - distance / 0.055) * near
            colour = `color-mix(in srgb, ${glow.colour} ${Math.round(strength * 85)}%, rgba(255,255,255,0.2))`
            break
          }
        }

        paint.beginPath()
        paint.arc(x, y, 0.5 + near * 0.9, 0, Math.PI * 2)
        paint.fillStyle = colour
        paint.fill()
      }
    }

    if (reducedMotion) {
      draw(0)
      return
    }

    let frame = 0
    let start: number | null = null
    function tick(now: number) {
      if (start === null) start = now
      draw(now - start)
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [view, markers, reducedMotion])

  return (
    <div className={styles.scanWrap}>
      <div className={styles.scanHead}>
        <h3 className="t-title">Alignment · {view} view</h3>
        <div className={styles.scanToggle} role="group" aria-label="Body view">
          {(['side', 'front'] as const).map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              className={[styles.scanToggleButton, view === option ? styles.scanToggleActive : '']
                .filter(Boolean).join(' ')}
              onClick={() => onViewChange(option)}
            >
              {option === 'side' ? 'Side' : 'Front'}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.scanStage}>
        <canvas
          ref={canvasRef}
          className={styles.scanCanvas}
          style={{ width: VIEW.width, height: VIEW.height }}
          aria-hidden="true"
        />
        <svg
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          className={styles.scanOverlay}
          aria-hidden="true"
          focusable="false"
        >
          {/* Plumb line. The reference the measurements are taken against. */}
          <line
            x1={VIEW.width / 2}
            y1="14"
            x2={VIEW.width / 2}
            y2={VIEW.height - 14}
            stroke="rgba(255,255,255,0.28)"
            strokeWidth="1"
            strokeDasharray="3 5"
          />
          {markers.map(marker => {
            const y = marker.at * VIEW.height
            return (
              <g key={marker.number}>
                <line
                  x1={VIEW.width * 0.55}
                  y1={y}
                  x2={VIEW.width - 20}
                  y2={y}
                  stroke={BAND_TONE[marker.band]}
                  strokeOpacity="0.5"
                  strokeWidth="1"
                />
                <circle cx={VIEW.width - 20} cy={y} r="9" fill={BAND_TONE[marker.band]} />
                <text
                  x={VIEW.width - 20}
                  y={y + 3.5}
                  fill="#000"
                  fontSize="10"
                  fontWeight="700"
                  textAnchor="middle"
                >
                  {marker.number}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      <p className={styles.scanCaption}>{caption}</p>
    </div>
  )
}

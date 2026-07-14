'use client'
import type { Landmark } from '@posture-ai/engine/types'
import { RELIABILITY_FLOOR } from '@posture-ai/engine/thresholds'
import { sourceToViewport } from '@/lib/capture/overlay-transform'
import type { ViewKey } from './types'

interface Dims { w: number; h: number }

interface LiveGuidesProps {
  /** Live-tracked landmarks (source-normalized), or null when not tracking. */
  landmarks: Record<string, Landmark> | null
  /** On-screen element dimensions (from a ResizeObserver). */
  viewDims: Dims | null
  /** Source video intrinsic dimensions, already oriented. */
  videoDims: Dims | null
  /** Sensor roll (deg) for the level line; null hides it. */
  rollDeg: number | null
  view: ViewKey
  /** Center-line color from the gate: green only when the support base is
   *  actually centered ('ok'); neutral when unknown ('na') or off ('blocked'). */
  centeringState: 'ok' | 'blocked' | 'na'
}

// Vertical-ordered joint groups for the informational (non-gating) body midline.
const MIDLINE_CHAIN: string[][] = [
  ['nose', 'left_ear', 'right_ear'],
  ['left_shoulder', 'right_shoulder'],
  ['left_hip', 'right_hip'],
  ['left_knee', 'right_knee'],
  ['left_ankle', 'right_ankle'],
]

function visibleMean(lm: Record<string, Landmark>, names: string[]): { x: number; y: number } | null {
  const pts = names.map(n => lm[n]).filter((p): p is Landmark => !!p && (p.visibility ?? 0) >= RELIABILITY_FLOOR)
  if (pts.length === 0) return null
  return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }
}

/**
 * On-camera guides (design §4.2): a fixed vertical center line, head-room + feet
 * framing lines, a sensor level line, and the tracked body midline. The midline
 * is drawn for INFORMATION ONLY — it never gates the shutter (correctness #6);
 * gating lives in `shutterGate`. All landmark coordinates go through the
 * cover-crop affine so the overlay sits on the subject, not on raw normalized
 * coords stretched across the SVG.
 */
export default function LiveGuides({ landmarks, viewDims, videoDims, rollDeg, view, centeringState }: LiveGuidesProps) {
  const centerColor = centeringState === 'ok' ? 'rgba(16,185,129,0.9)' : 'rgba(255,255,255,0.45)'

  // Tracked body midline, mapped source → viewport (0..100 SVG units).
  let midline: Array<{ x: number; y: number }> = []
  if (landmarks && viewDims && videoDims && videoDims.w > 0 && videoDims.h > 0) {
    const t = sourceToViewport({ srcW: videoDims.w, srcH: videoDims.h, vpW: viewDims.w, vpH: viewDims.h, mirror: false })
    midline = MIDLINE_CHAIN
      .map(group => visibleMean(landmarks, group))
      .filter((pt): pt is { x: number; y: number } => pt !== null)
      .map(pt => { const v = t.toViewport(pt); return { x: v.x * 100, y: v.y * 100 } })
  }

  // True-angle sensor level line through center, corrected for the non-uniform
  // (preserveAspectRatio=none) stretch using the viewport aspect.
  let level: { x1: number; y1: number; x2: number; y2: number } | null = null
  if (rollDeg !== null && viewDims && viewDims.w > 0 && viewDims.h > 0) {
    const a = (-rollDeg * Math.PI) / 180
    const Lpx = viewDims.w * 0.32
    const dx = (Math.cos(a) * Lpx) / viewDims.w * 100
    const dy = (Math.sin(a) * Lpx) / viewDims.h * 100
    level = { x1: 50 - dx, y1: 50 - dy, x2: 50 + dx, y2: 50 + dy }
  }

  return (
    <svg
      data-testid="live-guides"
      data-view={view}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {/* rule-of-thirds grid (kept as a light framing aid) */}
      <line x1="33.3" y1="0" x2="33.3" y2="100" stroke="rgba(255,255,255,0.12)" strokeWidth="0.2" />
      <line x1="66.6" y1="0" x2="66.6" y2="100" stroke="rgba(255,255,255,0.12)" strokeWidth="0.2" />
      {/* head-room + feet framing lines */}
      <line x1="10" y1="12" x2="90" y2="12" stroke="rgba(255,255,255,0.3)" strokeWidth="0.25" strokeDasharray="1.5 1.5" />
      <line x1="10" y1="90" x2="90" y2="90" stroke="rgba(255,255,255,0.3)" strokeWidth="0.25" strokeDasharray="1.5 1.5" />
      {/* fixed vertical center line (green when the support base is centered) */}
      <line x1="50" y1="6" x2="50" y2="94" stroke={centerColor} strokeWidth="0.3" strokeDasharray="2 2" />
      {/* sensor level line */}
      {level && (
        <line data-testid="level-line" x1={level.x1} y1={level.y1} x2={level.x2} y2={level.y2}
          stroke="rgba(0,152,243,0.85)" strokeWidth="0.4" strokeLinecap="round" />
      )}
      {/* informational tracked midline (never gates) */}
      {midline.length >= 2 && (
        <>
          <polyline data-testid="tracking-midline"
            points={midline.map(pt => `${pt.x},${pt.y}`).join(' ')}
            fill="none" stroke="rgba(0,152,243,0.9)" strokeWidth="0.5" strokeLinejoin="round" strokeLinecap="round" />
          {midline.map((pt, i) => (
            <circle key={i} cx={pt.x} cy={pt.y} r="0.7" fill="rgba(0,152,243,0.95)" />
          ))}
        </>
      )}
    </svg>
  )
}

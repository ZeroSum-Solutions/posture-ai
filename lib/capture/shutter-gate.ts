import type { Landmark } from '@posture-ai/engine/types'
import { RELIABILITY_FLOOR } from '@posture-ai/engine/thresholds'
import { supportAnchor } from './support-anchor'

// Frozen shutter-gate constants (design must-fix "freeze the shutter gate"):
//   tol      — support-base centering tolerance, |anchorX − 0.5| ≤ TOL, in the
//              VIEWPORT coordinate space the user actually sees (§11.7).
//   TILT_MAX — degrees of camera roll allowed before the tilt gate blocks.
// Manual override bypasses ALL translation-only gates (an explicit "capture
// anyway" escape hatch) — tracking is flaky, so a misfire must be one tap away.
export const CENTER_TOL = 0.15
export const TILT_MAX_DEG = 5

// Framing landmark groups (mirror lib/pose/quality.ts's framing checks — kept
// local so the gate is a self-contained pure function). Every visible body
// landmark that appears on screen is bounds-checked (incl. head + heels) so a
// cropped-off joint blocks "full body in frame".
const HEAD_LANDMARKS = ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear']
const FOOT_LANDMARKS = ['left_ankle', 'right_ankle', 'left_heel', 'right_heel']
const BOUNDS_LANDMARKS = [
  'nose', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle', 'left_heel', 'right_heel',
]

type FactorState = 'ok' | 'blocked' | 'na'

/** Maps a source-normalized point to viewport-normalized [0..1] — the SAME affine
 *  used to draw the overlay (§11.7), so drawing and gating never disagree. */
export type ToViewport = (p: { x: number; y: number }) => { x: number; y: number }

export interface ShutterGateInput {
  /** Live-tracked landmarks (source-normalized), or null when not tracking. */
  landmarks: Record<string, Landmark> | null
  /** Source→viewport affine; null when viewport/source dims are unknown, which
   *  disables the centering + framing gates (the position on screen is unknown). */
  toViewport: ToViewport | null
  /** Sensor roll at the shutter instant; null = no sensor (upload/desktop). */
  rollDeg: number | null
  /** True once the user hit "capture anyway". */
  overrideActive: boolean
  tol?: number
}

export interface ShutterGateResult {
  allowed: boolean
  /** One-at-a-time coaching, priority tilt > centering > framing; null when clear. */
  coach: string | null
  factors: { tilt: FactorState; centering: FactorState; inFrame: FactorState }
}

function visible(lm: Landmark | undefined): lm is Landmark {
  return !!lm && (lm.visibility ?? 0) >= RELIABILITY_FLOOR
}

function anyVisible(lm: Record<string, Landmark>, names: string[]): boolean {
  return names.some(n => visible(lm[n]))
}

function visibleCount(lm: Record<string, Landmark>): number {
  return Object.values(lm).filter(visible).length
}

/** Full body in frame, evaluated in VIEWPORT space: a head landmark + a foot
 *  landmark visible, and no visible body landmark mapped outside the on-screen
 *  [0,1] region (i.e. cropped off by object-fit: cover). Works for profiles
 *  (any one foot suffices) as well as front/back. */
function fullBodyInFrame(lm: Record<string, Landmark>, toViewport: ToViewport): boolean {
  if (!anyVisible(lm, HEAD_LANDMARKS) || !anyVisible(lm, FOOT_LANDMARKS)) return false
  const anyOut = BOUNDS_LANDMARKS.some(n => {
    const p = lm[n]
    if (!visible(p)) return false
    const v = toViewport(p)
    return v.x < 0 || v.x > 1 || v.y < 0 || v.y > 1
  })
  return !anyOut
}

/**
 * Translation-only shutter gate (§4.2, §11.6). A pure function of camera tilt +
 * support-base centering + full-body-in-frame — and NOTHING about the posture
 * midline's angle or shape, so the gate can never coach posture change
 * (correctness invariant #6). Centering + framing are evaluated in the VIEWPORT
 * space the user sees (through the same cover-crop affine as the overlay, §11.7),
 * and only when live tracking + dims are present; with no tracking (degraded
 * worker) the gate falls back to tilt-only, preserving today's behavior.
 * `anchorX===null` (feet not both visible, e.g. a profile) disables only the
 * centering piece.
 */
export function shutterGate({ landmarks, toViewport, rollDeg, overrideActive, tol = CENTER_TOL }: ShutterGateInput): ShutterGateResult {
  const tilt: FactorState = rollDeg === null ? 'na' : Math.abs(rollDeg) <= TILT_MAX_DEG ? 'ok' : 'blocked'

  let centering: FactorState = 'na'
  let inFrame: FactorState = 'na'

  const tracking = landmarks !== null && toViewport !== null && visibleCount(landmarks) >= 4
  if (tracking && landmarks && toViewport) {
    const anchorSrc = supportAnchor(landmarks)
    if (anchorSrc) {
      const anchorVp = toViewport(anchorSrc)
      centering = Math.abs(anchorVp.x - 0.5) <= tol ? 'ok' : 'blocked'
    }
    inFrame = fullBodyInFrame(landmarks, toViewport) ? 'ok' : 'blocked'
  }

  if (overrideActive) {
    return { allowed: true, coach: null, factors: { tilt, centering, inFrame } }
  }

  const allowed = tilt !== 'blocked' && centering !== 'blocked' && inFrame !== 'blocked'

  let coach: string | null = null
  if (tilt === 'blocked') coach = 'Straighten the phone'
  else if (centering === 'blocked') coach = 'Line up with the center line'
  else if (inFrame === 'blocked') coach = 'Fit your whole body in the frame'

  return { allowed, coach, factors: { tilt, centering, inFrame } }
}

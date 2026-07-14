import type { Landmark } from '@posture-ai/engine/types'
import { RELIABILITY_FLOOR } from '@posture-ai/engine/thresholds'
import { supportAnchorX } from './support-anchor'

// Frozen shutter-gate constants (design must-fix "freeze the shutter gate"):
//   tol      — support-base centering tolerance, |anchorX − 0.5| ≤ TOL.
//   TILT_MAX — degrees of camera roll allowed before the tilt gate blocks.
// Manual override bypasses ALL translation-only gates (an explicit "capture
// anyway" escape hatch) — tracking is flaky, so a misfire must be one tap away.
export const CENTER_TOL = 0.15
export const TILT_MAX_DEG = 5

// Framing landmark groups (mirror lib/pose/quality.ts's framing checks — kept
// local so the gate is a self-contained pure function).
const HEAD_LANDMARKS = ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear']
const FOOT_LANDMARKS = ['left_ankle', 'right_ankle', 'left_heel', 'right_heel']
const BOUNDS_LANDMARKS = [
  'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
]

type FactorState = 'ok' | 'blocked' | 'na'

export interface ShutterGateInput {
  /** Live-tracked landmarks, or null when the worker isn't tracking (degraded). */
  landmarks: Record<string, Landmark> | null
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

/** Full body in frame: a head landmark + a foot landmark visible, and no visible
 *  bounds joint pushed outside [0,1] on either axis. Works for profiles (any one
 *  foot suffices) as well as front/back. */
function fullBodyInFrame(lm: Record<string, Landmark>): boolean {
  if (!anyVisible(lm, HEAD_LANDMARKS) || !anyVisible(lm, FOOT_LANDMARKS)) return false
  const anyOut = BOUNDS_LANDMARKS.some(n => {
    const p = lm[n]
    return visible(p) && (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)
  })
  return !anyOut
}

/**
 * Translation-only shutter gate (§4.2, §11.6). A pure function of camera tilt +
 * support-base centering + full-body-in-frame — and NOTHING about the posture
 * midline's angle or shape, so the gate can never coach posture change
 * (correctness invariant #6). Centering + framing are evaluated only when live
 * tracking is present; with no tracking (degraded worker) the gate falls back to
 * tilt-only, preserving today's behavior. `anchorX===null` (feet not both
 * visible, e.g. a profile) disables only the centering piece.
 */
export function shutterGate({ landmarks, rollDeg, overrideActive, tol = CENTER_TOL }: ShutterGateInput): ShutterGateResult {
  const tilt: FactorState = rollDeg === null ? 'na' : Math.abs(rollDeg) <= TILT_MAX_DEG ? 'ok' : 'blocked'

  let centering: FactorState = 'na'
  let inFrame: FactorState = 'na'
  let anchorX: number | null = null

  const tracking = landmarks !== null && visibleCount(landmarks) >= 4
  if (tracking && landmarks) {
    anchorX = supportAnchorX(landmarks)
    centering = anchorX === null ? 'na' : Math.abs(anchorX - 0.5) <= tol ? 'ok' : 'blocked'
    inFrame = fullBodyInFrame(landmarks) ? 'ok' : 'blocked'
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

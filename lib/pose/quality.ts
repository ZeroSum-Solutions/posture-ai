import type { PoseFrame } from '@posture-ai/engine/types'
import { RELIABILITY_FLOOR } from '@posture-ai/engine/thresholds'

export interface FrameQuality {
  status: 'ok' | 'no_person' | 'warnings'
  warnings: string[]
}

type ViewKey = 'front' | 'side' | 'back'

// Returns the max visibility of a set of landmark names in a frame.
function maxVis(frame: PoseFrame, names: string[]): number {
  let best = 0
  for (const name of names) {
    const lm = frame.landmarks[name]
    const v = lm?.visibility ?? 0
    if (v > best) best = v
  }
  return best
}

// Returns true if any landmark from the given list meets the reliability floor.
function groupOk(frame: PoseFrame, names: string[]): boolean {
  return maxVis(frame, names) >= RELIABILITY_FLOOR
}

// ---- Geometric framing checks (spec §4.2) ----
// Span thresholds are calibrated on the measurable eye/ear-to-ankle span
// (MediaPipe has no head-top landmark): 0.65 ≈ the spec's 70% head-to-ankle
// minimum; 0.95 still leaves visible margin, and truly cut-off bodies are
// caught by the out-of-frame check below.
const HEAD_LANDMARKS = ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear']
const ANKLE_LANDMARKS = ['left_ankle', 'right_ankle']
const BOUNDS_LANDMARKS = [
  'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
]
const FRAME_SPAN_MIN = 0.65
const FRAME_SPAN_MAX = 0.95
const CENTER_TOLERANCE = 0.15

function visiblePoints(frame: PoseFrame, names: string[]) {
  return names
    .map(n => frame.landmarks[n])
    .filter((p): p is NonNullable<typeof p> => !!p && (p.visibility ?? 0) >= RELIABILITY_FLOOR)
}

function framingWarnings(frame: PoseFrame): string[] {
  const warnings: string[] = []

  const headYs = visiblePoints(frame, HEAD_LANDMARKS).map(p => p.y)
  const ankleYs = visiblePoints(frame, ANKLE_LANDMARKS).map(p => p.y)
  if (headYs.length > 0 && ankleYs.length > 0) {
    const span = Math.max(...ankleYs) - Math.min(...headYs)
    if (span < FRAME_SPAN_MIN) {
      warnings.push('Subject is small in the frame — move the camera closer so the body fills most of the height.')
    } else if (span > FRAME_SPAN_MAX) {
      warnings.push('Subject nearly fills the frame — step back to leave space above the head and below the feet.')
    }
  }

  // Profile shots have only the near hip confidently visible, and its x says
  // little about centering — only fire when both hips are visible (front/back).
  const hips = visiblePoints(frame, ['left_hip', 'right_hip'])
  if (hips.length === 2) {
    const hipMidX = (hips[0].x + hips[1].x) / 2
    if (Math.abs(hipMidX - 0.5) > CENTER_TOLERANCE) {
      warnings.push('Subject is off-center — line up with the middle of the frame.')
    }
  }

  // Schema allows −0.5…1.5, so confidently-detected joints outside [0,1]
  // mean part of the body is outside the photo.
  const outOfFrame = visiblePoints(frame, BOUNDS_LANDMARKS)
    .some(p => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)
  if (outOfFrame) {
    warnings.push('Part of the body is outside the frame — adjust the camera so all joints are visible.')
  }

  return warnings
}

/**
 * Per-photo preflight quality check.
 *
 * Returns:
 *   'no_person'  — no scoreable landmarks detected at all
 *   'ok'         — all key landmark groups for this view are visible
 *   'warnings'   — some groups are low-vis; submit is allowed but with guidance
 *
 * Side view: only the BETTER side per group is evaluated. The far leg is
 * expected to be occluded in profile shots — do NOT warn about it.
 */
export function assessFrameQuality(frame: PoseFrame, view: ViewKey): FrameQuality {
  const lm = frame.landmarks

  // No person: fewer than 4 landmarks populated
  if (Object.keys(lm).length < 4) {
    return { status: 'no_person', warnings: [] }
  }

  const warnings: string[] = []

  if (view === 'side') {
    // For side view, evaluate each bilateral group by its BETTER side only.
    // The far side will always be occluded in a profile shot.

    const earOk = groupOk(frame, ['left_ear', 'right_ear'])
    const shoulderOk = groupOk(frame, ['left_shoulder', 'right_shoulder'])
    const hipOk = groupOk(frame, ['left_hip', 'right_hip'])
    const kneeOk = groupOk(frame, ['left_knee', 'right_knee'])
    const ankleOk = groupOk(frame, ['left_ankle', 'right_ankle'])

    if (!earOk) {
      warnings.push('Head not clearly visible — face sideways and ensure your ear is in frame.')
    }
    if (!shoulderOk) {
      warnings.push('Shoulder not clearly visible — stand fully to the side of the camera.')
    }
    if (!hipOk) {
      warnings.push('Hip not clearly visible — step back so your full torso is in frame.')
    }
    if (!kneeOk || !ankleOk) {
      warnings.push('Legs not fully visible — step back so feet are in frame.')
    }
  } else {
    // Front and back views: both sides need to be visible
    const leftShoulderVis = lm['left_shoulder']?.visibility ?? 0
    const rightShoulderVis = lm['right_shoulder']?.visibility ?? 0
    if (leftShoulderVis < RELIABILITY_FLOOR && rightShoulderVis < RELIABILITY_FLOOR) {
      warnings.push('Shoulders not clearly visible — step back or turn to face the camera directly.')
    }

    const leftHipVis = lm['left_hip']?.visibility ?? 0
    const rightHipVis = lm['right_hip']?.visibility ?? 0
    if (leftHipVis < RELIABILITY_FLOOR && rightHipVis < RELIABILITY_FLOOR) {
      warnings.push('Hips not clearly visible — step back so your full torso is in frame.')
    }

    const leftKneeVis = lm['left_knee']?.visibility ?? 0
    const rightKneeVis = lm['right_knee']?.visibility ?? 0
    const leftAnkleVis = lm['left_ankle']?.visibility ?? 0
    const rightAnkleVis = lm['right_ankle']?.visibility ?? 0
    if (
      (leftKneeVis < RELIABILITY_FLOOR && rightKneeVis < RELIABILITY_FLOOR) ||
      (leftAnkleVis < RELIABILITY_FLOOR && rightAnkleVis < RELIABILITY_FLOOR)
    ) {
      warnings.push('Legs not fully visible — step back so feet are in frame.')
    }
  }

  // Geometric framing (all views) — soft warnings, never blocking.
  warnings.push(...framingWarnings(frame))

  if (warnings.length > 0) {
    return { status: 'warnings', warnings }
  }
  return { status: 'ok', warnings: [] }
}

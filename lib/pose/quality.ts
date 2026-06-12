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

  if (warnings.length > 0) {
    return { status: 'warnings', warnings }
  }
  return { status: 'ok', warnings: [] }
}

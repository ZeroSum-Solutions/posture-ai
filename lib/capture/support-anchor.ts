import type { Landmark } from '@posture-ai/engine/types'
import { RELIABILITY_FLOOR } from '@posture-ai/engine/thresholds'

export interface Anchor {
  x: number
  y: number
}

function visible(lm: Landmark | undefined): lm is Landmark {
  return !!lm && (lm.visibility ?? 0) >= RELIABILITY_FLOOR
}

function midpoint(a: Landmark, b: Landmark): Anchor {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Posture-invariant support-base anchor (§11.6): the subject's floor position,
 * invariant under lean, shoulder tilt, head carriage, and single-knee bend.
 * Deterministic availability:
 *   1. both ankles visible → ankle midpoint
 *   2. else both heels visible → heel midpoint
 *   3. else null (the caller disables only the centering pieces)
 * 2D so the Slice-4 no-crop transform (§11.5) can center on `A.y`; gating uses
 * `.x` (see `supportAnchorX`). Pure — never mutates the input.
 */
export function supportAnchor(landmarks: Record<string, Landmark>): Anchor | null {
  const la = landmarks['left_ankle']
  const ra = landmarks['right_ankle']
  if (visible(la) && visible(ra)) return midpoint(la, ra)

  const lh = landmarks['left_heel']
  const rh = landmarks['right_heel']
  if (visible(lh) && visible(rh)) return midpoint(lh, rh)

  return null
}

/**
 * Horizontal support-base position for live shutter-gating and the quality
 * centering subscore. `null` when no support base is visible → the caller gates
 * on tilt + framing only and scores centering 0 + warning.
 */
export function supportAnchorX(landmarks: Record<string, Landmark>): number | null {
  return supportAnchor(landmarks)?.x ?? null
}

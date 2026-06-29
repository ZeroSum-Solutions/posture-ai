import type { PoseFrame } from '@posture-ai/engine'

// Data minimization (BIPA): BlazePose emits 11 face-region keypoints (indices
// 0–10), but scoring only uses nose(0), left_ear(7), right_ear(8). The eye and
// mouth points (1–6, 9–10) are never used — so we strip them before anything is
// persisted. Pose detection still runs on the full frame in-memory; only what is
// SAVED is minimized. Nose/ears are retained so stored frames stay re-scorable.
export const FACE_MINIMIZE_LANDMARKS = [
  'left_eye_inner', 'left_eye', 'left_eye_outer',
  'right_eye_inner', 'right_eye', 'right_eye_outer',
  'mouth_left', 'mouth_right',
] as const

const STRIP = new Set<string>(FACE_MINIMIZE_LANDMARKS)

/** Return a copy of `frame` with the unused eye/mouth keypoints removed. */
export function stripFaceLandmarks(frame: PoseFrame): PoseFrame {
  const landmarks: PoseFrame['landmarks'] = {}
  for (const [name, lm] of Object.entries(frame.landmarks)) {
    if (!STRIP.has(name)) landmarks[name] = lm
  }
  return { ...frame, landmarks }
}

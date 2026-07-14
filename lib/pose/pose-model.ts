// Shared pose-model constants + landmark mapping for both the IMAGE scoring
// landmarker (detect.ts) and the live VIDEO worker (live-worker.ts). No
// 'use client' — this is imported by a Web Worker too.

import type { Landmark } from '@posture-ai/engine/types'

// BlazePose 33-landmark order. Index -> engine landmark name.
export const POSE_LANDMARK_NAMES = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer',
  'right_eye_inner', 'right_eye', 'right_eye_outer',
  'left_ear', 'right_ear', 'mouth_left', 'mouth_right',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_pinky', 'right_pinky',
  'left_index', 'right_index', 'left_thumb', 'right_thumb',
  'left_hip', 'right_hip', 'left_knee', 'right_knee',
  'left_ankle', 'right_ankle', 'left_heel', 'right_heel',
  'left_foot_index', 'right_foot_index',
] as const

// Self-hosted assets (copied from the pinned @mediapipe/tasks-vision package at build time).
export const WASM_URL = '/mediapipe/wasm'
export const LITE_MODEL_URL = '/mediapipe/models/pose_landmarker_lite.task'
export const FULL_MODEL_URL = '/mediapipe/models/pose_landmarker_full.task'

// Scoring (IMAGE) model selection: NEXT_PUBLIC_POSE_MODEL=lite (default) | full.
export const SCORING_MODEL_VARIANT = process.env.NEXT_PUBLIC_POSE_MODEL === 'full' ? 'full' : 'lite'
export const SCORING_MODEL_URL = SCORING_MODEL_VARIANT === 'full' ? FULL_MODEL_URL : LITE_MODEL_URL

// No-face-geometry guarantee (BIPA): only ever load an allow-listed pose model;
// FAIL CLOSED otherwise. The bundled MediaPipe WASM is generic and could
// technically run a face task, so we assert the loaded asset is pose-only.
const ALLOWED_POSE_MODELS = new Set([LITE_MODEL_URL, FULL_MODEL_URL])
export function assertPoseOnlyModel(url: string): void {
  if (/face/i.test(url) || !ALLOWED_POSE_MODELS.has(url)) {
    throw new Error(`[pose] refusing non-pose model asset "${url}" — face geometry is never computed`)
  }
}

/** Map a MediaPipe landmark array to the engine's named-landmark record. */
export function mapLandmarks(
  pts: ReadonlyArray<{ x: number; y: number; z?: number; visibility?: number }> | undefined,
): Record<string, Landmark> {
  const landmarks: Record<string, Landmark> = {}
  if (pts) {
    pts.forEach((p, i) => {
      const name = POSE_LANDMARK_NAMES[i]
      if (name) {
        landmarks[name] = {
          x: p.x,
          y: p.y,
          z: p.z,
          visibility: typeof p.visibility === 'number' ? p.visibility : 1,
        }
      }
    })
  }
  return landmarks
}

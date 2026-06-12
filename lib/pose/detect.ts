'use client'
// Client-side MediaPipe pose detection.
// Runs PoseLandmarker (BlazePose) on a captured image and returns a PoseFrame
// in the exact shape the deterministic scoring engine expects
// (snake_case landmark names, normalized 0-1 coords + visibility, relative z).

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { PoseFrame, ViewLabel } from '@posture-ai/engine/types'

// BlazePose 33-landmark order. Index -> engine landmark name.
const POSE_LANDMARK_NAMES = [
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
const WASM_URL = '/mediapipe/wasm'

// Model selection: NEXT_PUBLIC_POSE_MODEL=lite (default) | full
const modelVariant = process.env.NEXT_PUBLIC_POSE_MODEL === 'full' ? 'full' : 'lite'
const MODEL_URL = modelVariant === 'full'
  ? '/mediapipe/models/pose_landmarker_full.task'
  : '/mediapipe/models/pose_landmarker_lite.task'

let landmarkerPromise: Promise<PoseLandmarker> | null = null

async function getLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL)
      try {
        return await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'IMAGE',
          numPoses: 1,
        })
      } catch {
        // Fall back to CPU when the WebGL/GPU delegate is unavailable.
        return PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
          runningMode: 'IMAGE',
          numPoses: 1,
        })
      }
    })().catch((err) => {
      landmarkerPromise = null // allow retry on next attempt
      throw err
    })
  }
  return landmarkerPromise
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load captured image'))
    img.src = src
  })
}

/**
 * Warm up the landmarker by starting the model load without running detection.
 * Call this when the capture step mounts to hide the ~5 s Chromium cold-start.
 */
export function warmUpLandmarker(): void {
  getLandmarker().catch(() => {
    // Warm-up is best-effort; errors surface when detectPose is actually called.
  })
}

/**
 * Detect pose landmarks in a captured image (object URL or data URL) and map
 * them to the engine's PoseFrame. If no person is detected, the frame's
 * landmarks are empty and the engine degrades the affected metrics to
 * "unreliable" rather than emitting bad numbers. The returned frame also
 * carries the image's aspect ratio and an optional source tag for downstream use.
 */
export async function detectPose(
  src: string,
  view: ViewLabel,
  source?: 'camera' | 'upload'
): Promise<PoseFrame> {
  const landmarker = await getLandmarker()
  const img = await loadImage(src)
  const result = landmarker.detect(img)
  const pts = result.landmarks?.[0]
  const landmarks: PoseFrame['landmarks'] = {}
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
  const frame: PoseFrame = { view, landmarks }
  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
    frame.aspectRatio = img.naturalWidth / img.naturalHeight
  }
  if (source) frame.source = source
  return frame
}

'use client'
// Client-side MediaPipe pose detection.
// Runs PoseLandmarker (BlazePose) on a captured image and returns a PoseFrame
// in the exact shape the deterministic scoring engine expects
// (snake_case landmark names, normalized 0-1 coords + visibility, relative z).

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import type { PoseFrame, ViewLabel } from '@posture-ai/engine/types'
import {
  WASM_URL,
  SCORING_MODEL_URL as MODEL_URL,
  SCORING_MODEL_VARIANT as modelVariant,
  assertPoseOnlyModel,
  mapLandmarks,
} from './pose-model'

let landmarkerPromise: Promise<PoseLandmarker> | null = null

async function getLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      assertPoseOnlyModel(MODEL_URL)
      const vision = await FilesetResolver.forVisionTasks(WASM_URL)
      let lm: PoseLandmarker
      try {
        lm = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'IMAGE',
          numPoses: 1,
        })
      } catch {
        // Fall back to CPU when the WebGL/GPU delegate is unavailable.
        lm = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
          runningMode: 'IMAGE',
          numPoses: 1,
        })
      }
      // Auditable affirmation: pose-only model loaded, no face geometry path.
      console.info(`[pose] pose-only model loaded — no face geometry computed (variant: ${modelVariant})`)
      return lm
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
 * Call this before scoring to hide the ~5 s Chromium cold-start. Returns a
 * promise so the capture-runtime owner can await residency before transitioning.
 */
export function warmUpLandmarker(): Promise<void> {
  return getLandmarker().then(() => undefined).catch(() => {
    // Warm-up is best-effort; errors surface when detectPose is actually called.
  })
}

/**
 * Close the resident IMAGE landmarker and drop the singleton so the next
 * warm/detect constructs a fresh one. The capture-runtime state machine calls
 * this so the scoring (IMAGE) backend never stays resident while the live
 * (worker VIDEO) backend runs — at most one landmarker is alive at a time
 * (design §11.1). No-op when nothing is resident.
 */
export async function closeLandmarker(): Promise<void> {
  const pending = landmarkerPromise
  if (!pending) return
  // Null the singleton first so this reads as "closed" for the whole teardown
  // window; the runtime serializes transitions, so no detect races in here.
  landmarkerPromise = null
  try {
    const lm = await pending
    lm.close()
  } catch {
    // Never warmed successfully / already torn down — nothing to close.
  }
}

/**
 * Detect pose landmarks in a captured image (object URL or data URL) and map
 * them to the engine's PoseFrame. If no person is detected, the frame's
 * landmarks are empty and the engine degrades the affected metrics to
 * "unreliable" rather than emitting bad numbers. The returned frame also
 * carries the image's aspect ratio and an optional source tag for downstream use.
 */
// Detection is deterministic for a given (image bytes, model), but the
// representative capture frame is requested up to 3× per view (preview badge,
// preflight, submit burst). Memoize by (view|source|src) so the landmarker runs
// once per distinct frame. Bounded so large data-URL keys don't accumulate.
const detectCache = new Map<string, Promise<PoseFrame>>()
const DETECT_CACHE_MAX = 8

export function detectPose(
  src: string,
  view: ViewLabel,
  source?: 'camera' | 'upload'
): Promise<PoseFrame> {
  const key = `${view}|${source ?? ''}|${src}`
  const cached = detectCache.get(key)
  if (cached) return cached
  const promise = detectPoseUncached(src, view, source)
  detectCache.set(key, promise)
  if (detectCache.size > DETECT_CACHE_MAX) {
    const oldest = detectCache.keys().next().value
    if (oldest !== undefined) detectCache.delete(oldest)
  }
  // Don't cache a failure — evict so a later attempt can retry.
  promise.catch(() => detectCache.delete(key))
  return promise
}

async function detectPoseUncached(
  src: string,
  view: ViewLabel,
  source?: 'camera' | 'upload'
): Promise<PoseFrame> {
  const landmarker = await getLandmarker()
  const img = await loadImage(src)
  const result = landmarker.detect(img)
  const landmarks = mapLandmarks(result.landmarks?.[0])
  const frame: PoseFrame = { view, landmarks }
  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
    frame.aspectRatio = img.naturalWidth / img.naturalHeight
  }
  if (source) frame.source = source
  return frame
}

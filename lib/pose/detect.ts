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
import {
  readinessMessage,
  type PoseBackendStartResult,
  type PoseDelegate,
  type PoseFailureCode,
  type PoseReadiness,
  type PoseReadinessListener,
} from './pose-readiness'

/** Client-only detector metadata used by capture preflight, never sent to the API. */
export interface DetectedPoseFrame extends PoseFrame {
  detectedPoseCount: number
}

export const IMAGE_INIT_TIMEOUT_MS = 15_000
export const IMAGE_DETECT_TIMEOUT_MS = 10_000

interface ResidentLandmarker {
  landmarker: PoseLandmarker
  delegate: PoseDelegate
}

class PoseOperationError extends Error {
  constructor(
    message: string,
    readonly code: PoseFailureCode,
  ) {
    super(message)
    this.name = 'PoseOperationError'
  }
}

let landmarkerPromise: Promise<ResidentLandmarker> | null = null
// A GPU instance that throws during inference is treated as context-lost. Keep
// subsequent clean constructions on CPU for the rest of this capture-runtime
// lifecycle; `resetLandmarkerDelegatePreference` is the explicit fresh-start
// boundary (called by CaptureRuntime.dispose).
let preferCpuForRecovery = false
let readiness = readinessMessage('downloading', 'image', null, 'Preparing the pose model.')
const readinessListeners = new Set<PoseReadinessListener>()

export function imageReadiness(): PoseReadiness {
  return readiness
}

export function subscribeImageReadiness(listener: PoseReadinessListener): () => void {
  readinessListeners.add(listener)
  listener(readiness)
  return () => readinessListeners.delete(listener)
}

function publishReadiness(next: PoseReadiness) {
  readiness = next
  readinessListeners.forEach(listener => listener(next))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function timeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
  code: PoseFailureCode = 'timeout',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PoseOperationError(message, code)), timeoutMs)
    operation.then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
}

async function createWithDeadline(
  vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
  delegate: 'GPU' | 'CPU',
): Promise<PoseLandmarker> {
  const creation = PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'IMAGE',
    numPoses: 2,
  })
  try {
    return await timeout(
      creation,
      IMAGE_INIT_TIMEOUT_MS,
      `${delegate} pose-model initialization timed out.`,
    )
  } catch (error) {
    // MediaPipe's constructor has no AbortSignal. If a timed-out constructor
    // eventually resolves, close that abandoned instance immediately; it is
    // never promoted to the resident singleton.
    if (error instanceof PoseOperationError && error.code === 'timeout') {
      void creation.then(late => late.close(), () => {})
    }
    throw error
  }
}

async function getLandmarker(): Promise<ResidentLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      assertPoseOnlyModel(MODEL_URL)
      publishReadiness(readinessMessage('downloading', 'image', null, 'Downloading pose runtime.'))
      const vision = await timeout(
        FilesetResolver.forVisionTasks(WASM_URL),
        IMAGE_INIT_TIMEOUT_MS,
        'Pose runtime download timed out.',
      )
      if (preferCpuForRecovery) {
        publishReadiness(readinessMessage('initializing', 'image', 'cpu', 'Recovering pose detection on CPU.'))
        try {
          const landmarker = await createWithDeadline(vision, 'CPU')
          publishReadiness(readinessMessage('ready', 'image', 'cpu'))
          console.info(`[pose] pose-only model loaded — no face geometry computed (variant: ${modelVariant}, delegate: cpu-recovery)`)
          return { landmarker, delegate: 'cpu' as const }
        } catch (cpuError) {
          throw new PoseOperationError(
            `CPU pose-model recovery failed after a GPU runtime error: ${errorMessage(cpuError)}`,
            'cpu_recovery_failed',
          )
        }
      }
      publishReadiness(readinessMessage('initializing', 'image', 'gpu', 'Initializing GPU pose model.'))
      try {
        const landmarker = await createWithDeadline(vision, 'GPU')
        publishReadiness(readinessMessage('ready', 'image', 'gpu'))
        console.info(`[pose] pose-only model loaded — no face geometry computed (variant: ${modelVariant}, delegate: gpu)`)
        return { landmarker, delegate: 'gpu' as const }
      } catch (gpuError) {
        publishReadiness(readinessMessage('initializing', 'image', 'cpu', 'GPU unavailable. Initializing CPU pose model.'))
        try {
          const landmarker = await createWithDeadline(vision, 'CPU')
          publishReadiness(readinessMessage('ready', 'image', 'cpu'))
          console.info(`[pose] pose-only model loaded — no face geometry computed (variant: ${modelVariant}, delegate: cpu)`)
          return { landmarker, delegate: 'cpu' as const }
        } catch (cpuError) {
          const message = `Pose model could not start on GPU or CPU. GPU: ${errorMessage(gpuError)} CPU: ${errorMessage(cpuError)}`
          throw new PoseOperationError(message, 'gpu_and_cpu_failed')
        }
      }
    })().catch((err) => {
      landmarkerPromise = null // allow retry on next attempt
      const code = err instanceof PoseOperationError ? err.code : 'gpu_and_cpu_failed'
      publishReadiness(readinessMessage('failed', 'image', null, errorMessage(err)))
      if (code === 'timeout') {
        throw new PoseOperationError(errorMessage(err), 'timeout')
      }
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
export async function warmUpLandmarker(): Promise<PoseBackendStartResult> {
  try {
    const { delegate } = await getLandmarker()
    return { ok: true, delegate }
  } catch (error) {
    return {
      ok: false,
      code: error instanceof PoseOperationError ? error.code : 'gpu_and_cpu_failed',
      message: errorMessage(error),
    }
  }
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
    const { landmarker } = await pending
    landmarker.close()
  } catch {
    // Never warmed successfully / already torn down — nothing to close.
  }
}

/** Explicit fresh-lifecycle boundary. Routine IMAGE↔LIVE transitions must not
 * clear CPU recovery, or a context-lost GPU would be retried on every view. */
export function resetLandmarkerDelegatePreference(): void {
  preferCpuForRecovery = false
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
const detectCache = new Map<string, Promise<DetectedPoseFrame>>()
const DETECT_CACHE_MAX = 8

export function detectPose(
  src: string,
  view: ViewLabel,
  source?: 'camera' | 'upload'
): Promise<DetectedPoseFrame> {
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
): Promise<DetectedPoseFrame> {
  const { landmarker, delegate } = await getLandmarker()
  let detectInvoked = false
  try {
    const { img, result } = await timeout(
      loadImage(src).then(async img => {
        detectInvoked = true
        const startedAt = performance.now()
        const result = await Promise.resolve(landmarker.detect(img))
        const elapsedMs = performance.now() - startedAt
        // MediaPipe IMAGE detection is synchronous and has no cancellation API:
        // a timer cannot preempt it while the main thread is blocked. The outer
        // deadline covers asynchronous stalls; this elapsed check fails closed
        // immediately after an over-budget synchronous call returns.
        if (elapsedMs > IMAGE_DETECT_TIMEOUT_MS) {
          throw new PoseOperationError('Pose detection timed out.', 'detect_timeout')
        }
        return { img, result }
      }),
      IMAGE_DETECT_TIMEOUT_MS,
      'Pose detection timed out.',
      'detect_timeout',
    )
    const landmarks = mapLandmarks(result.landmarks?.[0])
    const frame: DetectedPoseFrame = {
      view,
      landmarks,
      detectedPoseCount: result.landmarks?.length ?? 0,
    }
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      frame.aspectRatio = img.naturalWidth / img.naturalHeight
    }
    if (source) frame.source = source
    publishReadiness(readinessMessage('ready', 'image', delegate))
    return frame
  } catch (error) {
    if (delegate === 'gpu' && detectInvoked) preferCpuForRecovery = true
    const code = error instanceof PoseOperationError ? error.code : 'detect_failed'
    const failure = error instanceof PoseOperationError
      ? error
      : new PoseOperationError(`Pose detection failed: ${errorMessage(error)}`, code)
    publishReadiness(readinessMessage('failed', 'image', delegate, failure.message))
    // A detector that timed out or threw is not trusted for another frame. Drop
    // it so retry constructs a clean backend without a page reload.
    await closeLandmarker()
    throw failure
  }
}

import type { ViewLabel } from '@posture-ai/engine/types'
import type { DetectedPoseFrame, PoseInputProvenance } from './detect'
import { recordLiveTelemetry } from './live-telemetry'
import {
  readinessMessage,
  type PoseBackendStartResult,
  type PoseReadiness,
  type PoseReadinessListener,
} from './pose-readiness'

export type {
  PoseBackendKind,
  PoseDelegate,
  PoseReadiness,
  PoseReadinessListener,
  PoseReadinessPhase,
} from './pose-readiness'

/**
 * The live VIDEO backend (a Web Worker owning one lite `PoseLandmarker` in
 * `runningMode:'VIDEO'`). `start`/`close` construct/tear down the worker's
 * landmarker; `detect` runs one frame (best-effort — the worker drops stale /
 * in-flight frames and owns the `ImageBitmap`'s `close()`).
 */
export interface LiveFrameMeta {
  /** Current generation token; the worker drops frames from a superseded phase/view. */
  generation: number
  /** Strictly-increasing timestamp (MediaPipe VIDEO mode requirement). */
  timestampMs: number
  /** `video.currentTime`, for the worker's unchanged-frame dedup. */
  currentTime: number
}

export interface LiveBackend {
  start(): Promise<PoseBackendStartResult>
  close(): Promise<void>
  detect(bitmap: ImageBitmap, meta: LiveFrameMeta): Promise<LiveResult | null>
  readiness(): PoseReadiness
  subscribeReadiness(listener: PoseReadinessListener): () => void
  /** Clear sticky GPU-runtime recovery only at an intentional lifecycle end. */
  resetDelegatePreference?(): Promise<void> | void
}

/**
 * The scoring IMAGE backend (`detect.ts`). `warm`/`close` construct/close the
 * IMAGE landmarker; `detect` runs review-preflight + submit scoring.
 */
export interface ImageBackend {
  warm(): Promise<PoseBackendStartResult>
  close(): Promise<void>
  detect(
    src: string,
    view: ViewLabel,
    source?: 'camera' | 'upload',
    poseInput?: PoseInputProvenance | null,
  ): Promise<DetectedPoseFrame>
  readiness(): PoseReadiness
  subscribeReadiness(listener: PoseReadinessListener): () => void
  /** Clear sticky GPU-runtime recovery only at an intentional lifecycle end. */
  resetDelegatePreference(): Promise<void>
}

export interface LiveResult {
  landmarks: Record<string, { x: number; y: number; z?: number; visibility?: number }>
  generation: number
  timestampMs: number
  /** Worker-side synchronous detectForVideo duration. Telemetry only. */
  inferenceMs: number
}

export type RuntimeState = 'closed' | 'live-video' | 'review-image'

export interface CaptureRuntime {
  state(): RuntimeState
  /** Current production model lifecycle for user-facing status. */
  readiness(): PoseReadiness
  /** Subscribe to lifecycle changes; immediately receives the current value. */
  subscribeReadiness(listener: PoseReadinessListener): () => void
  /** Frame a view: close the IMAGE backend, then start the live worker. */
  enterLive(): Promise<void>
  /** Best-effort live inference; null unless the live worker is currently open. */
  frameLive(bitmap: ImageBitmap, meta: LiveFrameMeta): Promise<LiveResult | null>
  /** Close the live worker (shutter → before any review/preflight detection). */
  closeLive(): Promise<void>
  /** Review-preflight + submit scoring: ensure the IMAGE backend is resident
   *  (closing the live worker first), then detect. Serialized so a concurrent
   *  enterLive can never close the landmarker mid-detection. */
  detect(
    src: string,
    view: ViewLabel,
    source?: 'camera' | 'upload',
    poseInput?: PoseInputProvenance | null,
  ): Promise<DetectedPoseFrame>
  /** Retry the last requested backend after a failure, without a page reload. */
  retry(): Promise<void>
  /** Close whichever backend is open (error / visibilitychange-hidden / unmount). */
  dispose(): Promise<void>
}

interface RuntimeDeps {
  live: LiveBackend
  image: ImageBackend
}

/**
 * Register a listener after a lazy module load without leaking it if the owner
 * unsubscribes before that import settles. Exported only to make the race
 * independently testable without loading the MediaPipe bundles.
 */
export function subscribeAfterImport<T>(
  load: () => Promise<T>,
  register: (module: T) => () => void,
): () => void {
  let active = true
  let unsubscribe: (() => void) | null = null
  void load().then(module => {
    if (!active) return
    const registered = register(module)
    if (active) unsubscribe = registered
    else registered()
  }).catch(() => {
    // The owning backend operation reports chunk/init failures through its
    // typed result. A status-only subscription must never create an unhandled
    // rejection when its lazy import fails.
  })
  return () => {
    active = false
    unsubscribe?.()
    unsubscribe = null
  }
}

/**
 * The ONLY thing that constructs/closes a landmarker during capture (design
 * §11.1). Enforces the awaited state machine
 *   `closed → live-video → closed → review-image → closed`
 * with at most one landmarker resident at any instant. Every transition runs on
 * a single serialized chain (an async mutex) and always closes the *other*
 * backend before opening this one, so overlapping/misordered UI calls can never
 * hold two GPU runtimes at once.
 */
export function createCaptureRuntime({ live, image }: RuntimeDeps): CaptureRuntime {
  let state: RuntimeState = 'closed'
  let currentReadiness = readinessMessage('downloading', 'live', null, 'Preparing the live pose model.')
  let lastRequested: 'live' | 'image' = 'live'
  let liveRetryRequired = false
  let backendUnsubscribe: (() => void) | null = null
  const listeners = new Set<PoseReadinessListener>()

  // Async mutex: every transition appends to this chain and runs after the
  // previous one settles, so `close(other) → open(this)` is never interleaved.
  let chain: Promise<unknown> = Promise.resolve()
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn)
    chain = run.then(() => {}, () => {}) // keep the chain alive past rejections
    return run
  }

  function publishReadiness(next: PoseReadiness) {
    currentReadiness = next
    listeners.forEach(listener => listener(next))
  }

  function watchBackend(backend: LiveBackend | ImageBackend) {
    backendUnsubscribe?.()
    backendUnsubscribe = backend.subscribeReadiness(next => {
      publishReadiness(next)
      if (next.phase !== 'failed') return
      if (next.backend === 'live') liveRetryRequired = true
      // Runtime errors arrive outside the transition mutex. Queue teardown so
      // state never remains `live-video`/`review-image` after its backend died.
      if ((next.backend === 'live' && state === 'live-video')
        || (next.backend === 'image' && state === 'review-image')) {
        void exclusive(async () => {
          if (next.backend === 'live' && state === 'live-video') {
            await live.close()
            state = 'closed'
          } else if (next.backend === 'image' && state === 'review-image') {
            await image.close()
            state = 'closed'
          }
        })
      }
    })
  }

  async function closeLiveInternal() {
    if (state === 'live-video') { await live.close(); state = 'closed' }
  }
  async function closeImageInternal() {
    if (state === 'review-image') { await image.close(); state = 'closed' }
  }
  async function enterReviewImageInternal() {
    await closeLiveInternal()
    lastRequested = 'image'
    if (state !== 'review-image') {
      watchBackend(image)
      publishReadiness(readinessMessage('downloading', 'image', null, 'Preparing the scoring pose model.'))
      const result = await image.warm()
      if (!result.ok) {
        await image.close()
        state = 'closed'
        publishReadiness(readinessMessage('failed', 'image', null, result.message))
        throw new Error(result.message)
      }
      state = 'review-image'
      publishReadiness(readinessMessage('ready', 'image', result.delegate))
    }
  }

  async function enterLiveInternal(forceRetry: boolean) {
    lastRequested = 'live'
    if (liveRetryRequired && !forceRetry) return
    if (forceRetry) liveRetryRequired = false
    await closeImageInternal()
    if (state === 'live-video') return
    watchBackend(live)
    publishReadiness(readinessMessage('downloading', 'live', null, 'Preparing the live pose model.'))
    const result = await live.start()
    if (!result.ok) {
      liveRetryRequired = true
      await live.close()
      state = 'closed'
      publishReadiness(readinessMessage('failed', 'live', null, result.message))
      return
    }
    state = 'live-video'
    publishReadiness(readinessMessage('ready', 'live', result.delegate))
  }

  return {
    state: () => state,
    readiness: () => currentReadiness,
    subscribeReadiness: listener => {
      listeners.add(listener)
      listener(currentReadiness)
      return () => listeners.delete(listener)
    },

    enterLive: () => exclusive(() => enterLiveInternal(false)),

    frameLive: (bitmap, meta) => {
      // High-frequency; NOT on the mutex. If the worker isn't open, drop the
      // frame and release the bitmap so it can't leak (§11.7 bitmap ownership).
      if (state !== 'live-video') {
        recordLiveTelemetry({ type: 'frame-drop', reason: 'runtime_not_live' })
        bitmap.close?.()
        return Promise.resolve(null)
      }
      return live.detect(bitmap, meta)
    },

    closeLive: () => exclusive(closeLiveInternal),

    detect: (src, view, source, poseInput) => exclusive(async () => {
      await enterReviewImageInternal()
      try {
        return await image.detect(src, view, source, poseInput)
      } catch (error) {
        await image.close()
        state = 'closed'
        throw error
      }
    }),

    retry: async () => {
      if (lastRequested === 'live') {
        await exclusive(() => enterLiveInternal(true))
      } else {
        await exclusive(async () => {
          await closeImageInternal()
          await enterReviewImageInternal()
        })
      }
    },

    dispose: () => exclusive(async () => {
      await closeLiveInternal()
      await closeImageInternal()
      try {
        await live.resetDelegatePreference?.()
        await image.resetDelegatePreference()
      } finally {
        backendUnsubscribe?.()
        backendUnsubscribe = null
      }
    }),
  }
}

// ---- Real singleton --------------------------------------------------------
// One shared runtime spans the whole capture session (there is only ever one
// active capture UI at a time). Lazily wires the real worker + IMAGE backends.
let singleton: CaptureRuntime | null = null

export function getCaptureRuntime(): CaptureRuntime {
  if (!singleton) singleton = createCaptureRuntime(createRealDeps())
  return singleton
}

function createRealDeps(): RuntimeDeps {
  const live: LiveBackend = {
    async start() { const { startLiveBackend } = await import('./live-backend'); return startLiveBackend() },
    async close() { const { closeLiveBackend } = await import('./live-backend'); await closeLiveBackend() },
    async detect(bitmap, meta) {
      const { detectLiveBackend } = await import('./live-backend')
      return detectLiveBackend(bitmap, meta)
    },
    readiness() {
      // The module is loaded by `start` before this value is needed; this
      // synchronous method exists for dependency symmetry and tests.
      return readinessMessage('downloading', 'live', null, 'Preparing the live pose model.')
    },
    subscribeReadiness(listener) {
      return subscribeAfterImport(
        () => import('./live-backend'),
        module => module.subscribeLiveReadiness(listener),
      )
    },
    async resetDelegatePreference() {
      const { resetLiveDelegatePreference } = await import('./live-backend')
      resetLiveDelegatePreference()
    },
  }
  const image: ImageBackend = {
    async warm() { const { warmUpLandmarker } = await import('./detect'); return warmUpLandmarker() },
    async close() { const { closeLandmarker } = await import('./detect'); await closeLandmarker() },
    async detect(src, view, source, poseInput) {
      const { detectPose } = await import('./detect')
      return detectPose(src, view, source, poseInput)
    },
    readiness() {
      return readinessMessage('downloading', 'image', null, 'Preparing the scoring pose model.')
    },
    subscribeReadiness(listener) {
      return subscribeAfterImport(
        () => import('./detect'),
        module => module.subscribeImageReadiness(listener),
      )
    },
    async resetDelegatePreference() {
      const { resetLandmarkerDelegatePreference } = await import('./detect')
      resetLandmarkerDelegatePreference()
    },
  }
  return { live, image }
}

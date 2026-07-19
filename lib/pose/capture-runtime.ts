import type { ViewLabel } from '@posture-ai/engine/types'
import type { DetectedPoseFrame } from './detect'
import { recordLiveTelemetry } from './live-telemetry'

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
  start(): Promise<void>
  close(): Promise<void>
  detect(bitmap: ImageBitmap, meta: LiveFrameMeta): Promise<LiveResult | null>
}

/**
 * The scoring IMAGE backend (`detect.ts`). `warm`/`close` construct/close the
 * IMAGE landmarker; `detect` runs review-preflight + submit scoring.
 */
export interface ImageBackend {
  warm(): Promise<void>
  close(): Promise<void>
  detect(src: string, view: ViewLabel, source?: 'camera' | 'upload'): Promise<DetectedPoseFrame>
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
  /** Frame a view: close the IMAGE backend, then start the live worker. */
  enterLive(): Promise<void>
  /** Best-effort live inference; null unless the live worker is currently open. */
  frameLive(bitmap: ImageBitmap, meta: LiveFrameMeta): Promise<LiveResult | null>
  /** Close the live worker (shutter → before any review/preflight detection). */
  closeLive(): Promise<void>
  /** Review-preflight + submit scoring: ensure the IMAGE backend is resident
   *  (closing the live worker first), then detect. Serialized so a concurrent
   *  enterLive can never close the landmarker mid-detection. */
  detect(src: string, view: ViewLabel, source?: 'camera' | 'upload'): Promise<DetectedPoseFrame>
  /** Close whichever backend is open (error / visibilitychange-hidden / unmount). */
  dispose(): Promise<void>
}

interface RuntimeDeps {
  live: LiveBackend
  image: ImageBackend
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

  // Async mutex: every transition appends to this chain and runs after the
  // previous one settles, so `close(other) → open(this)` is never interleaved.
  let chain: Promise<unknown> = Promise.resolve()
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn)
    chain = run.then(() => {}, () => {}) // keep the chain alive past rejections
    return run
  }

  async function closeLiveInternal() {
    if (state === 'live-video') { await live.close(); state = 'closed' }
  }
  async function closeImageInternal() {
    if (state === 'review-image') { await image.close(); state = 'closed' }
  }
  async function enterReviewImageInternal() {
    await closeLiveInternal()
    if (state !== 'review-image') { await image.warm(); state = 'review-image' }
  }

  return {
    state: () => state,

    enterLive: () => exclusive(async () => {
      await closeImageInternal()
      if (state !== 'live-video') { await live.start(); state = 'live-video' }
    }),

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

    detect: (src, view, source) => exclusive(async () => {
      await enterReviewImageInternal()
      return image.detect(src, view, source)
    }),

    dispose: () => exclusive(async () => {
      await closeLiveInternal()
      await closeImageInternal()
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
    async start() { const { startLiveBackend } = await import('./live-backend'); await startLiveBackend() },
    async close() { const { closeLiveBackend } = await import('./live-backend'); await closeLiveBackend() },
    async detect(bitmap, meta) {
      const { detectLiveBackend } = await import('./live-backend')
      return detectLiveBackend(bitmap, meta)
    },
  }
  const image: ImageBackend = {
    async warm() { const { warmUpLandmarker } = await import('./detect'); await warmUpLandmarker() },
    async close() { const { closeLandmarker } = await import('./detect'); await closeLandmarker() },
    async detect(src, view, source) { const { detectPose } = await import('./detect'); return detectPose(src, view, source) },
  }
  return { live, image }
}

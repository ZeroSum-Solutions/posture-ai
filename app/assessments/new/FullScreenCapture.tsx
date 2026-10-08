'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion'
import type { Landmark } from '@posture-ai/engine/types'
import type { FrameQuality } from '@/lib/pose/quality'
import { useCameraLevel } from '@/lib/capture/use-camera-level'
import { useWakeLock } from '@/lib/capture/use-wake-lock'
import { getCaptureRuntime } from '@/lib/pose/capture-runtime'
import type { PoseReadiness } from '@/lib/pose/capture-runtime'
import type { PoseInputProvenance } from '@/lib/pose/detect'
import { recordLiveTelemetry } from '@/lib/pose/live-telemetry'
import { shutterGate } from '@/lib/capture/shutter-gate'
import { sourceToViewport } from '@/lib/capture/overlay-transform'
import { samplePixelsFromSource } from '@/lib/capture/pixel-sample'
import { assessPixelQuality, mergePreflightQuality } from '@/lib/capture/pixel-quality'
import type { PixelQualityResult, PixelSample } from '@/lib/capture/pixel-quality'
import type { Captures, CaptureSlotKey } from './types'
import { SLOT_ORDER, SLOT_LABEL, REQUIRED_SLOTS, slotToDomain, isCaptured } from './types'
import { CameraGlyph } from '@/components/SignalGlyphs'
import LiveGuides from './LiveGuides'
import ViewSilhouette from './ViewSilhouette'
import CaptureTelemetryPanel from './CaptureTelemetryPanel'
import CameraPermissionGuidance from './CameraPermissionGuidance'
import {
  cameraErrorName,
  detectBrowser,
  detectPlatform,
  getPermissionGuidance,
  queryCameraPermissionState,
  readUAEnvironment,
} from '@/lib/capture/permission-guidance'
import type { PermissionGuidance, PermissionState } from '@/lib/capture/permission-guidance'
import LegalNotice from '@/components/LegalNotice'
import type { LegalSnapshot } from '@/lib/legal/types'
import Icon from '@/components/array/Icon'
import type { SeverityBand } from '@/components/array/severity'
import { IconButton, Lens } from '@/components/ui'
import styles from './Capture.module.css'
import { spring } from '@/lib/motion'
import { haptic } from '@/lib/haptics'

// Frames grabbed in the shutter burst (engine 1.3.0 within-capture stability).
// A ~5-frame burst of a held pose is enough to estimate landmark jitter without
// a perceptible capture delay.
const BURST_SIZE = 5
const BURST_INTERVAL_MS = 70

// Live-tracking throttle: ~11 fps is enough to steer framing without pinning the
// GPU (the worker also drops overlapping / unchanged frames).
const LIVE_FRAME_INTERVAL_MS = 90
// Sample-and-hold window: a routine dropped/in-flight frame must NOT erase the
// last pose (that would flicker the gate to tilt-only on slower devices). Only
// clear tracking after this long with no fresh inference result.
const LIVE_FRESHNESS_MS = 600
const CAMERA_FRAME_TIMEOUT_MS = 10_000


interface FullScreenCaptureProps {
  /** Exact server-resolved notice required before the wizard may enter capture. */
  screeningNotice: LegalSnapshot | null
  captures: Captures
  /** raw burst object URLs; [0] is the representative still. */
  onCameraCapture: (
    slot: CaptureSlotKey,
    burst: string[],
    captureRollDeg: number | null,
    representativePixelQuality: PixelQualityResult | null,
    poseInput: PoseInputProvenance,
    representativeImage: Blob,
  ) => void
  onFileUpload: (slot: CaptureSlotKey, file: File) => Promise<void> | void
  onProceed: () => void
  onExit: () => void
  modelError: boolean
  onRetryFailedChecks?: () => Promise<void> | void
  submitting: boolean
  uploadError: string | null
}

type Phase = 'disclaimer' | 'upload' | 'live' | 'countdown' | 'review'

// Directional prompt copy per slot (the two side slots cue opposite profiles).
const DIRECTION: Record<CaptureSlotKey, { title: string; cue: string }> = {
  'front': { title: 'Face the camera', cue: 'Stand tall, arms relaxed at your sides — Front View' },
  'side-left': { title: 'Left side to the camera', cue: 'Turn so your LEFT side faces the camera' },
  'side-right': { title: 'Right side to the camera', cue: 'Turn so your RIGHT side faces the camera' },
  'back': { title: 'Turn around', cue: 'Turn 180° so your back faces the camera — Back View' },
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.name === 'CameraFrameTimeoutError') {
    return 'The camera opened but did not deliver a usable frame. Restart the camera or upload a photo instead.'
  }
  if (err instanceof DOMException || (err && typeof err === 'object' && 'name' in err)) {
    const name = (err as { name: string }).name
    if (name === 'NotAllowedError') return 'Camera access denied. Please allow camera permission and try again.'
    if (name === 'NotFoundError') return 'No camera found on this device.'
    if (name === 'NotReadableError') return 'Camera is in use by another app.'
    if (name === 'SecurityError') return 'Camera requires a secure (HTTPS) connection.'
  }
  return 'Could not access the camera. Please try again.'
}

function waitForPlayableFrame(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  const isPlayable = () => (
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    && video.videoWidth > 0
    && video.videoHeight > 0
  )
  if (isPlayable()) return Promise.resolve()

  return new Promise((resolve, reject) => {
    let videoFrameCallbackId: number | null = null
    const timeout = window.setTimeout(() => {
      const error = new Error('Camera frame readiness timed out')
      error.name = 'CameraFrameTimeoutError'
      finish(() => reject(error))
    }, CAMERA_FRAME_TIMEOUT_MS)
    const events: Array<keyof HTMLMediaElementEventMap> = ['loadeddata', 'canplay', 'playing', 'resize']
    const onFrameCandidate = () => {
      if (isPlayable()) finish(resolve)
    }
    const onAbort = () => finish(() => reject(new DOMException('Camera start cancelled', 'AbortError')))
    const finish = (settle: () => void) => {
      window.clearTimeout(timeout)
      for (const event of events) video.removeEventListener(event, onFrameCandidate)
      signal.removeEventListener('abort', onAbort)
      if (videoFrameCallbackId !== null && typeof video.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(videoFrameCallbackId)
      }
      settle()
    }

    for (const event of events) video.addEventListener(event, onFrameCandidate)
    signal.addEventListener('abort', onAbort, { once: true })
    if (typeof video.requestVideoFrameCallback === 'function') {
      videoFrameCallbackId = video.requestVideoFrameCallback(onFrameCandidate)
    }
    onFrameCandidate()
  })
}

/** Only NotAllowedError is a permission problem the guidance module can act
 *  on — NotFoundError/NotReadableError/SecurityError/etc. are real camera
 *  problems and keep their existing plain-copy panel with no guidance below. */
function buildGuidanceForNotAllowed(permissionState: PermissionState): PermissionGuidance {
  const env = readUAEnvironment()
  return getPermissionGuidance({
    browser: detectBrowser(env),
    platform: detectPlatform(env),
    permissionState,
    errorName: 'NotAllowedError',
  })
}

function screenIsNotPortrait(): boolean {
  return typeof screen !== 'undefined'
    && !!screen.orientation
    && !screen.orientation.type.startsWith('portrait')
}

/**
 * Encode the current canvas as a JPEG blob object URL. Object URLs keep the
 * ~5-frame×4-slot burst out of React state as strings (base64 data URLs bloat
 * memory on mobile); callers revoke them on retake/replace/unmount.
 */
function canvasToObjectURL(canvas: HTMLCanvasElement): Promise<{ url: string; image: Blob } | null> {
  return new Promise(resolve => {
    canvas.toBlob(image => resolve(image ? { url: URL.createObjectURL(image), image } : null), 'image/jpeg', 0.9)
  })
}

export default function FullScreenCapture({
  screeningNotice,
  captures,
  onCameraCapture,
  onFileUpload,
  onProceed,
  onExit,
  modelError,
  onRetryFailedChecks,
  submitting,
  uploadError,
}: FullScreenCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRefs = useRef<Record<CaptureSlotKey, HTMLInputElement | null>>({ 'front': null, 'side-left': null, 'side-right': null, 'back': null })
  // Guards async work in openStream from touching a torn-down component (e.g. the
  // user leaves while the camera-permission prompt is open).
  const mountedRef = useRef(true)
  // Invalidates pending permission preflights and getUserMedia calls across
  // visibility/retry/unmount transitions. Stale camera work must never replace
  // or fail a newer successful stream.
  const cameraRequestGenerationRef = useRef(0)
  const cameraFrameAbortRef = useRef<AbortController | null>(null)
  // Most recent navigator.permissions.query('camera') read, carried from the
  // preflight (in startCamera) into openStream's catch — lets the macOS
  // "site allowed, OS blocked the browser" guidance branch fire without
  // openStream itself touching the Permissions API. 'unsupported' by default
  // (Firefox/Safari, or any engine without a preflight yet).
  const permissionStateRef = useRef<PermissionState>('unsupported')
  // Focus target for the camera-unavailable alert panel (§ accessibility —
  // focus must move to it when it appears; see the cameraFailed effect below).
  const cameraErrorPanelRef = useRef<HTMLDivElement>(null)
  // The shutter burst (object URLs) awaiting commit; the middle one is the review still.
  const burstRef = useRef<string[]>([])
  const representativeImageRef = useRef<Blob | null>(null)
  // Pixel-quality result for the representative (burst[0]) frame, scored after
  // burst acquisition (off the shutter-tap path). Null when sampling/scoring
  // failed or hasn't completed yet — read once, at "Use This Photo".
  const representativePixelQualityRef = useRef<PixelQualityResult | null>(null)
  const poseInputRef = useRef<PoseInputProvenance | null>(null)
  // The slot that owned the shutter at capture time. The burst commits to THIS
  // slot, not the live `activeSlot`, so a mid-flight slot change can never
  // mis-associate a capture. Free-order makes this race reachable.
  const captureSlotRef = useRef<CaptureSlotKey>('front')
  // Monotonic id stamped per shutter; carried onto the committed slot.
  const captureIdRef = useRef(0)
  // Synchronous ownership guards. React state drives the UI, while these refs
  // close same-tick races from hidden file inputs / visibility events before a
  // render can publish the disabled controls.
  const captureBusyRef = useRef(false)
  const uploadBusyRef = useRef(false)
  const readyRef = useRef(false)
  // Live-tracking: a generation token (bumped per view/phase change so stale
  // worker results are dropped) + a frame throttle timestamp + the last real
  // inference timestamp (for sample-and-hold freshness).
  const liveGenRef = useRef(0)
  const lastFrameTsRef = useRef(0)
  const lastResultTsRef = useRef(0)

  const [phase, setPhase] = useState<Phase>('disclaimer')
  const [started, setStarted] = useState(false)
  const [ready, setReady] = useState(false)
  const [cameraFailed, setCameraFailed] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // Structured browser-specific recovery steps for a permission-related
  // failure; null for every other camera failure (device missing, in use,
  // disconnected, capture-time encode failure) — those keep the plain panel.
  const [guidance, setGuidance] = useState<PermissionGuidance | null>(null)
  const [runtime] = useState(getCaptureRuntime)
  const [poseReadiness, setPoseReadiness] = useState<PoseReadiness>(() => runtime.readiness())
  const [retryingModel, setRetryingModel] = useState(false)

  const [activeSlot, setActiveSlot] = useState<CaptureSlotKey>('front')
  const [timerOn, setTimerOn] = useState(false)
  const [countdown, setCountdown] = useState(3)
  // True while a shutter burst is being grabbed — locks tile nav + the shutter so
  // the burst can't be re-targeted mid-flight.
  const [isCapturing, setIsCapturing] = useState(false)
  const [uploadingSlot, setUploadingSlot] = useState<CaptureSlotKey | null>(null)

  const [reviewUrl, setReviewUrl] = useState<string | null>(null)
  const [rollAtCapture, setRollAtCapture] = useState<number | null>(null)
  const [previewQuality, setPreviewQuality] = useState<FrameQuality | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [reviewAttempt, setReviewAttempt] = useState(0)
  // Most recently committed slot (upload or "Use This Photo"), tracked so its
  // warning caption stays visible immediately after the auto-advance moves
  // `activeSlot` off it — without this, a just-committed warned slot's coaching
  // text would only be reachable by tapping back to its tile.
  const [lastCommittedSlot, setLastCommittedSlot] = useState<CaptureSlotKey | null>(null)

  // Live worker tracking: landmarks + the source frame's dims, set together each
  // tracked frame (null when the worker isn't tracking → sensor-only guides).
  const [liveFrame, setLiveFrame] = useState<{ landmarks: Record<string, Landmark>; videoDims: { w: number; h: number } } | null>(null)
  const [viewDims, setViewDims] = useState<{ w: number; h: number } | null>(null)
  const liveLandmarks = liveFrame?.landmarks ?? null

  const level = useCameraLevel()
  const { acquire: acquireWakeLock, release: releaseWakeLock } = useWakeLock()
  // "Capture anyway" override — bypasses ALL translation-only gates (§ frozen gate).
  const [overrideGate, setOverrideGate] = useState(false)

  const roll = level.rollDeg
  // Level-meter bands (design §4.1): maintain ≤2°, monitor ≤5°, review >5° — the
  // same thresholds as before, now named through the one severity vocabulary
  // (severity.ts) instead of ad hoc colour words.
  const tiltBand: SeverityBand | null =
    roll === null ? null : Math.abs(roll) <= 2 ? 'maintain' : Math.abs(roll) <= 5 ? 'monitor' : 'review'

  // Cover-crop affine used for BOTH drawing and gating (§11.7), so the gate
  // judges where the subject appears on screen — not raw camera coords. Null
  // until we know the viewport + source dims.
  const overlayTransform = viewDims && liveFrame && liveFrame.videoDims.w > 0
    ? sourceToViewport({ srcW: liveFrame.videoDims.w, srcH: liveFrame.videoDims.h, vpW: viewDims.w, vpH: viewDims.h, mirror: false })
    : null

  // Translation-only shutter gate (§4.2, §11.6): a pure function of tilt +
  // support-base centering + full-body-in-frame (in viewport space); never the
  // posture midline.
  const gate = shutterGate({ landmarks: liveLandmarks, toViewport: overlayTransform?.toViewport ?? null, rollDeg: roll, overrideActive: overrideGate })
  const gateBlocked = !gate.allowed

  const [notPortrait, setNotPortrait] = useState(screenIsNotPortrait)

  const cancelActiveCapture = useCallback((expectedId?: number) => {
    if (expectedId !== undefined && captureIdRef.current !== expectedId) return false
    captureIdRef.current += 1
    captureBusyRef.current = false
    burstRef.current.forEach(url => URL.revokeObjectURL(url))
    burstRef.current = []
    representativeImageRef.current = null
    representativePixelQualityRef.current = null
    poseInputRef.current = null
    setIsCapturing(false)
    setCountdown(3)
    setReviewUrl(null)
    setPreviewQuality(null)
    setPreviewError(null)
    setRollAtCapture(null)
    setPhase('live')
    return true
  }, [])

  // Screen orientation is an external browser store. Re-read it on change so
  // guidance updates without remounting the capture session or resetting its
  // selected view. `orientationchange` covers older mobile WebKit.
  useEffect(() => {
    const update = () => setNotPortrait(screenIsNotPortrait())
    const orientation = typeof screen !== 'undefined' ? screen.orientation : null
    orientation?.addEventListener?.('change', update)
    window.addEventListener('orientationchange', update)
    return () => {
      orientation?.removeEventListener?.('change', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  // ---- camera lifecycle ----
  const stopCameraStream = useCallback(() => {
    cameraFrameAbortRef.current?.abort()
    cameraFrameAbortRef.current = null
    const stream = streamRef.current
    if (!stream) return
    // Clear ownership before stopping tracks so any delayed `ended` event from
    // this retired stream cannot turn a successful recovery into an error.
    streamRef.current = null
    if (videoRef.current?.srcObject === stream) videoRef.current.srcObject = null
    stream.getTracks().forEach(track => track.stop())
  }, [])

  // No synchronous setState here (the first statement is the getUserMedia await),
  // so this is safe to call directly from the start effect. Phase/reset state is
  // driven by the gesture handlers (dismissDisclaimer / retryCamera).
  const openStream = useCallback(async () => {
    const requestGeneration = ++cameraRequestGenerationRef.current
    readyRef.current = false
    stopCameraStream()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 720 }, height: { ideal: 960 }, aspectRatio: { ideal: 3 / 4 } },
      })
      // Component was torn down or backgrounded during the (possibly long)
      // permission prompt — stop the stream instead of orphaning hardware.
      if (
        !mountedRef.current
        || String(document.visibilityState) === 'hidden'
        || cameraRequestGenerationRef.current !== requestGeneration
      ) {
        stream.getTracks().forEach(track => track.stop())
        return
      }
      streamRef.current = stream
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (streamRef.current !== stream || !mountedRef.current) return
        readyRef.current = false
        setReady(false)
        setErrorMsg('Camera disconnected — restart or upload instead.')
        setGuidance(null) // hardware loss, not a permission problem
        setCameraFailed(true)
      })
      if (videoRef.current) {
        const video = videoRef.current
        video.srcObject = stream
        const frameController = new AbortController()
        cameraFrameAbortRef.current = frameController
        void video.play().catch(() => { /* the frame timeout provides recovery */ })
        await waitForPlayableFrame(video, frameController.signal)
        if (cameraFrameAbortRef.current === frameController) cameraFrameAbortRef.current = null
      }
      if (
        !mountedRef.current
        || String(document.visibilityState) === 'hidden'
        || cameraRequestGenerationRef.current !== requestGeneration
        || streamRef.current !== stream
      ) return
      readyRef.current = true
      setReady(true)
      void acquireWakeLock()
    } catch (err) {
      if (
        !mountedRef.current
        || document.visibilityState === 'hidden'
        || cameraRequestGenerationRef.current !== requestGeneration
      ) return
      readyRef.current = false
      if (streamRef.current) stopCameraStream()
      setErrorMsg(getErrorMessage(err))
      setGuidance(cameraErrorName(err) === 'NotAllowedError' ? buildGuidanceForNotAllowed(permissionStateRef.current) : null)
      setCameraFailed(true)
    }
  }, [acquireWakeLock, stopCameraStream])

  // Stop the stream + release the wake lock on unmount. Camera start is driven
  // from the gesture handlers (dismissDisclaimer / retryCamera), not an effect,
  // so setState never runs synchronously inside an effect.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cameraRequestGenerationRef.current += 1
      captureIdRef.current += 1
      captureBusyRef.current = false
      readyRef.current = false
      releaseWakeLock()
      stopCameraStream()
      // Revoke any uncommitted burst object URLs (committed ones are owned by the
      // parent's captures state and outlive this overlay).
      burstRef.current.forEach(URL.revokeObjectURL)
      burstRef.current = []
      representativeImageRef.current = null
      // Close the live VIDEO worker (the scoring IMAGE landmarker, if resident, is
      // the parent's to dispose after submit) — no worker outlives the overlay.
      void getCaptureRuntime().closeLive()
    }
  }, [releaseWakeLock, stopCameraStream])

  // Production-visible model lifecycle. The runtime publishes both live-worker
  // and authoritative IMAGE-scoring transitions through one ordered channel.
  useEffect(() => runtime.subscribeReadiness(setPoseReadiness), [runtime])

  useEffect(() => {
    if (poseReadiness.phase !== 'ready' || typeof performance.mark !== 'function') return
    performance.mark('pose_runtime_ready_for_first_inference')
  }, [poseReadiness.phase])

  async function retryPoseModel() {
    if (retryingModel) return
    setRetryingModel(true)
    try {
      await runtime.retry()
      await onRetryFailedChecks?.()
      if (phase === 'review') {
        setPreviewQuality(null)
        setPreviewError(null)
        setReviewAttempt(attempt => attempt + 1)
      }
    } catch {
      // The runtime publishes the typed failure state and message; keep the
      // retry control available instead of surfacing an unhandled rejection.
    } finally {
      if (mountedRef.current) setRetryingModel(false)
    }
  }

  // Preflight navigator.permissions.query('camera') (feature-detected — a
  // no-op everywhere it's unsupported) before ever calling getUserMedia, so a
  // returning user whose origin is already durably denied sees the recovery
  // steps immediately instead of a silent failure round-trip. A 'granted' or
  // 'prompt' read (or no support at all) falls straight through to the
  // existing openStream path, unchanged.
  const startCamera = useCallback(async () => {
    const requestGeneration = ++cameraRequestGenerationRef.current
    const state = await queryCameraPermissionState()
    if (
      !mountedRef.current
      || document.visibilityState === 'hidden'
      || cameraRequestGenerationRef.current !== requestGeneration
    ) return
    permissionStateRef.current = state
    if (state === 'denied') {
      setErrorMsg('Camera access denied. Please allow camera permission and try again.')
      setGuidance(buildGuidanceForNotAllowed(state))
      setCameraFailed(true)
      return
    }
    void openStream()
  }, [openStream])

  function retryCamera() {
    readyRef.current = false
    setReady(false)
    setCameraFailed(false)
    setErrorMsg(null)
    setGuidance(null)
    setPhase('live')
    void startCamera()
  }

  // The wake-lock hook owns visible-page reacquisition. This listener owns the
  // camera + pose runtime: release both while hidden, then reacquire a fresh
  // stream on restore. React state (including the selected view) stays mounted.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'hidden') {
        readyRef.current = false
        setReady(false)
        cameraRequestGenerationRef.current += 1
        if (captureBusyRef.current) cancelActiveCapture()
        stopCameraStream()
        void getCaptureRuntime().dispose()
        return
      }
      if (started && !cameraFailed) void openStream()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [started, cameraFailed, cancelActiveCapture, openStream, stopCameraStream])

  // Track the on-screen overlay size (for the cover-crop affine + level line).
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => { const r = el.getBoundingClientRect(); setViewDims({ w: r.width, h: r.height }) }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Live worker tracking loop: while framing a view, enter the live runtime and
  // feed throttled frames to the worker; drop stale results by generation token.
  // Any failure degrades silently to sensor-only guides (§4.1 fallback).
  useEffect(() => {
    // Track through BOTH live and countdown so the self-timer's shutter-instant
    // recheck sees a current pose (not tilt-only). Only run when the camera is
    // streaming and we can grab frames — no point spawning/closing a VIDEO
    // landmarker (churning against the IMAGE one) with no ready camera
    // (upload-only) or no createImageBitmap (SSR / disabled). Degrades to
    // sensor-only guides + tilt-only shutter (§4.1 fallback).
    if ((phase !== 'live' && phase !== 'countdown') || cameraFailed || !ready || typeof createImageBitmap !== 'function') return
    const runtime = getCaptureRuntime()
    liveGenRef.current += 1
    const gen = liveGenRef.current
    lastFrameTsRef.current = 0
    lastResultTsRef.current = performance.now()
    void runtime.enterLive()

    let stopped = false
    let raf = 0
    const loop = () => {
      if (stopped) return
      const video = videoRef.current
      const now = performance.now()
      if (document.visibilityState !== 'hidden' && video && video.videoWidth > 0 && ready && typeof createImageBitmap === 'function'
        && now - lastFrameTsRef.current >= LIVE_FRAME_INTERVAL_MS) {
        lastFrameTsRef.current = now
        recordLiveTelemetry({ type: 'frame-attempt' })
        // Independent freshness watchdog: clear a stale pose whenever no real
        // inference has landed within the window — whether frames are dropped
        // in-flight, rejected by createImageBitmap/frameLive, or simply not
        // returning. Runs synchronously so it never depends on a fulfilled null.
        if (now - lastResultTsRef.current > LIVE_FRESHNESS_MS) setLiveFrame(null)
        // Self-heal: a fire-and-forget preflight (or a visibility-hidden close)
        // may have left the runtime out of live-video for this view — re-enter.
        if (runtime.state() !== 'live-video') void runtime.enterLive()
        const videoDims = { w: video.videoWidth, h: video.videoHeight }
        const currentTime = video.currentTime
        createImageBitmap(video)
          .then(bitmap => {
            // Drop a stale bitmap (view changed / effect stopped while decoding)
            // rather than spending inference on the old view.
            if (stopped || liveGenRef.current !== gen) {
              recordLiveTelemetry({ type: 'frame-drop', reason: 'stale_bitmap' })
              bitmap.close?.()
              return null
            }
            return runtime.frameLive(bitmap, { generation: gen, timestampMs: now, currentTime })
          })
          .then(res => {
            if (stopped || liveGenRef.current !== gen || !res) return
            // A real inference result (landmarks may be empty = no person); a
            // routine dropped/in-flight null just holds the last pose (watchdog
            // above expires it if drops persist past the freshness window).
            setLiveFrame({ landmarks: res.landmarks, videoDims })
            lastResultTsRef.current = performance.now()
          })
          .catch(() => {
            recordLiveTelemetry({ type: 'frame-drop', reason: 'bitmap_error' })
            // Frame skipped — the watchdog handles staleness.
          })
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    // Clear tracking when leaving live/countdown (→ review) or changing view so a
    // prior view's landmarks never linger in the gate or overlay.
    return () => { stopped = true; cancelAnimationFrame(raf); setLiveFrame(null) }
  }, [phase, activeSlot, cameraFailed, ready])

  // A live camera failing/ending tears down the tracking loop but must also close
  // the live worker — otherwise the VIDEO backend lingers resident on the
  // camera-error screen (the IMAGE backend, if any, is closed on exit/submit).
  useEffect(() => {
    if (cameraFailed) void getCaptureRuntime().closeLive()
  }, [cameraFailed])

  // Focus management: this overlay covers the whole viewport, so move focus to
  // the primary control of each phase and keep Tab within the overlay.
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const sel = phase === 'disclaimer' ? '[data-testid="capture-disclaimer-dismiss"]'
      : phase === 'upload' ? '[data-autofocus="upload"]'
      : phase === 'review' ? '[data-autofocus="retake"]'
      : '[data-autofocus="shutter"]'
    ;(root.querySelector<HTMLElement>(sel) ?? root).focus()
  }, [phase])

  // The camera-unavailable alert panel isn't covered by the phase-keyed focus
  // effect above (phase stays 'live'/'countdown' while cameraFailed flips) —
  // move focus to it explicitly whenever it appears, so a screen-reader user
  // lands on the alert (and its guidance, when present) instead of the outer
  // container's fallback focus.
  useEffect(() => {
    if (cameraFailed) cameraErrorPanelRef.current?.focus()
  }, [cameraFailed])

  // Escape closes the overlay; Tab is trapped within it (SC 2.1.2 / 2.4.3).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onExit(); return }
      if (e.key !== 'Tab') return
      const root = containerRef.current
      if (!root) return
      const nodes = Array.from(
        root.querySelectorAll<HTMLElement>('button, [href], input:not([type="hidden"]), [tabindex]:not([tabindex="-1"])'),
      ).filter(el => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true' && el.getClientRects().length > 0)
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (!active || !root.contains(active)) { e.preventDefault(); first.focus() }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onExit])

  function dismissDisclaimer() {
    setStarted(true)
    setPhase('live')
    // Must be called from this user gesture (iOS DeviceOrientation permission).
    if (level.permission === 'needs-request') void level.requestAccess()
    void startCamera()
  }

  function chooseUploadMode() {
    setStarted(false)
    setCameraFailed(false)
    setErrorMsg(null)
    setGuidance(null)
    setPhase('upload')
  }

  // ---- capture ----
  // Grab a short burst of distinct live frames (not one still): a held pose over
  // ~300ms yields the landmark jitter the engine turns into within-capture
  // stability. All frames are stashed; the middle one is shown for review.
  const capture = useCallback(async (id: number) => {
    const urls: string[] = []
    const imagesByUrl = new Map<string, Blob>()
    const revokeLocalUrls = () => urls.splice(0).forEach(url => URL.revokeObjectURL(url))
    const stillOwned = () => mountedRef.current
      && captureBusyRef.current
      && captureIdRef.current === id
      && document.visibilityState === 'visible'
      && readyRef.current
      && streamRef.current !== null
    const abandon = (surfaceError: boolean) => {
      revokeLocalUrls()
      if (!mountedRef.current || captureIdRef.current !== id) return
      cancelActiveCapture(id)
      if (surfaceError) {
        setErrorMsg('Capture failed — try again or upload instead.')
        setGuidance(null) // an encode failure, not a permission problem
        setCameraFailed(true)
      }
    }

    // The click/countdown driver allocates the operation id and freezes the
    // target slot. Re-check actual browser/camera ownership at the instant the
    // burst begins; a stale React `ready` render never authorizes capture.
    if (!stillOwned()) { abandon(false); return }
    setIsCapturing(true)
    const rollAt = level.rollRef.current // roll at the shutter instant
    const midIndex = Math.floor(BURST_SIZE / 2)
    // Pixel sample of the representative middle frame, extracted (cheap GPU
    // drawImage + small getImageData) BEFORE that frame's toBlob encode — kept
    // only if that exact frame's encode succeeds (URL-based association, not
    // index — the loop below may skip failed encodes; r3 Sol-1).
    let midSample: PixelSample | null = null
    let representativeUrl: string | null = null
    try {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas) throw new Error('Capture surface unavailable')
      if (video.videoWidth <= 0 || video.videoHeight <= 0) {
        throw new Error('Camera frame dimensions unavailable')
      }
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      let observedCameraFacingMode: string | null = null
      try {
        const setting = streamRef.current?.getVideoTracks()[0]?.getSettings().facingMode
        observedCameraFacingMode = typeof setting === 'string' && setting.length > 0 ? setting : null
      } catch {
        observedCameraFacingMode = null
      }
      poseInputRef.current = {
        sourceWidthPx: canvas.width,
        sourceHeightPx: canvas.height,
        orientationNormalization: 'camera_video_frame',
        analysisMirrored: false,
        displayMirrored: false,
        requestedCameraFacingMode: 'environment',
        observedCameraFacingMode,
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Capture context unavailable')

      for (let i = 0; i < BURST_SIZE; i++) {
        // Visibility/camera loss or a newer operation invalidates every partial
        // frame. The post-encode check catches backgrounding while toBlob waits.
        if (!stillOwned()) { abandon(false); return }
        if (!overrideGate && Math.abs(level.rollRef.current ?? 0) > 5) { abandon(false); return }
        ctx.drawImage(video, 0, 0)
        if (i === midIndex) midSample = samplePixelsFromSource(canvas, canvas.width, canvas.height)
        const encoded = await canvasToObjectURL(canvas)
        if (encoded) {
          urls.push(encoded.url)
          imagesByUrl.set(encoded.url, encoded.image)
          if (i === midIndex) representativeUrl = encoded.url
        }
        if (!stillOwned()) { abandon(false); return }
        if (i < BURST_SIZE - 1) await new Promise(r => setTimeout(r, BURST_INTERVAL_MS))
      }
      if (!stillOwned()) { abandon(false); return }
      if (urls.length === 0) throw new Error('Every capture encode failed')

      // Put the reviewed (representative) frame first so the preview thumbnail AND
      // the quality preflight — both of which the parent runs on burst[0] — judge
      // exactly the frame the user reviews and approves. The engine medians every
      // frame at submit, so array order is irrelevant to within-capture stability.
      // Prefer the exact sampled middle frame by URL; if its encode failed, fall
      // back to the existing middle-of-successful-frames ordering and drop the
      // sample (no matching burst[0] frame to report against — fail open).
      if (representativeUrl) {
        burstRef.current = [representativeUrl, ...urls.filter(u => u !== representativeUrl)]
      } else {
        const mid = Math.floor(urls.length / 2)
        burstRef.current = [urls[mid], ...urls.slice(0, mid), ...urls.slice(mid + 1)]
        midSample = null
      }
      representativeImageRef.current = imagesByUrl.get(burstRef.current[0]) ?? null
      if (!representativeImageRef.current) throw new Error('Representative capture bytes unavailable')
    } catch {
      abandon(true)
      return
    }
    const representative = burstRef.current[0]
    captureBusyRef.current = false
    setRollAtCapture(rollAt)
    setPreviewQuality(null)
    setPreviewError(null)
    setReviewUrl(representative) // representative still (now burst[0])
    setIsCapturing(false)
    setPhase('review')
    // Stream keeps running so the next view is instant — the frozen still is
    // shown as an overlay during review.

    // Score off the shutter-tap path: yield a macrotask so the burst-finished
    // review UI paints before this CPU-bound pass runs (r3 Sol-NIT-5/Gemini-
    // NIT-1). Fails open — sampling/scoring failure never blocks capture or
    // sets modelError. Completes well before "Use This Photo" is read.
    // Defense in depth: if useThisPhoto() fires before this yield resolves
    // (a very fast tap), the slot simply commits with pixelQuality: null —
    // an accepted fail-open, not a bug; the wizard's own preflight remains
    // authoritative regardless.
    representativePixelQualityRef.current = null
    if (midSample) {
      const sample = midSample
      await new Promise(r => setTimeout(r, 0))
      // This guard only catches a NEW capture starting during the yield (id
      // bumped). A DISCARDED burst (retake/unmount) finishing its scoring here
      // is harmless without an extra check: reviewUrl is the sole reader of
      // this ref (the review-quality effect below), so a discarded burst has
      // no reviewUrl pointing at it — nothing reads a stale score — and every
      // discard path (retakeStill/discardBurst/useThisPhoto) resets the ref.
      if (captureIdRef.current !== id) return // superseded while yielding — discard
      try {
        representativePixelQualityRef.current = assessPixelQuality(sample)
      } catch {
        representativePixelQualityRef.current = null
      }
    }
  }, [cancelActiveCapture, level.rollRef, overrideGate])

  function startCountdown() {
    void acquireWakeLock()
    setCountdown(3)
    setPhase('countdown')
  }

  function onShutter() {
    if (
      gateBlocked
      || !readyRef.current
      || document.visibilityState !== 'visible'
      || captureBusyRef.current
      || uploadBusyRef.current
    ) return
    const id = ++captureIdRef.current
    captureSlotRef.current = activeSlot
    captureBusyRef.current = true
    if (timerOn) startCountdown()
    else void capture(id)
  }

  // Countdown driver — re-checks the shutter gate at the capture instant.
  useEffect(() => {
    if (phase !== 'countdown') return
    if (countdown <= 0) {
      const id = captureIdRef.current
      if (
        gateBlocked
        || !captureBusyRef.current
        || !readyRef.current
        || document.visibilityState !== 'visible'
      ) {
        const abort = setTimeout(() => { cancelActiveCapture(id) }, 0)
        return () => clearTimeout(abort)
      }
      void capture(id)
      return
    }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [phase, countdown, capture, cancelActiveCapture, gateBlocked])

  // Best-effort framing feedback on the captured still, so the user can retake
  // before committing. The wizard's preflight remains authoritative.
  useEffect(() => {
    if (phase !== 'review' || !reviewUrl) return
    let cancelled = false
    void (async () => {
      try {
        const { getCaptureRuntime } = await import('@/lib/pose/capture-runtime')
        const { assessFrameQuality } = await import('@/lib/pose/quality')
        const { view } = slotToDomain(activeSlot)
        // Route through the runtime owner — it closes the live worker before the
        // IMAGE landmarker scores this still, so the two never run at once (§11.1).
        const frame = await getCaptureRuntime().detect(reviewUrl, view, 'camera', poseInputRef.current)
        // Merge in the representative frame's precomputed pixel-quality (scored
        // off the shutter-tap path, above) so pixel warnings are visible on the
        // review screen before "Use This Photo" — reusing the already-scored
        // result, never resampling/rescoring here. Reading the ref here is safe
        // only because scoring resolves in one macrotask while this effect must
        // first clear the detect() await above — if detect() ever becomes
        // synchronous/instant-cached, the ref could still be null at this read.
        if (!cancelled) setPreviewQuality(mergePreflightQuality(assessFrameQuality(frame, view), representativePixelQualityRef.current))
      } catch {
        if (!cancelled) {
          setPreviewError('The posture model could not check this photo. Retry the check or retake the photo.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [phase, reviewUrl, activeSlot, reviewAttempt])

  // The next uncaptured slot after `committed` in canonical order — a convenience
  // advance after a capture. Free-order means every slot is selectable directly,
  // so this only picks a sensible default next slot; it never gates proceeding.
  function nextUncapturedAfter(committed: CaptureSlotKey): CaptureSlotKey | null {
    const start = SLOT_ORDER.indexOf(committed)
    for (let i = start + 1; i < SLOT_ORDER.length; i++) {
      const s = SLOT_ORDER[i]
      if (!isCaptured(captures[s])) return s
    }
    // Wrap: fill any earlier gap the user skipped past.
    for (let i = 0; i < start; i++) {
      const s = SLOT_ORDER[i]
      if (!isCaptured(captures[s])) return s
    }
    return null
  }

  function useThisPhoto() {
    const hardFailure = previewQuality?.status === 'no_person' || previewQuality?.status === 'multiple_people'
    if (!reviewUrl || !previewQuality || previewError || hardFailure) return
    // Commit to the slot that owned the shutter, never the (possibly changed)
    // live `activeSlot` — the burst belongs to captureSlotRef.
    const committed = captureSlotRef.current
    const burst = burstRef.current.length > 0 ? burstRef.current : [reviewUrl]
    const poseInput = poseInputRef.current
    const representativeImage = representativeImageRef.current
    if (!poseInput || !representativeImage) return
    onCameraCapture(committed, burst, rollAtCapture, representativePixelQualityRef.current, poseInput, representativeImage)
    setLastCommittedSlot(committed)
    burstRef.current = [] // ownership transferred to the parent; do not revoke
    representativeImageRef.current = null
    representativePixelQualityRef.current = null
    poseInputRef.current = null
    setReviewUrl(null)
    setPreviewQuality(null)
    setPreviewError(null)
    setRollAtCapture(null)
    setOverrideGate(false)
    // Advance to the next uncaptured slot as a convenience. Analysis is ALWAYS an
    // explicit user action (the Analyze button, enabled once the required slots
    // are present) — capture order never auto-proceeds.
    const next = nextUncapturedAfter(committed)
    if (next) setActiveSlot(next)
    setPhase('live')
  }

  // Discard an uncommitted review: revoke its object URLs so they don't leak.
  function discardBurst() {
    burstRef.current.forEach(URL.revokeObjectURL)
    burstRef.current = []
    representativeImageRef.current = null
    representativePixelQualityRef.current = null
    poseInputRef.current = null
  }

  function retakeStill() {
    discardBurst()
    setReviewUrl(null)
    setPreviewQuality(null)
    setPreviewError(null)
    setRollAtCapture(null)
    setOverrideGate(false)
    setPhase('live')
  }

  function selectSlot(slot: CaptureSlotKey) {
    // Freeze navigation from shutter click through countdown + burst. The ref
    // also blocks same-tick/programmatic races before disabled state renders.
    if (captureBusyRef.current || uploadBusyRef.current) return
    // A new view must earn its own "capture anyway" — override never carries over.
    setOverrideGate(false)
    setActiveSlot(slot)
    if (phase === 'review') retakeStill()
  }

  function triggerUploadFor(slot: CaptureSlotKey) {
    if (captureBusyRef.current || uploadBusyRef.current) return
    setActiveSlot(slot)
    fileInputRefs.current[slot]?.click()
  }

  function triggerUpload() {
    triggerUploadFor(activeSlot)
  }

  // Uploading a slot commits it and advances to the next uncaptured slot, so the
  // upload-only path (no camera) still walks through every required slot.
  async function handleUpload(slot: CaptureSlotKey, file: File) {
    if (captureBusyRef.current || uploadBusyRef.current) return
    uploadBusyRef.current = true
    setUploadingSlot(slot)
    try {
      await onFileUpload(slot, file)
      if (!mountedRef.current) return
      setLastCommittedSlot(slot)
      const next = nextUncapturedAfter(slot)
      if (next) { setOverrideGate(false); setActiveSlot(next) }
    } catch {
      // The parent owns the slot-specific error copy. Keep this view selected
      // so the practitioner can choose a replacement immediately.
    } finally {
      uploadBusyRef.current = false
      if (mountedRef.current) setUploadingSlot(null)
    }
  }

  // ---- derived UI state ----
  // Ready once all four production views are present, independent of
  // capture order — the free-order flow has no terminal "last view" trigger.
  const requiredReady = REQUIRED_SLOTS.every(s => isCaptured(captures[s]))
  // A required slot whose quality preflight is still running — proceeding now
  // would bypass the subject-count block, so gate the Analyze action until it settles.
  const requiredChecking = REQUIRED_SLOTS.some(s => isCaptured(captures[s]) && captures[s].slotStatus === 'checking')
  const requiredModelFailed = REQUIRED_SLOTS.some(s => isCaptured(captures[s]) && captures[s].slotStatus === 'model_error')
  const requiredSubjectFailed = REQUIRED_SLOTS.some(s => isCaptured(captures[s])
    && (captures[s].slotStatus === 'no_person' || captures[s].slotStatus === 'multiple_people'))
  const noPersonViews = SLOT_ORDER.filter(s => isCaptured(captures[s]) && captures[s].slotStatus === 'no_person')
  const multiplePeopleViews = SLOT_ORDER.filter(s => isCaptured(captures[s]) && captures[s].slotStatus === 'multiple_people')
  const captureLocked = phase === 'countdown' || isCapturing || uploadingSlot !== null
  const analyzeBlocked = submitting || captureLocked || requiredChecking || requiredModelFailed || requiredSubjectFailed
  const direction = DIRECTION[activeSlot]

  // Committed-slot warning caption (soft coaching copy for the upload path,
  // which has no review phase of its own — camera captures also land here
  // once committed). Prefer the active tile; when the active tile has no
  // warnings, fall back to the most recently committed slot so the coaching
  // text from an auto-advanced-past upload/capture is visible without a tap.
  // Suppressed during 'review' so it never doubles the review card's own
  // warnings block, which covers the in-progress (uncommitted) capture.
  const activeCap = captures[activeSlot]
  const activeCapWarned = isCaptured(activeCap) && activeCap.slotStatus === 'warnings' && (activeCap.quality?.warnings.length ?? 0) > 0
  const lastCap = lastCommittedSlot ? captures[lastCommittedSlot] : null
  const lastCapWarned = !!lastCap && lastCommittedSlot !== activeSlot && isCaptured(lastCap) && lastCap.slotStatus === 'warnings' && (lastCap.quality?.warnings.length ?? 0) > 0
  const captionSlot: CaptureSlotKey | null = phase === 'review' ? null : activeCapWarned ? activeSlot : lastCapWarned ? lastCommittedSlot : null
  const captionWarnings = captionSlot ? captures[captionSlot].quality?.warnings ?? [] : []
  const captionPrefix = captionSlot && captionSlot !== activeSlot ? `${SLOT_LABEL[captionSlot]}: ` : ''

  const showLiveCamera = (phase === 'live' || phase === 'countdown') && !cameraFailed
  const reviewHardFailure = previewQuality?.status === 'no_person' || previewQuality?.status === 'multiple_people'
  const reviewAcceptDisabled = previewQuality === null || previewError !== null || reviewHardFailure
  const poseModelFailed = poseReadiness.phase === 'failed' || modelError
  const readinessLabel = modelError && poseReadiness.phase !== 'failed'
    ? 'Posture model check failed.'
    : poseReadiness.phase === 'downloading'
    ? 'Downloading posture model…'
    : poseReadiness.phase === 'initializing'
      ? `Initializing posture model${poseReadiness.delegate ? ` (${poseReadiness.delegate.toUpperCase()})` : ''}…`
      : poseReadiness.phase === 'ready'
        ? `Posture model ready${poseReadiness.delegate ? ` (${poseReadiness.delegate.toUpperCase()})` : ''}`
        : poseReadiness.message || 'Posture model failed to start.'
  const allClear = requiredReady && !requiredChecking && !requiredModelFailed && !requiredSubjectFailed

  // Shutter "ready" pulse (spec §5 Capture: method + camera): a one-shot
  // delight spring + haptic the instant the shutter gate opens, never a
  // looping animation and never a replacement for the gate's own disabled
  // state (which the shutter button below still owns via `disabled`/
  // `aria-disabled`, unchanged).
  const shutterReady = showLiveCamera && phase === 'live' && !gateBlocked && ready && !captureLocked
  const shutterPulse = useAnimationControls()
  const reducedMotionPreferred = useReducedMotion()
  const wasShutterReadyRef = useRef(false)
  useEffect(() => {
    if (shutterReady && !wasShutterReadyRef.current) {
      haptic('tap')
      // A spring transition only supports two keyframes, so [1, 1.06, 1] is
      // expressed as one spring value (1.06) that reverses once — physically
      // identical to the three-keyframe pulse, without the keyframe limit.
      if (!reducedMotionPreferred) {
        void shutterPulse.start({ scale: 1.06 }, { ...spring.delight, repeat: 1, repeatType: 'reverse' })
      }
    }
    wasShutterReadyRef.current = shutterReady
  }, [shutterReady, shutterPulse, reducedMotionPreferred])

  return (
    <div ref={containerRef} tabIndex={-1} aria-label="Posture capture" className={styles.root} data-testid="fullscreen-capture" data-immersive-surface>
      <CaptureTelemetryPanel activeSlot={activeSlot} phase={phase} />
      {/* sr-only assertive announcer for the self-timer countdown (must be
          always-mounted so the live region announces changes) */}
      <div role="timer" aria-live="assertive" aria-atomic="true" className={styles.srOnly}>
        {phase === 'countdown' && countdown > 0 ? `Capturing in ${countdown}` : ''}
      </div>
      {/* Hidden per-slot file inputs — DOM order is front, side-left, side-right,
          back (e2e targets input[type=file] by index). */}
      {SLOT_ORDER.map(slot => (
        <input
          key={slot}
          ref={el => { fileInputRefs.current[slot] = el }}
          type="file"
          disabled={captureLocked}
          accept="image/jpeg,image/png"
          style={{ display: 'none' }}
          aria-label={`Upload ${SLOT_LABEL[slot]} photo`}
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) void handleUpload(slot, file)
            e.target.value = ''
          }}
        />
      ))}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* ---------- Setup + screening notice (first open only) ---------- */}
      {phase === 'disclaimer' ? (
        <div className={styles.setup}>
          <div role="dialog" aria-modal="true" aria-label={screeningNotice ? 'Screening notice' : 'Capture setup'} data-testid="capture-disclaimer" className={styles.setupDialog}>
            <div className={styles.setupHead}>
              <Lens size={52} breathing />
              <div>
                <span className="t-micro">Before you scan</span>
                <p className="t-headline" style={{ margin: 0 }}>Four views, one person in frame</p>
              </div>
            </div>
            <ol className={styles.setupViews} aria-label="Four views to capture">
              {SLOT_ORDER.map(slot => (
                <li key={slot}>
                  <ViewSilhouette slot={slot} size={26} />
                  <span className="t-micro">{SLOT_LABEL[slot].replace(' Side', '')}</span>
                </li>
              ))}
            </ol>
            <div className={styles.setupBody}>
              {screeningNotice ? (
                <LegalNotice document={screeningNotice} compact />
              ) : (
                <div>
                  <h2 className="t-headline">Ready to capture four views</h2>
                  <p className="t-body">Use a well-lit space and keep the client’s full body in frame.</p>
                </div>
              )}
            </div>
            <div className={styles.actions}>
              <button
                data-testid="capture-disclaimer-dismiss"
                onClick={dismissDisclaimer}
                className="a-primary a-primary--bar"
              >
                Start live capture
              </button>
              <button
                type="button"
                onClick={chooseUploadMode}
                className="a-secondary a-secondary--bar"
              >
                Upload existing photos
              </button>
              <button
                onClick={onExit}
                className={styles.quiet}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : phase === 'upload' ? (
        <div className={styles.upload}>
          <div className={styles.uploadInner}>
            <div>
              <span className="t-micro">{REQUIRED_SLOTS.filter(slot => isCaptured(captures[slot])).length} of 4 views</span>
              <h2 className="t-title">Upload four posture views</h2>
            </div>
            <p className="t-label">
              One recent JPEG or PNG for each view. The same private storage and photo checks as live capture apply.
            </p>

            <ul className={styles.uploadList} aria-label="Views">
              {SLOT_ORDER.map((slot, index) => {
                const cap = captures[slot]
                const captured = isCaptured(cap)
                const status = uploadingSlot === slot
                  ? 'Preparing…'
                  : !captured
                    ? 'Choose photo'
                    : cap.slotStatus === 'checking'
                      ? 'Checking…'
                      : cap.slotStatus === 'model_error'
                        ? 'Check failed'
                        : cap.slotStatus === 'no_person'
                          ? 'No person detected'
                          : cap.slotStatus === 'multiple_people'
                            ? 'Multiple people detected'
                            : cap.slotStatus === 'warnings'
                              ? 'Ready with warning'
                              : 'Ready'
                const band = slotBand(cap)
                return (
                  <li key={slot}>
                    <button
                      type="button"
                      data-autofocus={index === 0 ? 'upload' : undefined}
                      onClick={() => triggerUploadFor(slot)}
                      disabled={captureLocked}
                      className={styles.uploadRow}
                    >
                      <span className={styles.well} aria-hidden="true">
                        {captured && cap.displayPreviewUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={cap.displayPreviewUrl} alt="" />
                          : <ViewSilhouette slot={slot} size={26} />}
                      </span>
                      <span className={styles.uploadLabel}>{SLOT_LABEL[slot]}</span>
                      <span className={styles.uploadStatus}>
                        {captured && <span className={styles.dot} data-band={band ?? undefined} aria-hidden="true" />}
                        {status}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>

            {uploadError && (
              <div role="alert" className={`${styles.note} ${styles.scrim}`}>
                <span className={styles.dot} data-band="review" aria-hidden="true" />
                <div className={styles.noteBody}><p>{uploadError}</p></div>
              </div>
            )}
            {noPersonViews.length > 0 && (
              <div role="alert" className={`${styles.note} ${styles.scrim}`}>
                <span className={styles.dot} data-band="review" aria-hidden="true" />
                <div className={styles.noteBody}><p>No person detected — replace {noPersonViews.map(slot => SLOT_LABEL[slot]).join(', ')}</p></div>
              </div>
            )}
            {multiplePeopleViews.length > 0 && (
              <div role="alert" className={`${styles.note} ${styles.scrim}`}>
                <span className={styles.dot} data-band="review" aria-hidden="true" />
                <div className={styles.noteBody}><p>More than one person detected — replace {multiplePeopleViews.map(slot => SLOT_LABEL[slot]).join(', ')}</p></div>
              </div>
            )}
            <div role="status" aria-live="polite" aria-atomic="true">
              {captionSlot && captionWarnings.length > 0 && (
                <div data-testid="slot-quality-caption" className={`${styles.note} ${styles.scrim}`}>
                  <span className={styles.dot} data-band="monitor" aria-hidden="true" />
                  <div className={styles.noteBody}>
                    {captionWarnings.map((warning, index) => (
                      <p key={index}>
                        {index === 0 ? captionPrefix : ''}{warning}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {requiredReady && <CompleteCard allClear={allClear} />}
            {requiredReady && (
              <button
                type="button"
                onClick={onProceed}
                disabled={analyzeBlocked}
                className="a-primary a-primary--bar"
                style={{ cursor: analyzeBlocked ? 'not-allowed' : 'pointer' }}
              >
                {submitting ? 'Submitting…' : captureLocked ? 'Preparing photo…' : requiredChecking ? 'Checking photos…' : requiredModelFailed ? 'Retry failed photo checks' : requiredSubjectFailed ? 'Replace invalid photos' : 'Analyze Posture'}
              </button>
            )}
            {requiredModelFailed && onRetryFailedChecks && (
              <button type="button" onClick={() => void onRetryFailedChecks()} className="a-secondary a-secondary--bar">
                Retry photo checks
              </button>
            )}

            <div className={styles.footerActions}>
              <button type="button" onClick={() => setPhase('disclaimer')} disabled={captureLocked || submitting} className={styles.quiet}>
                Capture options
              </button>
              <button type="button" onClick={onExit} disabled={captureLocked || submitting} className={styles.quiet}>
                Change client
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* ---------- Camera stage ---------- */}
          <div className={styles.stage}>
            {/* Live video (kept mounted so the stream never restarts between views) */}
            <video
              data-testid="capture-video"
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={styles.media}
              style={{ display: showLiveCamera ? 'block' : 'none' }}
            />

            {showLiveCamera && phase === 'live' && (
              <LiveGuides
                landmarks={liveLandmarks}
                viewDims={viewDims}
                videoDims={liveFrame?.videoDims ?? null}
                rollDeg={roll}
                view={slotToDomain(activeSlot).view}
                centeringState={gate.factors.centering}
              />
            )}

            {/* Frozen still during review */}
            {phase === 'review' && reviewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={reviewUrl} alt="Captured frame" className={styles.media} />
            )}

            {/* The viewfinder reticle: corners lock volt when the shutter is ready. */}
            {showLiveCamera && (
              <div className={styles.reticle} data-ready={shutterReady ? 'true' : undefined} aria-hidden="true">
                <span /><span /><span /><span />
              </div>
            )}

            {/* Camera-unavailable panel — non-blocking: the upload fallback and
                proceed controls below stay usable (they render above this stage
                at zIndex 2). The panel itself sits above that zIndex 2 layer too
                (so its own Try Again / Try Opening System Settings buttons are
                never covered by the bottom slot strip when the permission
                guidance copy grows tall) but keeps pointerEvents 'none' on its
                own empty area and re-enables it only on its interactive
                children, so clicks on blank padding still fall through to the
                bottom controls underneath. */}
            {cameraFailed && (
              <div
                ref={cameraErrorPanelRef}
                tabIndex={-1}
                role="alert"
                aria-live="assertive"
                className={styles.cameraError}
              >
                {/* display:contents keeps the flex-centered layout above as if
                    these were direct children, while restoring pointerEvents
                    (an inherited CSS property) on the actual visible content —
                    so the panel's empty padding still passes clicks through to
                    the bottom controls, per the comment above. */}
                <div className={styles.cameraErrorContent}>
                  <span className={styles.cameraErrorGlyph}><CameraGlyph size={34} /></span>
                  <p className={`t-headline ${styles.cameraErrorTitle}`}>Camera Unavailable</p>
                  <p data-testid="camera-error-msg" className={`t-callout ${styles.cameraErrorMsg}`}>{errorMsg}</p>
                  <CameraPermissionGuidance guidance={guidance} onRetry={retryCamera} />
                </div>
              </div>
            )}
          </div>

          {/* ---------- Top overlays ---------- */}
          <div className={styles.topRow}>
            <span style={{ flexShrink: 0 }}>
              <IconButton
                icon="close-linear"
                label="Cancel and return to client selection"
                variant="glass"
                onClick={onExit}
              />
            </span>

            <div className={styles.topChips}>
              {/* Level meter — only rendered when we have a live roll reading. */}
              {showLiveCamera && roll !== null && tiltBand && (
                <div data-testid="level-indicator" className={`${styles.pill} ${styles.scrim}`}>
                  <span className={styles.dot} data-band={tiltBand} aria-hidden="true" />
                  {tiltBand === 'maintain' ? 'Level' : `Tilted ${roll > 0 ? 'right' : 'left'} ${Math.abs(roll).toFixed(1)}°`}
                </div>
              )}

              {started && (
                <div
                  data-testid="pose-readiness"
                  role={poseModelFailed ? 'alert' : 'status'}
                  aria-live="polite"
                  data-state={poseModelFailed ? 'failed' : poseReadiness.phase}
                  className={`${styles.pill} ${styles.scrim} ${styles.readiness}`}
                >
                  <span
                    className={styles.dot}
                    data-band={poseModelFailed ? 'review' : poseReadiness.phase === 'ready' ? 'maintain' : 'now'}
                    aria-hidden="true"
                  />
                  <span className={styles.readinessText} title={readinessLabel}>{readinessLabel}</span>
                  {poseModelFailed && (
                    <button
                      type="button"
                      onClick={() => void retryPoseModel()}
                      disabled={retryingModel}
                      className={styles.smallPill}
                    >{retryingModel ? 'Retrying…' : 'Retry Model'}</button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Directional prompt: the guidance pill — a ≥.6 black scrim behind
              text, never blur alone, so it stays legible over any frame. */}
          {showLiveCamera && (
            <div className={styles.guidance}>
              <div key={activeSlot} className={`${styles.prompt} ${styles.scrim}`}>
                <span className={styles.promptGlyph}><ViewSilhouette slot={activeSlot} size={28} /></span>
                <div style={{ minWidth: 0 }}>
                  <p className={`t-callout ${styles.promptTitle}`}>{direction.title}</p>
                  <p className="t-label" style={{ color: 'var(--ink-2)' }}>{direction.cue}</p>
                </div>
              </div>

              {level.pitchDeg !== null && Math.abs(level.pitchDeg) > 15 && (
                <div className={`${styles.pill} ${styles.scrim}`}>
                  <span className={styles.dot} data-band="monitor" aria-hidden="true" />
                  Aim the camera straight ahead
                </div>
              )}
              {notPortrait && (
                <div className={`${styles.pill} ${styles.scrim}`}>
                  <span className={styles.dot} data-band="monitor" aria-hidden="true" />
                  Hold the phone upright (portrait) to capture
                </div>
              )}
            </div>
          )}

          {/* Countdown overlay */}
          {phase === 'countdown' && countdown > 0 && (
            <div className={styles.countdown}>
              <span key={countdown} className={styles.countdownDigit}>{countdown}</span>
            </div>
          )}

          {/* ---------- Bottom controls ---------- */}
          <div className={styles.bottom}>
            {/* No-person note (blocks proceed on required views). */}
            {noPersonViews.length > 0 && (
              <div role="alert" className={`${styles.note} ${styles.scrim}`}>
                <span className={styles.dot} data-band="review" aria-hidden="true" />
                <div className={styles.noteBody}><p>No person detected — retake {noPersonViews.map(s => SLOT_LABEL[s]).join(', ')}</p></div>
              </div>
            )}
            {multiplePeopleViews.length > 0 && (
              <div role="alert" aria-label="More than one person detected" className={`${styles.note} ${styles.scrim}`}>
                <span className={styles.dot} data-band="review" aria-hidden="true" />
                <div className={styles.noteBody}><p>More than one person detected — use one full-body photo for {multiplePeopleViews.map(s => SLOT_LABEL[s]).join(', ')}</p></div>
              </div>
            )}
            {uploadError && (
              <div role="alert" className={`${styles.note} ${styles.scrim}`}>
                <span className={styles.dot} data-band="review" aria-hidden="true" />
                <div className={styles.noteBody}><p>{uploadError}</p></div>
              </div>
            )}

            {/* Shutter-gate coaching + override (tilt / centering / framing) */}
            {showLiveCamera && phase === 'live' && gateBlocked && gate.coach && (
              <div data-testid="tilt-blocked" id="tilt-blocked-banner" role="status" aria-live="polite" className={`${styles.note} ${styles.scrim}`} style={{ alignItems: 'center' }}>
                <span className={styles.dot} data-band="review" aria-hidden="true" style={{ marginTop: 0 }} />
                <div className={styles.noteBody}><p>{gate.coach}{gate.factors.tilt === 'blocked' ? ` — tilted ${Math.abs(roll ?? 0).toFixed(1)}°` : ''}</p></div>
                <button onClick={() => setOverrideGate(true)} className={styles.smallPill}>Capture anyway</button>
              </div>
            )}

            {/* Review actions */}
            {phase === 'review' && (
              <div className={styles.reviewBlock}>
                <div data-testid="review-quality-status" role="status" aria-live="polite" aria-atomic="true" className={styles.reviewStatus}>
                  {!previewQuality && !previewError && (
                    <p className={`${styles.pill} ${styles.scrim}`} style={{ margin: 0 }}><span className={styles.dot} data-band="now" aria-hidden="true" />Checking person and framing…</p>
                  )}
                  {previewQuality?.status === 'ok' && (
                    <p className={`${styles.pill} ${styles.scrim}`} style={{ margin: 0 }}><span className={styles.dot} data-band="maintain" aria-hidden="true" />Framing looks good</p>
                  )}
                  {previewQuality?.status === 'no_person' && (
                    <p className={`${styles.pill} ${styles.scrim}`} style={{ margin: 0 }}><span className={styles.dot} data-band="review" aria-hidden="true" />No person detected — retake</p>
                  )}
                  {previewQuality?.status === 'multiple_people' && (
                    <p className={`${styles.pill} ${styles.scrim}`} style={{ margin: 0 }}><span className={styles.dot} data-band="review" aria-hidden="true" />More than one person detected — retake</p>
                  )}
                  {previewQuality?.status === 'warnings' && previewQuality.warnings.length > 0 && (
                    <div className={`${styles.note} ${styles.scrim}`} style={{ alignSelf: 'stretch' }}>
                      <span className={styles.dot} data-band="monitor" aria-hidden="true" />
                      <div className={styles.noteBody}>
                        {previewQuality.warnings.map((w, i) => (
                          <p key={i}>{w}</p>
                        ))}
                      </div>
                    </div>
                  )}
                  {previewError && (
                    <div id="review-model-error" role="alert" data-testid="review-model-error" className={`${styles.note} ${styles.scrim}`} style={{ alignSelf: 'stretch', alignItems: 'center' }}>
                      <span className={styles.dot} data-band="review" aria-hidden="true" style={{ marginTop: 0 }} />
                      <div className={styles.noteBody}><p>{previewError}</p></div>
                      <button
                        type="button"
                        onClick={() => { setPreviewQuality(null); setPreviewError(null); setReviewAttempt(attempt => attempt + 1) }}
                        className={styles.smallPill}
                        style={{ minHeight: 44 }}
                      >Retry Check</button>
                    </div>
                  )}
                  {rollAtCapture !== null && Math.abs(rollAtCapture) > 2 && (
                    <p className={`${styles.pill} ${styles.scrim}`} style={{ margin: 0 }}><span className={styles.dot} data-band="monitor" aria-hidden="true" />Roll {rollAtCapture.toFixed(1)}° — will be corrected</p>
                  )}
                </div>
                <div className={styles.reviewActions}>
                  <button data-autofocus="retake" onClick={retakeStill} className="a-secondary" style={{ flex: 1, minHeight: 52 }}>Retake</button>
                  <button
                    onClick={useThisPhoto}
                    disabled={reviewAcceptDisabled}
                    aria-describedby={previewError ? 'review-model-error' : undefined}
                    className="a-primary"
                    style={{ flex: 2, minHeight: 52 }}
                  >{!previewQuality && !previewError ? 'Checking Photo…' : 'Use This Photo'}</button>
                </div>
              </div>
            )}

            {/* Status strip — four free-order slots, all selectable at any time */}
            <div className={styles.strip}>
              {SLOT_ORDER.map(slotKey => {
                const cap = captures[slotKey]
                const isActive = slotKey === activeSlot
                const captured = isCaptured(cap)
                const subjectCountBlocked = cap.slotStatus === 'no_person' || cap.slotStatus === 'multiple_people'
                const modelFailed = cap.slotStatus === 'model_error'
                const band = slotBand(cap)
                return (
                  <button
                    key={slotKey}
                    onClick={() => selectSlot(slotKey)}
                    // Locked from timed-shutter click through burst completion.
                    disabled={captureLocked}
                    aria-label={`${SLOT_LABEL[slotKey]} (required)${captured ? ' captured, tap to retake' : isActive ? ', current' : ', pending'}${cap.slotStatus === 'warnings' ? ' — quality warning' : ''}${modelFailed ? ' — model check failed' : ''}`}
                    aria-current={isActive ? 'step' : undefined}
                    className={styles.slot}
                    data-active={isActive ? 'true' : undefined}
                    data-band={!isActive && band ? band : undefined}
                    data-dim={captureLocked && !isActive ? 'true' : undefined}
                  >
                    <span className={styles.thumb}>
                      {captured && cap.displayPreviewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cap.displayPreviewUrl} alt={`${SLOT_LABEL[slotKey]} thumbnail`} />
                      ) : (
                        <ViewSilhouette slot={slotKey} size={26} />
                      )}
                      {captured && (
                        <span aria-hidden="true" className={styles.badge} data-band={band ?? undefined}>
                          {subjectCountBlocked || modelFailed ? '!' : cap.slotStatus === 'warnings' ? '!' : <Icon name="check-circle-bold" size={14} />}
                        </span>
                      )}
                    </span>
                    <span className={styles.slotLabel}>{SLOT_LABEL[slotKey].replace(' Side', '')}</span>
                  </button>
                )
              })}
            </div>

            {/* Committed-slot quality caption — soft coaching copy for a
                committed slot with quality warnings (upload path has no review
                phase of its own; camera captures land here too once committed).
                Suppressed during 'review' so it never doubles the review card's
                own warnings block above. The live region stays mounted (only its
                content is gated) so insertion is reliably announced — mirrors
                the review card's always-mounted status region. */}
            <div role="status" aria-live="polite" aria-atomic="true">
              {captionSlot && captionWarnings.length > 0 && (
                <div data-testid="slot-quality-caption" className={`${styles.note} ${styles.scrim}`}>
                  <span className={styles.dot} data-band="monitor" aria-hidden="true" />
                  <div className={styles.noteBody}>
                    {captionWarnings.map((w, i) => (
                      <p key={i}>
                        {i === 0 ? captionPrefix : ''}{w}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Shutter row (hidden during review / error / camera-failed) */}
            {showLiveCamera && (
              <div className={styles.shutterRow}>
                <div>
                  <button onClick={triggerUpload} disabled={captureLocked} className={`${styles.sideAction} ${styles.scrim}`}>{uploadingSlot ? `Preparing ${SLOT_LABEL[uploadingSlot]} photo…` : 'Upload photo instead'}</button>
                </div>
                <motion.button
                  data-autofocus="shutter"
                  onClick={onShutter}
                  disabled={gateBlocked || !ready || captureLocked}
                  aria-disabled={gateBlocked || !ready || captureLocked}
                  aria-label="Capture photo"
                  animate={shutterPulse}
                  initial={false}
                  whileTap={shutterReady ? { scale: 0.92 } : undefined}
                  transition={spring.press}
                  className={styles.shutter}
                  data-ready={shutterReady ? 'true' : undefined}
                  aria-describedby={gateBlocked ? 'tilt-blocked-banner' : undefined}
                />
                <div>
                  <button
                    onClick={() => { if (!captureBusyRef.current && !uploadBusyRef.current) setTimerOn(t => !t) }}
                    disabled={captureLocked}
                    aria-label="Self-timer"
                    aria-pressed={timerOn}
                    className={`${styles.timer} ${styles.scrim}`}
                  >
                    <Icon name="clock-circle-linear" size={16} />
                    {timerOn ? '3s' : 'Off'}
                  </button>
                </div>
              </div>
            )}

            {/* Upload fallback when the camera failed */}
            {cameraFailed && (
              <button onClick={triggerUpload} disabled={captureLocked} className="a-secondary a-secondary--bar">
                Use File Upload Instead — {SLOT_LABEL[activeSlot]}
              </button>
            )}

            {/* Proceed only after all four required views pass preflight. */}
            {requiredReady && phase !== 'review' && <CompleteCard allClear={allClear} />}
            {requiredReady && phase !== 'review' && (
              <button
                onClick={onProceed}
                disabled={analyzeBlocked}
                className="a-primary a-primary--bar"
                // Kept inline despite .a-primary:disabled setting the same
                // cursor: the capture characterization suite asserts this
                // property directly (FullScreenCapture.lifecycle.test.tsx),
                // and jsdom does not resolve stylesheet rules into .style.
                style={{ cursor: analyzeBlocked ? 'not-allowed' : 'pointer' }}
              >
                {submitting ? 'Submitting…' : captureLocked ? 'Capturing photo…' : requiredChecking ? 'Checking photos…' : requiredModelFailed ? 'Retry failed photo checks' : requiredSubjectFailed ? 'Retake invalid photos' : 'Analyze Posture'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** The scan's worst per-slot state, as a severity band for a dot/ring. */
function slotBand(cap: Captures[CaptureSlotKey]): SeverityBand | null {
  if (!isCaptured(cap)) return null
  if (cap.slotStatus === 'no_person' || cap.slotStatus === 'multiple_people' || cap.slotStatus === 'model_error') return 'review'
  if (cap.slotStatus === 'warnings') return 'monitor'
  if (cap.slotStatus === 'checking') return null
  return 'maintain'
}

/**
 * Scan complete (a signature moment): once all four views pass their checks,
 * the Lens blooms into a check beside the count — right above the one action.
 */
function CompleteCard({ allClear }: { allClear: boolean }) {
  return (
    <div className={`${styles.complete} ${styles.scrim}`}>
      <Lens size={44} state={allClear ? 'done' : 'loading'} />
      <div>
        <p className="t-callout" style={{ color: 'var(--ink-1)', fontWeight: 600 }}>
          {allClear ? 'All four views captured' : 'Four views captured'}
        </p>
        <p className="t-label">Your selected photos will be saved privately with this screening for later review.</p>
      </div>
    </div>
  )
}

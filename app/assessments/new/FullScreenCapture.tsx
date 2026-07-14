'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Landmark } from '@posture-ai/engine/types'
import type { FrameQuality } from '@/lib/pose/quality'
import { useCameraLevel } from '@/lib/capture/use-camera-level'
import { getCaptureRuntime } from '@/lib/pose/capture-runtime'
import { shutterGate } from '@/lib/capture/shutter-gate'
import { sourceToViewport } from '@/lib/capture/overlay-transform'
import type { Captures, CaptureSlotKey } from './types'
import { SLOT_ORDER, SLOT_LABEL, REQUIRED_SLOTS, slotToDomain, isCaptured } from './types'
import { CameraGlyph } from '@/components/SignalGlyphs'
import LiveGuides from './LiveGuides'

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

interface FullScreenCaptureProps {
  captures: Captures
  /** raw burst object URLs; [0] is the representative still. */
  onCameraCapture: (slot: CaptureSlotKey, burst: string[], captureRollDeg: number | null) => void
  onFileUpload: (slot: CaptureSlotKey, file: File) => void
  onProceed: () => void
  onExit: () => void
  modelError: boolean
  submitting: boolean
  uploadError: string | null
}

type Phase = 'disclaimer' | 'live' | 'countdown' | 'review'

// Directional prompt copy per slot (the two side slots cue opposite profiles).
const DIRECTION: Record<CaptureSlotKey, { title: string; cue: string }> = {
  'front': { title: 'Face the camera', cue: 'Stand tall, arms relaxed at your sides — Front View' },
  'side-left': { title: 'Left side to the camera', cue: 'Turn so your LEFT side faces the camera' },
  'side-right': { title: 'Right side to the camera', cue: 'Turn so your RIGHT side faces the camera' },
  'back': { title: 'Turn around', cue: 'Turn 180° so your back faces the camera — Back View' },
}

function getErrorMessage(err: unknown): string {
  if (err instanceof DOMException || (err && typeof err === 'object' && 'name' in err)) {
    const name = (err as { name: string }).name
    if (name === 'NotAllowedError') return 'Camera access denied. Please allow camera permission and try again.'
    if (name === 'NotFoundError') return 'No camera found on this device.'
    if (name === 'NotReadableError') return 'Camera is in use by another app.'
    if (name === 'SecurityError') return 'Camera requires a secure (HTTPS) connection.'
  }
  return 'Could not access the camera. Please try again.'
}

/**
 * Encode the current canvas as a JPEG blob object URL. Object URLs keep the
 * ~5-frame×4-slot burst out of React state as strings (base64 data URLs bloat
 * memory on mobile); callers revoke them on retake/replace/unmount.
 */
function canvasToObjectURL(canvas: HTMLCanvasElement): Promise<string | null> {
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : null), 'image/jpeg', 0.9)
  })
}

/** Lightweight silhouette / directional cue per slot (side-right is mirrored). */
function ViewSilhouette({ slot, size = 30 }: { slot: CaptureSlotKey; size?: number }) {
  const stroke = 'currentColor'
  const { view } = slotToDomain(slot)
  if (view === 'side') {
    // side-left faces one way; mirror the glyph for side-right.
    const flip = slot === 'side-right' ? { transform: 'scaleX(-1)', transformOrigin: 'center' } : undefined
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={flip}>
        <circle cx="10" cy="5" r="2.4" fill={stroke} />
        <path d="M10 8c2 0 3 1.4 3 3.4 0 2-.6 3-1 4.4l1 4.2" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 8c-.6 1.6-.8 3.2-1.4 4.6M8.6 12.6 7 21" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17 6.5a5 5 0 0 1 2.6 4.4" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" />
        <path d="m19.6 8.4 0 2.6-2.5-.4" stroke={stroke} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (view === 'back') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="5" r="2.4" fill={stroke} />
        <path d="M8.4 10c0-1.4 1.4-2.6 3.6-2.6S15.6 8.6 15.6 10l-.7 4h-5.8L8.4 10Z" fill={stroke} />
        <path d="M9.4 14 8.6 21M14.6 14l.8 7" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
        <path d="M4.5 4.6a7 7 0 0 1 0 3.4" stroke={stroke} strokeWidth="1.3" strokeLinecap="round" />
        <path d="m3.2 6.4 1.3 1.8 1.6-1.4" stroke={stroke} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  // front
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="5" r="2.4" fill={stroke} />
      <path d="M8.4 10c0-1.4 1.4-2.6 3.6-2.6S15.6 8.6 15.6 10l-.7 4h-5.8L8.4 10Z" fill={stroke} />
      <path d="M9.4 14 8.6 21M14.6 14l.8 7M8.7 10.4 6.6 13M15.3 10.4 17.4 13" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export default function FullScreenCapture({
  captures,
  onCameraCapture,
  onFileUpload,
  onProceed,
  onExit,
  modelError,
  submitting,
  uploadError,
}: FullScreenCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRefs = useRef<Record<CaptureSlotKey, HTMLInputElement | null>>({ 'front': null, 'side-left': null, 'side-right': null, 'back': null })
  // Guards async work in openStream from touching a torn-down component (e.g. the
  // user leaves while the camera-permission prompt is open).
  const mountedRef = useRef(true)
  // The shutter burst (object URLs) awaiting commit; the middle one is the review still.
  const burstRef = useRef<string[]>([])
  // The slot that owned the shutter at capture time. The burst commits to THIS
  // slot, not the live `activeSlot`, so a mid-flight slot change can never
  // mis-associate a capture. Free-order makes this race reachable.
  const captureSlotRef = useRef<CaptureSlotKey>('front')
  // Monotonic id stamped per shutter; carried onto the committed slot.
  const captureIdRef = useRef(0)
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

  const [activeSlot, setActiveSlot] = useState<CaptureSlotKey>('front')
  const [timerOn, setTimerOn] = useState(false)
  const [countdown, setCountdown] = useState(3)
  // True while a shutter burst is being grabbed — locks tile nav + the shutter so
  // the burst can't be re-targeted mid-flight.
  const [isCapturing, setIsCapturing] = useState(false)

  const [reviewUrl, setReviewUrl] = useState<string | null>(null)
  const [rollAtCapture, setRollAtCapture] = useState<number | null>(null)
  const [previewQuality, setPreviewQuality] = useState<FrameQuality | null>(null)

  // Live worker tracking: landmarks + the source frame's dims, set together each
  // tracked frame (null when the worker isn't tracking → sensor-only guides).
  const [liveFrame, setLiveFrame] = useState<{ landmarks: Record<string, Landmark>; videoDims: { w: number; h: number } } | null>(null)
  const [viewDims, setViewDims] = useState<{ w: number; h: number } | null>(null)
  const liveLandmarks = liveFrame?.landmarks ?? null

  const level = useCameraLevel()
  // "Capture anyway" override — bypasses ALL translation-only gates (§ frozen gate).
  const [overrideGate, setOverrideGate] = useState(false)

  const roll = level.rollDeg
  // Level-meter zones (design §4.1): green ≤2°, amber ≤5°, red >5°.
  const tiltZone: 'green' | 'amber' | 'red' | null =
    roll === null ? null : Math.abs(roll) <= 2 ? 'green' : Math.abs(roll) <= 5 ? 'amber' : 'red'

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

  const notPortrait =
    typeof screen !== 'undefined' && screen.orientation && !screen.orientation.type.startsWith('portrait')

  // ---- wake lock (best-effort; held for the whole live session) ----
  const acquireWakeLock = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator) || wakeLockRef.current) return
    try {
      const sentinel = await (navigator as Navigator & { wakeLock: { request(type: string): Promise<WakeLockSentinel> } }).wakeLock.request('screen')
      // Unmounted while the request was pending — release instead of leaking it.
      if (!mountedRef.current) { sentinel.release().catch(() => {}); return }
      wakeLockRef.current = sentinel
      sentinel.addEventListener?.('release', () => { wakeLockRef.current = null })
    } catch {
      // Wake lock is best-effort — silently ignore failures
    }
  }, [])

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [])

  // ---- camera lifecycle ----
  // No synchronous setState here (the first statement is the getUserMedia await),
  // so this is safe to call directly from the start effect. Phase/reset state is
  // driven by the gesture handlers (dismissDisclaimer / retryCamera).
  const openStream = useCallback(async () => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 720 }, height: { ideal: 960 }, aspectRatio: { ideal: 3 / 4 } },
      })
      // Component was torn down during the (possibly long) permission prompt —
      // stop the stream we just acquired instead of orphaning the hardware.
      if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setErrorMsg('Camera disconnected — restart or upload instead.')
        setCameraFailed(true)
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        // Fire-and-forget: don't gate readiness on play() resolving — a static
        // fake MediaStream (tests) never fully "plays", and real cameras stream
        // frames as soon as getUserMedia resolves.
        void videoRef.current.play().catch(() => { /* autoplay block is non-fatal */ })
      }
      setReady(true)
      void acquireWakeLock()
    } catch (err) {
      if (!mountedRef.current) return
      setErrorMsg(getErrorMessage(err))
      setCameraFailed(true)
    }
  }, [acquireWakeLock])

  // Stop the stream + release the wake lock on unmount. Camera start is driven
  // from the gesture handlers (dismissDisclaimer / retryCamera), not an effect,
  // so setState never runs synchronously inside an effect.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      releaseWakeLock()
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
      // Revoke any uncommitted burst object URLs (committed ones are owned by the
      // parent's captures state and outlive this overlay).
      burstRef.current.forEach(URL.revokeObjectURL)
      burstRef.current = []
      // Close the live VIDEO worker (the scoring IMAGE landmarker, if resident, is
      // the parent's to dispose after submit) — no worker outlives the overlay.
      void getCaptureRuntime().closeLive()
    }
  }, [releaseWakeLock])

  function retryCamera() {
    setReady(false)
    setCameraFailed(false)
    setErrorMsg(null)
    setPhase('live')
    void openStream()
  }

  // Re-acquire the wake lock when the tab becomes visible again; close the live
  // worker when the tab is hidden so no GPU runtime lingers in the background.
  useEffect(() => {
    function onVisible() {
      // Hidden: close whichever backend is open (worker while live, IMAGE while
      // reviewing) so no GPU runtime lingers backgrounded. On restore, the live
      // tracking loop self-heals (re-enters live) when still framing.
      if (document.visibilityState === 'hidden') { void getCaptureRuntime().dispose(); return }
      if (started && !cameraFailed) void acquireWakeLock()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [started, cameraFailed, acquireWakeLock])

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
      if (video && video.videoWidth > 0 && ready && typeof createImageBitmap === 'function'
        && now - lastFrameTsRef.current >= LIVE_FRAME_INTERVAL_MS) {
        lastFrameTsRef.current = now
        // Self-heal: a fire-and-forget preflight (or a visibility-hidden close)
        // may have left the runtime out of live-video for this view — re-enter.
        if (runtime.state() !== 'live-video') void runtime.enterLive()
        const videoDims = { w: video.videoWidth, h: video.videoHeight }
        const currentTime = video.currentTime
        createImageBitmap(video)
          .then(bitmap => {
            // Drop a stale bitmap (view changed / effect stopped while decoding)
            // rather than spending inference on the old view.
            if (stopped || liveGenRef.current !== gen) { bitmap.close?.(); return null }
            return runtime.frameLive(bitmap, { generation: gen, timestampMs: now, currentTime })
          })
          .then(res => {
            if (stopped || liveGenRef.current !== gen) return
            if (res) {
              // A real inference result (landmarks may be empty = no person).
              setLiveFrame({ landmarks: res.landmarks, videoDims })
              lastResultTsRef.current = performance.now()
            } else if (performance.now() - lastResultTsRef.current > LIVE_FRESHNESS_MS) {
              // No fresh result for a while → tracking genuinely lost; clear.
              setLiveFrame(null)
            }
            // else: a routine dropped/in-flight frame → sample-and-hold the pose.
          })
          .catch(() => { /* frame skipped */ })
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    // Clear tracking when leaving live/countdown (→ review) or changing view so a
    // prior view's landmarks never linger in the gate or overlay.
    return () => { stopped = true; cancelAnimationFrame(raf); setLiveFrame(null) }
  }, [phase, activeSlot, cameraFailed, ready])

  // Focus management: this overlay covers the whole viewport, so move focus to
  // the primary control of each phase and keep Tab within the overlay.
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const sel = phase === 'disclaimer' ? '[data-testid="capture-disclaimer-dismiss"]'
      : phase === 'review' ? '[data-autofocus="retake"]'
      : '[data-autofocus="shutter"]'
    ;(root.querySelector<HTMLElement>(sel) ?? root).focus()
  }, [phase])

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
    void openStream()
  }

  // ---- capture ----
  // Grab a short burst of distinct live frames (not one still): a held pose over
  // ~300ms yields the landmark jitter the engine turns into within-capture
  // stability. All frames are stashed; the middle one is shown for review.
  const capture = useCallback(async () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth || 720
    canvas.height = video.videoHeight || 960
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Freeze this capture's identity + commit target at the shutter instant, and
    // lock the UI so a mid-burst tile tap can neither re-target nor race it.
    const id = ++captureIdRef.current
    captureSlotRef.current = activeSlot
    setIsCapturing(true)
    const rollAt = level.rollRef.current // roll at the shutter instant
    const urls: string[] = []
    // Discard partial work: revoke every object URL grabbed so far + unlock.
    const bail = () => { urls.forEach(URL.revokeObjectURL); if (mountedRef.current) { setIsCapturing(false); setPhase('live') } }
    for (let i = 0; i < BURST_SIZE; i++) {
      // Superseded (retake/unmount) or tilted into the red zone (>5°) partway
      // through — discard the partial burst rather than feeding the engine frames
      // the shutter itself would have blocked (unless the user overrode the gate).
      if (!mountedRef.current || captureIdRef.current !== id) { bail(); return }
      if (!overrideGate && Math.abs(level.rollRef.current ?? 0) > 5) { bail(); return }
      ctx.drawImage(video, 0, 0)
      const url = await canvasToObjectURL(canvas)
      if (url) urls.push(url)
      if (i < BURST_SIZE - 1) await new Promise(r => setTimeout(r, BURST_INTERVAL_MS))
    }
    if (!mountedRef.current || captureIdRef.current !== id) { bail(); return }
    // Put the reviewed (middle) frame first so the preview thumbnail AND the
    // quality preflight — both of which the parent runs on burst[0] — judge
    // exactly the frame the user reviews and approves. The engine medians every
    // frame at submit, so array order is irrelevant to within-capture stability.
    const mid = Math.floor(urls.length / 2)
    const representative = urls[mid]
    burstRef.current = [representative, ...urls.slice(0, mid), ...urls.slice(mid + 1)]
    setRollAtCapture(rollAt)
    setPreviewQuality(null)
    setReviewUrl(representative) // representative still (now burst[0])
    setIsCapturing(false)
    setPhase('review')
    // Stream keeps running so the next view is instant — the frozen still is
    // shown as an overlay during review.
  }, [level.rollRef, overrideGate, activeSlot])

  function startCountdown() {
    void acquireWakeLock()
    setCountdown(3)
    setPhase('countdown')
  }

  function onShutter() {
    if (gateBlocked || !ready || isCapturing) return
    if (timerOn) startCountdown()
    else void capture()
  }

  // Countdown driver — re-checks the shutter gate at the capture instant.
  useEffect(() => {
    if (phase !== 'countdown') return
    if (countdown <= 0) {
      if (gateBlocked) {
        const abort = setTimeout(() => { setPhase('live'); setCountdown(3) }, 0)
        return () => clearTimeout(abort)
      }
      void capture()
      return
    }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [phase, countdown, capture, gateBlocked])

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
        const frame = await getCaptureRuntime().detect(reviewUrl, view, 'camera')
        if (!cancelled) setPreviewQuality(assessFrameQuality(frame, view))
      } catch {
        // non-fatal: the slot preflight still runs after "Use This Photo"
      }
    })()
    return () => { cancelled = true }
  }, [phase, reviewUrl, activeSlot])

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
    if (!reviewUrl) return
    // Commit to the slot that owned the shutter, never the (possibly changed)
    // live `activeSlot` — the burst belongs to captureSlotRef.
    const committed = captureSlotRef.current
    const burst = burstRef.current.length > 0 ? burstRef.current : [reviewUrl]
    onCameraCapture(committed, burst, rollAtCapture)
    burstRef.current = [] // ownership transferred to the parent; do not revoke
    setReviewUrl(null)
    setPreviewQuality(null)
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
  }

  function retakeStill() {
    discardBurst()
    setReviewUrl(null)
    setPreviewQuality(null)
    setRollAtCapture(null)
    setOverrideGate(false)
    setPhase('live')
  }

  function selectSlot(slot: CaptureSlotKey) {
    // Free order: any slot is selectable at any time — EXCEPT mid-burst, where a
    // switch would race the in-flight capture (the burst is locked until it
    // resolves). Switching away from an unreviewed shot discards it.
    if (isCapturing) return
    // A new view must earn its own "capture anyway" — override never carries over.
    setOverrideGate(false)
    setActiveSlot(slot)
    if (phase === 'review') retakeStill()
  }

  function triggerUpload() {
    fileInputRefs.current[activeSlot]?.click()
  }

  // Uploading a slot commits it and advances to the next uncaptured slot, so the
  // upload-only path (no camera) still walks through every required slot.
  function handleUpload(slot: CaptureSlotKey, file: File) {
    onFileUpload(slot, file)
    const next = nextUncapturedAfter(slot)
    if (next) { setOverrideGate(false); setActiveSlot(next) }
  }

  // ---- derived UI state ----
  // Ready once front + both sides are present (back optional), independent of
  // capture order — the free-order flow has no terminal "last view" trigger.
  const requiredReady = REQUIRED_SLOTS.every(s => isCaptured(captures[s]))
  // A required slot whose quality preflight is still running — proceeding now
  // would bypass the no-person block, so gate the Analyze action until it settles.
  const requiredChecking = REQUIRED_SLOTS.some(s => isCaptured(captures[s]) && captures[s].slotStatus === 'checking')
  const noPersonViews = SLOT_ORDER.filter(s => isCaptured(captures[s]) && captures[s].slotStatus === 'no_person')
  const direction = DIRECTION[activeSlot]

  const showLiveCamera = (phase === 'live' || phase === 'countdown') && !cameraFailed
  const pad = 'max(12px, env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px)) max(12px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px))'

  return (
    <div ref={containerRef} tabIndex={-1} aria-label="Posture capture" style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 200, display: 'flex', flexDirection: 'column', color: 'var(--text-primary)', overflow: 'hidden', padding: pad, outline: 'none' }} data-testid="fullscreen-capture">
      {/* sr-only assertive announcer for the self-timer countdown (must be
          always-mounted so the live region announces changes) */}
      <div role="timer" aria-live="assertive" aria-atomic="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
        {phase === 'countdown' && countdown > 0 ? `Capturing in ${countdown}` : ''}
      </div>
      {/* Hidden per-slot file inputs — DOM order is front, side-left, side-right,
          back (e2e targets input[type=file] by index). */}
      {SLOT_ORDER.map(slot => (
        <input
          key={slot}
          ref={el => { fileInputRefs.current[slot] = el }}
          type="file"
          accept="image/jpeg,image/png"
          style={{ display: 'none' }}
          aria-label={`Upload ${SLOT_LABEL[slot]} photo`}
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) handleUpload(slot, file)
            e.target.value = ''
          }}
        />
      ))}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* ---------- Disclaimer (first open only) ---------- */}
      {phase === 'disclaimer' ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div role="dialog" aria-modal="true" aria-labelledby="capture-disclaimer-title" data-testid="capture-disclaimer" style={{ maxWidth: '420px', background: '#0F0F11', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '20px', padding: '24px' }}>
            <p id="capture-disclaimer-title" style={{ color: 'var(--brand)', fontWeight: 700, fontSize: '0.95rem', margin: '0 0 10px' }}>Screening Tool Only</p>
            <p style={{ color: '#B4B4BD', fontSize: '0.85rem', lineHeight: 1.6, margin: '0 0 20px' }}>
              Posture AI is a screening tool. Results are for informational purposes only and are not a
              substitute for evaluation by a qualified professional. Consult a qualified health professional
              before making any clinical decisions.
            </p>
            <button
              data-testid="capture-disclaimer-dismiss"
              onClick={dismissDisclaimer}
              style={{ width: '100%', padding: '14px', borderRadius: '12px', background: 'var(--brand-strong)', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer', minHeight: '44px' }}
            >
              Start Capture
            </button>
            <button
              onClick={onExit}
              style={{ width: '100%', marginTop: '10px', padding: '10px', borderRadius: '10px', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.12)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', minHeight: '44px' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ---------- Camera stage ---------- */}
          <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
            {/* Live video (kept mounted so the stream never restarts between views) */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: showLiveCamera ? 'block' : 'none' }}
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
              <img src={reviewUrl} alt="Captured frame" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            )}

            {/* Camera-unavailable panel — non-blocking: the upload fallback and
                proceed controls below stay usable (they render above this stage). */}
            {cameraFailed && (
              <div role="alert" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center', gap: '12px' }}>
                <span style={{ color: 'var(--text-secondary)' }}><CameraGlyph size={38} /></span>
                <p style={{ color: 'var(--danger)', fontWeight: 700, margin: 0 }}>Camera Unavailable</p>
                <p data-testid="camera-error-msg" style={{ color: '#C4C4CC', fontSize: '0.875rem', margin: 0, maxWidth: '320px' }}>{errorMsg}</p>
                <button onClick={retryCamera} style={{ padding: '10px 20px', borderRadius: '10px', background: 'var(--brand-strong)', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer', minHeight: '44px' }}>Try Again</button>
              </div>
            )}
          </div>

          {/* ---------- Top overlays ---------- */}
          <div style={{ position: 'relative', zIndex: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', pointerEvents: 'none' }}>
            <button
              onClick={onExit}
              aria-label="Cancel and return to client selection"
              style={{ pointerEvents: 'auto', width: '44px', height: '44px', borderRadius: '50%', background: 'rgba(0,0,0,0.5)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', fontSize: '1.4rem', cursor: 'pointer', flexShrink: 0 }}
            ><span aria-hidden="true">×</span></button>

            {/* Level meter — only rendered when we have a live roll reading. */}
            {showLiveCamera && roll !== null && (
              <div data-testid="level-indicator" style={{
                pointerEvents: 'auto', borderRadius: '999px', padding: '6px 12px', fontSize: '0.75rem', fontWeight: 700, color: '#fff',
                background: tiltZone === 'green' ? 'rgba(16,185,129,0.92)' : tiltZone === 'amber' ? 'rgba(255,137,24,0.92)' : 'rgba(239,68,68,0.92)',
              }}>
                {tiltZone === 'green' ? 'Level' : `Tilted ${roll > 0 ? 'right' : 'left'} ${Math.abs(roll).toFixed(1)}°`}
              </div>
            )}

            {modelError && (
              <div role="status" aria-live="polite" style={{ pointerEvents: 'auto', borderRadius: '999px', padding: '6px 12px', fontSize: '0.72rem', fontWeight: 600, background: 'rgba(239,68,68,0.85)', color: '#fff' }}>
                Pose engine unavailable
              </div>
            )}
          </div>

          {/* Directional prompt + soft warnings (only on the live view) */}
          {showLiveCamera && (
            <div style={{ position: 'relative', zIndex: 2, marginTop: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', pointerEvents: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(0,0,0,0.5)', borderRadius: '999px', padding: '8px 16px', maxWidth: '92%' }}>
                <span style={{ color: '#fff', flexShrink: 0 }}><ViewSilhouette slot={activeSlot} /></span>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: '0.95rem', color: '#fff' }}>{direction.title}</p>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{direction.cue}</p>
                </div>
              </div>

              {level.pitchDeg !== null && Math.abs(level.pitchDeg) > 15 && (
                <div style={{ background: 'rgba(255,137,24,0.9)', borderRadius: '999px', padding: '5px 12px', fontSize: '0.72rem', fontWeight: 600, color: '#fff' }}>
                  Aim the camera straight ahead
                </div>
              )}
              {notPortrait && (
                <div style={{ background: 'rgba(255,137,24,0.9)', borderRadius: '999px', padding: '5px 12px', fontSize: '0.72rem', fontWeight: 700, color: '#fff' }}>
                  Hold the phone upright (portrait) to capture
                </div>
              )}
            </div>
          )}

          {/* Countdown overlay */}
          {phase === 'countdown' && countdown > 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', zIndex: 3, pointerEvents: 'none' }}>
              <span style={{ fontSize: '6rem', fontWeight: 900, color: '#fff', lineHeight: 1 }}>{countdown}</span>
            </div>
          )}

          {/* ---------- Bottom controls ---------- */}
          <div style={{ position: 'relative', zIndex: 2, marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* No-person banner (blocks proceed on required views) */}
            {noPersonViews.length > 0 && (
              <div role="alert" style={{ background: 'rgba(239,68,68,0.9)', borderRadius: '10px', padding: '8px 14px', fontSize: '0.8rem', fontWeight: 700, color: '#fff', textAlign: 'center' }}>
                No person detected — retake {noPersonViews.map(s => SLOT_LABEL[s]).join(', ')}
              </div>
            )}
            {uploadError && (
              <div role="alert" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', padding: '8px 14px', fontSize: '0.8rem', color: 'var(--danger)', textAlign: 'center' }}>
                {uploadError}
              </div>
            )}

            {/* Shutter-gate coaching banner + override (tilt / centering / framing) */}
            {showLiveCamera && phase === 'live' && gateBlocked && gate.coach && (
              <div data-testid="tilt-blocked" id="tilt-blocked-banner" role="status" aria-live="polite" style={{
                background: 'rgba(239,68,68,0.14)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 10, padding: '10px 14px',
                fontSize: '0.82rem', color: 'var(--danger)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
              }}>
                <span>{gate.coach}{gate.factors.tilt === 'blocked' ? ` — tilted ${Math.abs(roll ?? 0).toFixed(1)}°` : ''}</span>
                <button onClick={() => setOverrideGate(true)} style={{ background: 'none', border: '1px solid rgba(239,68,68,0.5)', borderRadius: 6, color: 'var(--danger)', fontSize: '0.75rem', fontWeight: 600, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Capture anyway</button>
              </div>
            )}

            {/* Review actions */}
            {phase === 'review' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div role="status" aria-live="polite" aria-atomic="true">
                  {previewQuality?.status === 'ok' && (
                    <p style={{ color: 'var(--maintain)', fontSize: '0.8rem', textAlign: 'center', margin: 0, fontWeight: 600 }}>Framing looks good</p>
                  )}
                  {previewQuality?.status === 'no_person' && (
                    <p style={{ color: 'var(--danger)', fontSize: '0.82rem', textAlign: 'center', margin: 0, fontWeight: 700 }}>No person detected — retake</p>
                  )}
                  {previewQuality?.status === 'warnings' && previewQuality.warnings.length > 0 && (
                    <div style={{ background: 'rgba(255,137,24,0.12)', border: '1px solid rgba(255,137,24,0.3)', borderRadius: 8, padding: '8px 12px' }}>
                      {previewQuality.warnings.map((w, i) => (
                        <p key={i} style={{ color: '#FBBF24', fontSize: '0.75rem', margin: i > 0 ? '4px 0 0' : 0 }}>• {w}</p>
                      ))}
                    </div>
                  )}
                  {rollAtCapture !== null && Math.abs(rollAtCapture) > 2 && (
                    <p style={{ color: '#FBBF24', fontSize: '0.72rem', textAlign: 'center', margin: 0 }}>Roll {rollAtCapture.toFixed(1)}° — will be corrected</p>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button data-autofocus="retake" onClick={retakeStill} style={{ flex: 1, padding: '14px', borderRadius: '12px', background: 'rgba(255,255,255,0.08)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.15)', fontWeight: 600, cursor: 'pointer', minHeight: '44px' }}>Retake</button>
                  <button onClick={useThisPhoto} style={{ flex: 2, padding: '14px', borderRadius: '12px', background: 'var(--brand-strong)', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer', minHeight: '44px' }}>Use This Photo</button>
                </div>
              </div>
            )}

            {/* Status strip — four free-order slots, all selectable at any time */}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              {SLOT_ORDER.map(slotKey => {
                const cap = captures[slotKey]
                const isActive = slotKey === activeSlot
                const captured = isCaptured(cap)
                const optional = !REQUIRED_SLOTS.includes(slotKey)
                const ring = isActive ? 'var(--brand)'
                  : cap.slotStatus === 'no_person' ? 'var(--danger)'
                  : cap.slotStatus === 'warnings' ? 'var(--warning)'
                  : captured ? '#10B981'
                  : 'rgba(255,255,255,0.2)'
                return (
                  <button
                    key={slotKey}
                    onClick={() => selectSlot(slotKey)}
                    // Locked during a burst so the announced state matches selectSlot's guard.
                    disabled={isCapturing}
                    aria-label={`${SLOT_LABEL[slotKey]}${optional ? ' (optional)' : ''}${captured ? ' captured, tap to retake' : isActive ? ', current' : ', pending'}`}
                    aria-current={isActive ? 'step' : undefined}
                    style={{
                      position: 'relative', width: '58px', textAlign: 'center', background: 'none', border: 'none',
                      padding: 0, cursor: isCapturing ? 'default' : 'pointer', opacity: isCapturing && !isActive ? 0.6 : 1,
                    }}
                  >
                    <div style={{ position: 'relative', width: '50px', height: '50px', margin: '0 auto', borderRadius: '10px', overflow: 'hidden', border: `2px solid ${ring}`, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {captured && cap.displayPreviewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cap.displayPreviewUrl} alt={`${SLOT_LABEL[slotKey]} thumbnail`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ color: isActive ? '#fff' : '#B4B4BD' }}><ViewSilhouette slot={slotKey} size={24} /></span>
                      )}
                      {captured && (
                        <span aria-hidden="true" style={{ position: 'absolute', bottom: 2, right: 2, width: '16px', height: '16px', borderRadius: '50%', background: cap.slotStatus === 'no_person' ? 'var(--danger)' : '#10B981', color: '#fff', fontSize: '0.6rem', fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{cap.slotStatus === 'no_person' ? '!' : '✓'}</span>
                      )}
                    </div>
                    <span style={{ display: 'block', fontSize: '0.64rem', fontWeight: 600, color: isActive ? '#C7D2FE' : '#C4C4CC', marginTop: '4px' }}>{SLOT_LABEL[slotKey]}</span>
                    <span style={{ display: 'block', fontSize: '0.6rem', color: '#B4B4BD' }}>{optional ? 'Optional' : 'Required'}</span>
                  </button>
                )
              })}
            </div>

            {/* Shutter row (hidden during review / error / camera-failed) */}
            {showLiveCamera && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: '8px' }}>
                <div style={{ justifySelf: 'start' }}>
                  <button onClick={triggerUpload} style={{ background: 'none', border: 'none', color: '#C4C4CC', fontSize: '0.78rem', fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', padding: '8px', minHeight: '44px' }}>Upload photo instead</button>
                </div>
                <button
                  data-autofocus="shutter"
                  onClick={onShutter}
                  aria-disabled={gateBlocked || !ready || isCapturing}
                  aria-label="Capture photo"
                  style={{
                    justifySelf: 'center', width: '72px', height: '72px', borderRadius: '50%',
                    background: gateBlocked || !ready || isCapturing ? 'rgba(255,255,255,0.25)' : '#fff',
                    border: '4px solid rgba(255,255,255,0.55)', boxShadow: '0 0 0 2px rgba(0,0,0,0.4)',
                    cursor: gateBlocked || !ready || isCapturing ? 'not-allowed' : 'pointer',
                  }}
                  aria-describedby={gateBlocked ? 'tilt-blocked-banner' : undefined}
                />
                <div style={{ justifySelf: 'end' }}>
                  <button
                    onClick={() => setTimerOn(t => !t)}
                    aria-label="Self-timer"
                    aria-pressed={timerOn}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '5px', padding: '8px 12px', borderRadius: '999px', minHeight: '44px',
                      background: timerOn ? 'rgba(0,152,243,0.25)' : 'rgba(255,255,255,0.08)',
                      border: `1px solid ${timerOn ? 'rgba(0,152,243,0.6)' : 'rgba(255,255,255,0.15)'}`,
                      color: timerOn ? '#C7D2FE' : '#C4C4CC', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="13" r="8" stroke="currentColor" strokeWidth="2" /><path d="M12 13V9M9 2h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    {timerOn ? '3s' : 'Off'}
                  </button>
                </div>
              </div>
            )}

            {/* Upload fallback when the camera failed */}
            {cameraFailed && (
              <button onClick={triggerUpload} style={{ padding: '14px', borderRadius: '12px', background: 'rgba(255,255,255,0.1)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.2)', fontWeight: 700, cursor: 'pointer', minHeight: '44px' }}>
                Use File Upload Instead — {SLOT_LABEL[activeSlot]}
              </button>
            )}

            {/* Proceed (available once Front + both Sides are captured; Back-skip) */}
            {requiredReady && phase !== 'review' && (
              <button
                onClick={onProceed}
                disabled={submitting || requiredChecking}
                style={{ padding: '14px', borderRadius: '12px', background: submitting || requiredChecking ? 'rgba(0,152,243,0.4)' : 'var(--brand-strong)', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.95rem', cursor: submitting || requiredChecking ? 'not-allowed' : 'pointer', minHeight: '44px' }}
              >
                {submitting ? 'Submitting…' : requiredChecking ? 'Checking photos…' : isCaptured(captures.back) ? 'Analyze Posture' : 'Skip Back & Analyze Posture'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

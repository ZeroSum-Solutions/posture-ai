'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FrameQuality } from '@/lib/pose/quality'
import { useCameraLevel } from '@/lib/capture/use-camera-level'
import type { Captures, ViewKey } from './types'
import { VIEW_ORDER, VIEW_LABEL } from './types'
import { CameraGlyph } from '@/components/SignalGlyphs'

// Frames grabbed in the shutter burst (engine 1.3.0 within-capture stability).
// A ~5-frame burst of a held pose is enough to estimate landmark jitter without
// a perceptible capture delay.
const BURST_SIZE = 5
const BURST_INTERVAL_MS = 70

interface FullScreenCaptureProps {
  captures: Captures
  /** dataUrls is the shutter burst; [0] is the representative still for preview. */
  onCameraCapture: (view: ViewKey, dataUrls: string[], captureRollDeg: number | null) => void
  onFileUpload: (view: ViewKey, file: File) => void
  onProceed: () => void
  onExit: () => void
  modelLoading: boolean
  modelError: boolean
  submitting: boolean
  uploadError: string | null
}

type Phase = 'disclaimer' | 'live' | 'countdown' | 'review'

// Directional prompt copy per view (replaces the old per-card labels).
const DIRECTION: Record<ViewKey, { title: string; cue: string }> = {
  front: { title: 'Face the camera', cue: 'Stand tall, arms relaxed at your sides — Front View' },
  side: { title: 'Turn to your side', cue: 'Turn 90° so your profile faces the camera — Side View' },
  back: { title: 'Turn around', cue: 'Turn 180° so your back faces the camera — Back View' },
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

/** Lightweight silhouette / directional cue per view. */
function ViewSilhouette({ view, size = 30 }: { view: ViewKey; size?: number }) {
  const stroke = 'currentColor'
  if (view === 'side') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
  modelLoading,
  modelError,
  submitting,
  uploadError,
}: FullScreenCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRefs = useRef<Record<ViewKey, HTMLInputElement | null>>({ front: null, side: null, back: null })
  // Set when the final view is committed: proceed only AFTER that commit has
  // flushed into the parent's `captures` (else validateAndProceed reads a stale
  // snapshot and drops the just-captured frame).
  const proceedAfterCommitRef = useRef(false)
  // Guards async work in openStream from touching a torn-down component (e.g. the
  // user leaves while the camera-permission prompt is open).
  const mountedRef = useRef(true)
  // The shutter burst (dataUrls) awaiting commit; the middle one is the review still.
  const burstRef = useRef<string[]>([])

  const [phase, setPhase] = useState<Phase>('disclaimer')
  const [started, setStarted] = useState(false)
  const [ready, setReady] = useState(false)
  const [cameraFailed, setCameraFailed] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [activeView, setActiveView] = useState<ViewKey>('front')
  const [timerOn, setTimerOn] = useState(false)
  const [countdown, setCountdown] = useState(3)

  const [reviewUrl, setReviewUrl] = useState<string | null>(null)
  const [rollAtCapture, setRollAtCapture] = useState<number | null>(null)
  const [previewQuality, setPreviewQuality] = useState<FrameQuality | null>(null)

  const level = useCameraLevel()
  const [overrideTilt, setOverrideTilt] = useState(false)

  const roll = level.rollDeg
  // Gate thresholds (design §4.1): green ≤2°, amber ≤5° (allowed, corrected),
  // red >5° (blocked, manual override available).
  const tiltZone: 'green' | 'amber' | 'red' | null =
    roll === null ? null : Math.abs(roll) <= 2 ? 'green' : Math.abs(roll) <= 5 ? 'amber' : 'red'
  const tiltBlocked = tiltZone === 'red' && !overrideTilt

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
    }
  }, [releaseWakeLock])

  function retryCamera() {
    setReady(false)
    setCameraFailed(false)
    setErrorMsg(null)
    setPhase('live')
    void openStream()
  }

  // Re-acquire the wake lock when the tab becomes visible again.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && started && !cameraFailed) void acquireWakeLock()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [started, cameraFailed, acquireWakeLock])

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
    const rollAt = level.rollRef.current // roll at the shutter instant
    const urls: string[] = []
    for (let i = 0; i < BURST_SIZE; i++) {
      // Abort if the phone tilts into the red zone (>5°) partway through the
      // burst — unless the user overrode the tilt gate. Without this a burst
      // straddling a tilt would feed the engine frames the shutter itself would
      // have blocked. Partial frames are discarded (burstRef untouched).
      if (!overrideTilt && Math.abs(level.rollRef.current ?? 0) > 5) {
        if (mountedRef.current) setPhase('live')
        return
      }
      ctx.drawImage(video, 0, 0)
      urls.push(canvas.toDataURL('image/jpeg', 0.9))
      if (i < BURST_SIZE - 1) await new Promise(r => setTimeout(r, BURST_INTERVAL_MS))
    }
    if (!mountedRef.current) return
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
    setPhase('review')
    // Stream keeps running so the next view is instant — the frozen still is
    // shown as an overlay during review.
  }, [level.rollRef, overrideTilt])

  function startCountdown() {
    void acquireWakeLock()
    setCountdown(3)
    setPhase('countdown')
  }

  function onShutter() {
    if (tiltBlocked || !ready) return
    if (timerOn) startCountdown()
    else void capture()
  }

  // Countdown driver — re-checks the tilt gate at the shutter instant.
  useEffect(() => {
    if (phase !== 'countdown') return
    if (countdown <= 0) {
      if (tiltBlocked) {
        const abort = setTimeout(() => { setPhase('live'); setCountdown(3) }, 0)
        return () => clearTimeout(abort)
      }
      void capture()
      return
    }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [phase, countdown, capture, tiltBlocked])

  // Best-effort framing feedback on the captured still, so the user can retake
  // before committing. The wizard's preflight remains authoritative.
  useEffect(() => {
    if (phase !== 'review' || !reviewUrl) return
    let cancelled = false
    void (async () => {
      try {
        const { detectPose } = await import('@/lib/pose/detect')
        const { assessFrameQuality } = await import('@/lib/pose/quality')
        const frame = await detectPose(reviewUrl, activeView, 'camera')
        if (!cancelled) setPreviewQuality(assessFrameQuality(frame, activeView))
      } catch {
        // non-fatal: the slot preflight still runs after "Use This Photo"
      }
    })()
    return () => { cancelled = true }
  }, [phase, reviewUrl, activeView])

  // Deferred auto-proceed: fires onProceed once the terminal (Back) commit has
  // landed in `captures` AND the required views' preflight has settled — so the
  // Back frame is included and a still-`checking` no-person Front/Side can't slip
  // past validateAndProceed's block. Mutates a ref (not state) → no setState-in-effect.
  useEffect(() => {
    if (!proceedAfterCommitRef.current) return
    const stillChecking = (['front', 'side'] as ViewKey[]).some(v => !!captures[v].preview && captures[v].slotStatus === 'checking')
    if (stillChecking) return
    proceedAfterCommitRef.current = false
    onProceed()
  }, [captures, onProceed])

  function nextUncapturedAfter(committed: ViewKey): ViewKey | null {
    const start = VIEW_ORDER.indexOf(committed)
    for (let i = start + 1; i < VIEW_ORDER.length; i++) {
      const v = VIEW_ORDER[i]
      if (v !== committed && !captures[v].preview) return v
    }
    return null
  }

  function useThisPhoto() {
    if (!reviewUrl) return
    const committed = activeView
    const burst = burstRef.current.length > 0 ? burstRef.current : [reviewUrl]
    onCameraCapture(committed, burst, rollAtCapture)
    burstRef.current = []
    setReviewUrl(null)
    setPreviewQuality(null)
    setRollAtCapture(null)
    setOverrideTilt(false)
    const next = nextUncapturedAfter(committed)
    if (next) setActiveView(next)
    setPhase('live')
    // Only the terminal forward step (committing Back) auto-advances to
    // Processing — and only AFTER this commit has flushed into `captures` (see
    // the deferred-proceed effect), so validateAndProceed includes the Back
    // frame. Retaking front/side never auto-proceeds (its preflight may still be
    // in-flight; the user proceeds explicitly via the Analyze button instead).
    if (!next && committed === 'back') proceedAfterCommitRef.current = true
  }

  function retakeStill() {
    burstRef.current = []
    setReviewUrl(null)
    setPreviewQuality(null)
    setRollAtCapture(null)
    setOverrideTilt(false)
    setPhase('live')
  }

  function selectView(view: ViewKey) {
    // Only captured views (retake) or the current active view are selectable.
    if (view !== activeView && !captures[view].preview) return
    setActiveView(view)
    if (phase === 'review') retakeStill()
  }

  function triggerUpload() {
    fileInputRefs.current[activeView]?.click()
  }

  // Uploading a view commits it and advances to the next uncaptured one — the
  // camera path auto-advances on capture, and the upload fallback must match or
  // the user gets stuck (pending views aren't selectable in the status strip).
  function handleUpload(view: ViewKey, file: File) {
    onFileUpload(view, file)
    const next = nextUncapturedAfter(view)
    if (next) setActiveView(next)
  }

  // ---- derived UI state ----
  const frontSideReady = !!captures.front.preview && !!captures.side.preview
  // A required view whose quality preflight is still running — proceeding now
  // would bypass the no-person block, so gate the Analyze action until it settles.
  const requiredChecking = (['front', 'side'] as ViewKey[]).some(v => !!captures[v].preview && captures[v].slotStatus === 'checking')
  const noPersonViews = VIEW_ORDER.filter(v => captures[v].preview && captures[v].slotStatus === 'no_person')
  const direction = DIRECTION[activeView]

  const showLiveCamera = (phase === 'live' || phase === 'countdown') && !cameraFailed
  const pad = 'max(12px, env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px)) max(12px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px))'

  return (
    <div ref={containerRef} tabIndex={-1} aria-label="Posture capture" style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 200, display: 'flex', flexDirection: 'column', color: 'var(--text-primary)', overflow: 'hidden', padding: pad, outline: 'none' }} data-testid="fullscreen-capture">
      {/* sr-only assertive announcer for the self-timer countdown (must be
          always-mounted so the live region announces changes) */}
      <div role="timer" aria-live="assertive" aria-atomic="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
        {phase === 'countdown' && countdown > 0 ? `Capturing in ${countdown}` : ''}
      </div>
      {/* Hidden per-view file inputs — DOM order MUST stay front, side, back
          (e2e targets input[type=file] by index). */}
      {VIEW_ORDER.map(view => (
        <input
          key={view}
          ref={el => { fileInputRefs.current[view] = el }}
          type="file"
          accept="image/jpeg,image/png"
          style={{ display: 'none' }}
          aria-label={`Upload ${VIEW_LABEL[view]} photo`}
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) handleUpload(view, file)
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
              style={{ width: '100%', padding: '14px', borderRadius: '12px', background: 'var(--brand)', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer', minHeight: '44px' }}
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

            {showLiveCamera && (
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} viewBox="0 0 100 100" preserveAspectRatio="none">
                {/* rule-of-thirds grid */}
                <line x1="33.3" y1="0" x2="33.3" y2="100" stroke="rgba(255,255,255,0.18)" strokeWidth="0.2" />
                <line x1="66.6" y1="0" x2="66.6" y2="100" stroke="rgba(255,255,255,0.18)" strokeWidth="0.2" />
                <line x1="0" y1="33.3" x2="100" y2="33.3" stroke="rgba(255,255,255,0.18)" strokeWidth="0.2" />
                <line x1="0" y1="66.6" x2="100" y2="66.6" stroke="rgba(255,255,255,0.18)" strokeWidth="0.2" />
              </svg>
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
                <button onClick={retryCamera} style={{ padding: '10px 20px', borderRadius: '10px', background: 'var(--brand)', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer', minHeight: '44px' }}>Try Again</button>
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

            {(modelLoading || modelError) && (
              <div role="status" aria-live="polite" style={{ pointerEvents: 'auto', borderRadius: '999px', padding: '6px 12px', fontSize: '0.72rem', fontWeight: 600, background: modelError ? 'rgba(239,68,68,0.85)' : 'rgba(0,0,0,0.55)', color: modelError ? '#fff' : 'var(--text-primary)' }}>
                {modelError ? 'Pose engine unavailable' : 'Preparing pose engine…'}
              </div>
            )}
          </div>

          {/* Directional prompt + soft warnings (only on the live view) */}
          {showLiveCamera && (
            <div style={{ position: 'relative', zIndex: 2, marginTop: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', pointerEvents: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(0,0,0,0.5)', borderRadius: '999px', padding: '8px 16px', maxWidth: '92%' }}>
                <span style={{ color: '#fff', flexShrink: 0 }}><ViewSilhouette view={activeView} /></span>
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
                No person detected — retake {noPersonViews.map(v => VIEW_LABEL[v]).join(', ')}
              </div>
            )}
            {uploadError && (
              <div role="alert" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', padding: '8px 14px', fontSize: '0.8rem', color: 'var(--danger)', textAlign: 'center' }}>
                {uploadError}
              </div>
            )}

            {/* Tilt-blocked banner + override */}
            {showLiveCamera && phase === 'live' && tiltBlocked && (
              <div data-testid="tilt-blocked" id="tilt-blocked-banner" role="status" aria-live="polite" style={{
                background: 'rgba(239,68,68,0.14)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 10, padding: '10px 14px',
                fontSize: '0.82rem', color: 'var(--danger)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
              }}>
                <span>Phone is tilted {Math.abs(roll ?? 0).toFixed(1)}° — straighten it to capture.</span>
                <button onClick={() => setOverrideTilt(true)} style={{ background: 'none', border: '1px solid rgba(239,68,68,0.5)', borderRadius: 6, color: 'var(--danger)', fontSize: '0.75rem', fontWeight: 600, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Capture anyway</button>
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
                  <button onClick={useThisPhoto} style={{ flex: 2, padding: '14px', borderRadius: '12px', background: 'var(--brand)', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer', minHeight: '44px' }}>Use This Photo</button>
                </div>
              </div>
            )}

            {/* Status strip */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              {VIEW_ORDER.map(view => {
                const slot = captures[view]
                const isActive = view === activeView
                const captured = !!slot.preview
                const optional = view === 'back'
                const ring = isActive ? 'var(--brand)'
                  : slot.slotStatus === 'no_person' ? 'var(--danger)'
                  : slot.slotStatus === 'warnings' ? 'var(--warning)'
                  : captured ? '#10B981'
                  : 'rgba(255,255,255,0.2)'
                const selectable = captured || isActive
                return (
                  <button
                    key={view}
                    onClick={() => selectView(view)}
                    aria-disabled={!selectable}
                    aria-label={`${VIEW_LABEL[view]}${optional ? ' (optional)' : ''}${captured ? ' captured, tap to retake' : isActive ? ', current' : ', pending'}`}
                    aria-current={isActive ? 'step' : undefined}
                    style={{
                      position: 'relative', width: '64px', textAlign: 'center', background: 'none', border: 'none',
                      padding: 0, cursor: selectable ? 'pointer' : 'default', opacity: selectable || captured ? 1 : 0.7,
                    }}
                  >
                    <div style={{ position: 'relative', width: '54px', height: '54px', margin: '0 auto', borderRadius: '10px', overflow: 'hidden', border: `2px solid ${ring}`, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {captured && slot.preview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={slot.preview} alt={`${VIEW_LABEL[view]} thumbnail`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ color: isActive ? '#fff' : '#B4B4BD' }}><ViewSilhouette view={view} size={26} /></span>
                      )}
                      {captured && (
                        <span aria-hidden="true" style={{ position: 'absolute', bottom: 2, right: 2, width: '16px', height: '16px', borderRadius: '50%', background: slot.slotStatus === 'no_person' ? 'var(--danger)' : '#10B981', color: '#fff', fontSize: '0.6rem', fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{slot.slotStatus === 'no_person' ? '!' : '✓'}</span>
                      )}
                    </div>
                    <span style={{ display: 'block', fontSize: '0.68rem', fontWeight: 600, color: isActive ? '#C7D2FE' : '#C4C4CC', marginTop: '4px' }}>{view.charAt(0).toUpperCase() + view.slice(1)}</span>
                    <span style={{ display: 'block', fontSize: '0.62rem', color: '#B4B4BD' }}>{optional ? 'Optional' : 'Required'}</span>
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
                  aria-disabled={tiltBlocked || !ready}
                  aria-label="Capture photo"
                  style={{
                    justifySelf: 'center', width: '72px', height: '72px', borderRadius: '50%',
                    background: tiltBlocked || !ready ? 'rgba(255,255,255,0.25)' : '#fff',
                    border: '4px solid rgba(255,255,255,0.55)', boxShadow: '0 0 0 2px rgba(0,0,0,0.4)',
                    cursor: tiltBlocked || !ready ? 'not-allowed' : 'pointer',
                  }}
                  aria-describedby={tiltBlocked ? 'tilt-blocked-banner' : undefined}
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
                Use File Upload Instead — {VIEW_LABEL[activeView]}
              </button>
            )}

            {/* Proceed (available once Front + Side are captured; also the Back-skip) */}
            {frontSideReady && phase !== 'review' && (
              <button
                onClick={onProceed}
                disabled={submitting || requiredChecking}
                style={{ padding: '14px', borderRadius: '12px', background: submitting || requiredChecking ? 'rgba(0,152,243,0.4)' : 'var(--brand)', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.95rem', cursor: submitting || requiredChecking ? 'not-allowed' : 'pointer', minHeight: '44px' }}
              >
                {submitting ? 'Submitting…' : requiredChecking ? 'Checking photos…' : captures.back.preview ? 'Analyze Posture' : 'Skip Back & Analyze Posture'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

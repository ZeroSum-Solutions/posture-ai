'use client'
import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { PoseFrame } from '@posture-ai/engine/types'
import type { FrameQuality } from '@/lib/pose/quality'
import { useCameraLevel } from '@/lib/capture/use-camera-level'

interface Client {
  id: string
  first_name: string
  last_name: string
  date_of_birth: string | null
}

type ViewKey = 'front' | 'side' | 'back'

// Per-slot quality state
type SlotStatus = 'idle' | 'checking' | 'ok' | 'no_person' | 'warnings'

interface CaptureSlot {
  file: File | null
  preview: string | null
  source: 'upload' | 'camera' | null
  poseFrame: PoseFrame | null
  quality: FrameQuality | null
  slotStatus: SlotStatus
  /** Sensor-measured camera roll for camera captures; null for uploads/no-sensor. */
  captureRollDeg: number | null
}

type Captures = Record<ViewKey, CaptureSlot>

const STEPS = ['Client', 'Upload Views', 'Processing', 'Results']

const IS_TEST_MODE = process.env.NEXT_PUBLIC_POSTURE_TEST_MODE === '1'

// ---- ViewUploadSlot ----
interface ViewSlotProps {
  view: ViewKey
  capture: CaptureSlot
  onFileUpload: (file: File) => void
  onRetake: () => void
  onUseCamera: () => void
}

function ViewUploadSlot({ view, capture, onFileUpload, onRetake, onUseCamera }: ViewSlotProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const required = view === 'front' || view === 'side'
  const label = view === 'front' ? 'Front View' : view === 'side' ? 'Side View' : 'Back View'
  const [dragging, setDragging] = useState(false)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && (file.type === 'image/jpeg' || file.type === 'image/png')) {
      onFileUpload(file)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onFileUpload(file)
    e.target.value = ''
  }

  const { slotStatus, quality } = capture

  return (
    <div style={{ background: '#161618', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', alignItems: 'center' }}>
        <span style={{ fontWeight: 600, color: '#F5F5F5', fontSize: '0.9rem' }}>{label}</span>
        {required
          ? <span style={{ fontSize: '0.75rem', color: '#EF4444', fontWeight: 600 }}>Required</span>
          : <span style={{ fontSize: '0.75rem', color: '#A1A1AA' }}>Optional</span>
        }
      </div>

      {capture.preview ? (
        <div style={{ position: 'relative' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={capture.preview} alt={label + ' preview'}
            style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', borderRadius: '10px', display: 'block' }}
          />
          <button onClick={onRetake} style={{
            position: 'absolute', top: '8px', right: '8px', padding: '6px 12px', borderRadius: '6px',
            background: 'rgba(0,0,0,0.75)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)',
            fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
          }}>Retake</button>

          {/* Per-slot status badge */}
          {slotStatus === 'checking' && (
            <div style={{
              position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(0,0,0,0.75)',
              borderRadius: '6px', padding: '3px 10px', fontSize: '0.75rem', fontWeight: 700, color: '#A1A1AA',
            }}>Checking photo…</div>
          )}
          {slotStatus === 'ok' && (
            <div style={{
              position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(16,185,129,0.9)',
              borderRadius: '6px', padding: '3px 10px', fontSize: '0.75rem', fontWeight: 700, color: '#fff',
            }}>Ready</div>
          )}
          {slotStatus === 'no_person' && (
            <div style={{
              position: 'absolute', bottom: '8px', left: '8px', right: '8px',
              background: 'rgba(239,68,68,0.9)', borderRadius: '6px',
              padding: '4px 10px', fontSize: '0.75rem', fontWeight: 700, color: '#fff',
            }}>No person detected — retake</div>
          )}
          {slotStatus === 'warnings' && (
            <div style={{
              position: 'absolute', bottom: '8px', left: '8px',
              background: 'rgba(245,158,11,0.9)', borderRadius: '6px',
              padding: '3px 10px', fontSize: '0.75rem', fontWeight: 700, color: '#fff',
            }}>Review</div>
          )}
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onClick={() => inputRef.current?.click()}
          style={{
            aspectRatio: '3/4', border: '2px dashed ' + (dragging ? '#6366F1' : 'rgba(255,255,255,0.15)'),
            borderRadius: '10px', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: '12px',
            background: dragging ? 'rgba(99,102,241,0.05)' : 'rgba(255,255,255,0.02)',
            cursor: 'pointer', transition: 'all 0.15s ease',
          }}
        >
          <span style={{ fontSize: '2rem' }}>📷</span>
          <p style={{ color: '#A1A1AA', fontSize: '0.8rem', textAlign: 'center', margin: 0 }}>Drop image or click to upload</p>
          <p style={{ color: '#8A8A93', fontSize: '0.75rem', margin: 0 }}>JPEG or PNG</p>
          <button onClick={(e) => { e.stopPropagation(); onUseCamera() }} style={{
            padding: '8px 14px', borderRadius: '8px', background: 'rgba(99,102,241,0.15)',
            color: '#818CF8', border: '1px solid rgba(99,102,241,0.3)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
          }}>Use Camera</button>
        </div>
      )}

      {/* Warnings banner */}
      {slotStatus === 'warnings' && quality && quality.warnings.length > 0 && (
        <div style={{
          marginTop: '10px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: '8px', padding: '8px 12px',
        }}>
          {quality.warnings.map((w, i) => (
            <p key={i} style={{ color: '#F59E0B', fontSize: '0.78rem', margin: i > 0 ? '4px 0 0' : 0 }}>• {w}</p>
          ))}
        </div>
      )}
      {capture.preview && capture.source === 'upload' && (
        <p data-testid="upload-level-note" style={{ color: '#8A8A93', fontSize: '0.72rem', margin: '8px 0 0' }}>
          Camera level not verified for uploads — results may be less accurate.
        </p>
      )}

      {/* No `capture` attribute: on iOS/Android it forces the camera app and
          removes the photo-library option. The bare input gives the native
          chooser (library / take photo), with camera permission handled by the OS. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  )
}

// ---- CameraCapture ----
interface CameraCaptureProps {
  view: ViewKey
  onCapture: (dataUrl: string, captureRollDeg: number | null) => void
  onClose: () => void
}

function CameraCapture({ view, onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const [phase, setPhase] = useState<'live' | 'countdown' | 'preview' | 'error'>('live')
  const [countdown, setCountdown] = useState(3)
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const level = useCameraLevel()
  const [overrideTilt, setOverrideTilt] = useState(false)
  const [rollAtCapture, setRollAtCapture] = useState<number | null>(null)
  const [previewQuality, setPreviewQuality] = useState<FrameQuality | null>(null)

  const roll = level.rollDeg
  // Gate thresholds (spec §4.1): green ≤2°, amber ≤5° (allowed, corrected),
  // red >5° (blocked, manual override available).
  const tiltZone: 'green' | 'amber' | 'red' | null =
    roll === null ? null : Math.abs(roll) <= 2 ? 'green' : Math.abs(roll) <= 5 ? 'amber' : 'red'
  const tiltBlocked = tiltZone === 'red' && !overrideTilt

  const label = view === 'front' ? 'Front' : view === 'side' ? 'Side' : 'Back'

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

  async function acquireWakeLock() {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    try {
      wakeLockRef.current = await (navigator as Navigator & { wakeLock: { request(type: string): Promise<WakeLockSentinel> } }).wakeLock.request('screen')
    } catch {
      // Wake lock is best-effort — silently ignore failures
    }
  }

  function releaseWakeLock() {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {})
      wakeLockRef.current = null
    }
  }

  const captureFrame = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    setRollAtCapture(level.rollRef.current)
    setCapturedUrl(dataUrl)
    setPhase('preview')
    releaseWakeLock()
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()) }
  }, [level.rollRef])

  useEffect(() => {
    let active = true
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 720 }, height: { ideal: 960 } }
        })
        if (!active) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream

        // Detect stream ending mid-session (e.g. camera disconnected)
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (active) {
            setErrorMsg('Camera disconnected — restart or upload instead.')
            setPhase('error')
          }
        })

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          try {
            await videoRef.current.play()
          } catch {
            // Some browsers block autoplay; not fatal — user can tap capture
          }
        }
      } catch (err) {
        if (active) {
          setErrorMsg(getErrorMessage(err))
          setPhase('error')
        }
      }
    }
    startCamera()
    return () => {
      active = false
      releaseWakeLock()
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()) }
    }
  }, [])

  useEffect(() => {
    if (phase !== 'countdown') return
    if (countdown <= 0) { captureFrame(); return }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [phase, countdown, captureFrame])

  // Best-effort framing feedback on the captured still, so the user can
  // retake inside the modal. The wizard's preflight remains authoritative.
  useEffect(() => {
    if (phase !== 'preview' || !capturedUrl) return
    let cancelled = false
    void (async () => {
      try {
        const { detectPose } = await import('@/lib/pose/detect')
        const { assessFrameQuality } = await import('@/lib/pose/quality')
        const frame = await detectPose(capturedUrl, view, 'camera')
        if (!cancelled) setPreviewQuality(assessFrameQuality(frame, view))
      } catch {
        // non-fatal: the slot preflight still runs after "Use This Photo"
      }
    })()
    return () => { cancelled = true }
  }, [phase, capturedUrl, view])

  function startCountdown() {
    acquireWakeLock()
    setCountdown(3)
    setPhase('countdown')
  }

  async function handleRetake() {
    setRollAtCapture(null)
    setPreviewQuality(null)
    setOverrideTilt(false)
    setCapturedUrl(null)
    setPhase('live')
    setCountdown(3)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 720 }, height: { ideal: 960 } }
      })
      streamRef.current = stream

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setErrorMsg('Camera disconnected — restart or upload instead.')
        setPhase('error')
      })

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        try {
          await videoRef.current.play()
        } catch {
          // non-fatal
        }
      }
    } catch (err) {
      setErrorMsg(getErrorMessage(err))
      setPhase('error')
    }
  }

  const plumbColor =
    tiltZone === 'green' ? 'rgba(34,197,94,0.85)'
    : tiltZone === 'amber' ? 'rgba(245,158,11,0.85)'
    : tiltZone === 'red' ? 'rgba(239,68,68,0.9)'
    : 'rgba(99,102,241,0.7)'

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '16px' }}>
      <div style={{ background: '#0F0F11', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '20px', padding: '24px', width: '100%', maxWidth: '480px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ color: '#F5F5F5', fontWeight: 700, fontSize: '1.1rem', margin: 0 }}>{label} View - Live Camera</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#A1A1AA', fontSize: '1.3rem', cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}>×</button>
        </div>

        {phase === 'error' && (
          <div style={{ padding: '24px', textAlign: 'center', background: 'rgba(239,68,68,0.1)', borderRadius: '12px', border: '1px solid rgba(239,68,68,0.2)' }}>
            <p style={{ color: '#EF4444', fontWeight: 600, margin: '0 0 8px' }}>Camera Unavailable</p>
            <p data-testid="camera-error-msg" style={{ color: '#A1A1AA', fontSize: '0.875rem', margin: '0 0 16px' }}>{errorMsg}</p>
            <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '8px', background: 'rgba(255,255,255,0.08)', color: '#F5F5F5', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', fontWeight: 600 }}>Use File Upload Instead</button>
          </div>
        )}

        {(phase === 'live' || phase === 'countdown') && (
          <div>
            <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', background: '#000', lineHeight: 0 }}>
              <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', display: 'block', maxHeight: '360px', objectFit: 'cover' }} />
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} viewBox="0 0 100 100" preserveAspectRatio="none">
                <line x1="50" y1="0" x2="50" y2="100" stroke={plumbColor} strokeWidth="0.4" strokeDasharray="3,3" />
                <line x1="10" y1="18" x2="90" y2="18" stroke="rgba(255,255,255,0.25)" strokeWidth="0.25" strokeDasharray="2,4" />
                <line x1="10" y1="35" x2="90" y2="35" stroke="rgba(255,255,255,0.25)" strokeWidth="0.25" strokeDasharray="2,4" />
                <line x1="10" y1="55" x2="90" y2="55" stroke="rgba(255,255,255,0.25)" strokeWidth="0.25" strokeDasharray="2,4" />
                <line x1="10" y1="75" x2="90" y2="75" stroke="rgba(255,255,255,0.25)" strokeWidth="0.25" strokeDasharray="2,4" />
              </svg>
              {roll !== null && (
                <div data-testid="level-indicator" style={{
                  position: 'absolute', top: 8, left: 8, borderRadius: 6, padding: '3px 10px',
                  fontSize: '0.75rem', fontWeight: 700, color: '#fff',
                  background: tiltZone === 'green' ? 'rgba(16,185,129,0.9)' : tiltZone === 'amber' ? 'rgba(245,158,11,0.9)' : 'rgba(239,68,68,0.92)',
                }}>
                  {tiltZone === 'green' ? 'Level' : `Tilted ${roll > 0 ? 'right' : 'left'} ${Math.abs(roll).toFixed(1)}°`}
                </div>
              )}
              {roll !== null && level.pitchDeg !== null && Math.abs(level.pitchDeg) > 15 && (
                <div style={{
                  position: 'absolute', top: 8, right: 8, borderRadius: 6, padding: '3px 10px',
                  fontSize: '0.72rem', fontWeight: 600, color: '#fff', background: 'rgba(245,158,11,0.9)',
                }}>
                  Aim the camera straight ahead
                </div>
              )}
              {phase === 'countdown' && countdown > 0 && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }}>
                  <span style={{ fontSize: '5rem', fontWeight: 900, color: '#fff', lineHeight: 1 }}>{countdown}</span>
                </div>
              )}
            </div>
            <p style={{ color: '#8A8A93', fontSize: '0.78rem', textAlign: 'center', margin: '8px 0 14px' }}>Align subject along the plumb-line guide</p>
            {level.permission === 'needs-request' && (
              <button onClick={level.requestAccess} style={{
                display: 'block', margin: '0 auto 12px', padding: '8px 14px', borderRadius: 8,
                background: 'rgba(99,102,241,0.15)', color: '#818CF8',
                border: '1px solid rgba(99,102,241,0.3)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
              }}>Enable level meter</button>
            )}
            {(level.permission === 'denied' || level.permission === 'unsupported') && (
              <p style={{ color: '#8A8A93', fontSize: '0.72rem', textAlign: 'center', margin: '0 0 12px' }}>
                Level check unavailable — hold the phone upright and straight.
              </p>
            )}
            {typeof screen !== 'undefined' && screen.orientation && !screen.orientation.type.startsWith('portrait') && (
              <p style={{ color: '#F59E0B', fontSize: '0.78rem', textAlign: 'center', margin: '0 0 12px', fontWeight: 600 }}>
                Hold the phone upright (portrait) to capture.
              </p>
            )}
            {phase === 'live' && tiltBlocked && (
              <div data-testid="tilt-blocked" style={{
                background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 10, padding: '10px 14px', marginBottom: 10,
                fontSize: '0.82rem', color: '#EF4444', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
              }}>
                <span>Phone is tilted {Math.abs(roll!).toFixed(1)}° — straighten it to capture.</span>
                <button onClick={() => setOverrideTilt(true)} style={{
                  background: 'none', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 6,
                  color: '#EF4444', fontSize: '0.75rem', fontWeight: 600, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
                }}>Capture anyway</button>
              </div>
            )}
            {phase === 'live' && (
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={startCountdown} disabled={tiltBlocked} style={{ flex: 1, padding: '12px', borderRadius: '10px', background: tiltBlocked ? 'rgba(79,70,229,0.35)' : '#4F46E5', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.95rem', cursor: tiltBlocked ? 'not-allowed' : 'pointer' }}>3-2-1 Auto Capture</button>
                <button onClick={captureFrame} disabled={tiltBlocked} style={{ padding: '12px 16px', borderRadius: '10px', background: 'rgba(255,255,255,0.08)', color: tiltBlocked ? '#6B6B73' : '#F5F5F5', border: '1px solid rgba(255,255,255,0.12)', fontWeight: 600, fontSize: '0.875rem', cursor: tiltBlocked ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>Capture Now</button>
              </div>
            )}
            {phase === 'countdown' && (
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <p style={{ color: '#A1A1AA', fontSize: '0.875rem', margin: 0 }}>
                  {countdown > 0 ? 'Capturing in ' + countdown + '...' : 'Capturing...'}
                </p>
              </div>
            )}
          </div>
        )}

        {phase === 'preview' && capturedUrl && (
          <div>
            <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', lineHeight: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={capturedUrl} alt="Captured frame" style={{ width: '100%', display: 'block', maxHeight: '360px', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', top: '10px', left: '10px', background: 'rgba(16,185,129,0.9)', borderRadius: '6px', padding: '4px 12px', fontSize: '0.8rem', fontWeight: 700, color: '#fff' }}>Captured</div>
              {rollAtCapture !== null && (
                <div style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(0,0,0,0.75)', borderRadius: '6px', padding: '4px 12px', fontSize: '0.75rem', fontWeight: 600, color: Math.abs(rollAtCapture) <= 2 ? '#34D399' : '#F59E0B' }}>
                  {Math.abs(rollAtCapture) <= 2 ? 'Level ✓' : `Roll ${rollAtCapture.toFixed(1)}° — will be corrected`}
                </div>
              )}
            </div>
            <p style={{ color: '#A1A1AA', fontSize: '0.8rem', textAlign: 'center', margin: '10px 0 14px' }}>Preview - use this photo or retake</p>
            {previewQuality && previewQuality.status === 'ok' && (
              <p style={{ color: '#34D399', fontSize: '0.78rem', textAlign: 'center', margin: '0 0 10px' }}>Framing looks good</p>
            )}
            {previewQuality && previewQuality.status === 'no_person' && (
              <p style={{ color: '#EF4444', fontSize: '0.78rem', textAlign: 'center', margin: '0 0 10px', fontWeight: 600 }}>No person detected — retake</p>
            )}
            {previewQuality && previewQuality.warnings.length > 0 && (
              <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
                {previewQuality.warnings.map((w, i) => (
                  <p key={i} style={{ color: '#F59E0B', fontSize: '0.75rem', margin: i > 0 ? '4px 0 0' : 0 }}>• {w}</p>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={handleRetake} style={{ flex: 1, padding: '12px', borderRadius: '10px', background: 'rgba(255,255,255,0.06)', color: '#A1A1AA', border: '1px solid rgba(255,255,255,0.1)', fontWeight: 600, cursor: 'pointer' }}>Retake</button>
              <button onClick={() => capturedUrl && onCapture(capturedUrl, rollAtCapture)} style={{ flex: 2, padding: '12px', borderRadius: '10px', background: '#4F46E5', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' }}>Use This Photo</button>
            </div>
          </div>
        )}

        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>
    </div>
  )
}

// ---- Main Wizard ----
function NewAssessmentWizard() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedClientId = searchParams.get('client_id')
  const testModeParam = searchParams.get('testMode') === '1'
  const testMode = IS_TEST_MODE || testModeParam

  const [step, setStep] = useState(1)
  const [clients, setClients] = useState<Client[]>([])
  const [clientSearch, setClientSearch] = useState('')
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [loadingClients, setLoadingClients] = useState(true)
  const [captures, setCaptures] = useState<Captures>({
    front: { file: null, preview: null, source: null, poseFrame: null, quality: null, slotStatus: 'idle', captureRollDeg: null },
    side: { file: null, preview: null, source: null, poseFrame: null, quality: null, slotStatus: 'idle', captureRollDeg: null },
    back: { file: null, preview: null, source: null, poseFrame: null, quality: null, slotStatus: 'idle', captureRollDeg: null },
  })
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [activeCameraSlot, setActiveCameraSlot] = useState<ViewKey | null>(null)

  // Model load state (shown while warming up)
  const [modelLoading, setModelLoading] = useState(false)
  const [modelError, setModelError] = useState(false)

  // Assessment API state
  const [assessmentId, setAssessmentId] = useState<string | null>(null)
  const [processingError, setProcessingError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    async function loadClients() {
      const supabase = createSupabaseBrowserClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }
      const { data } = await supabase
        .from('clients')
        .select('id, first_name, last_name, date_of_birth')
        .eq('practitioner_id', user.id)
        .is('archived_at', null)
        .order('first_name')
      const list = data || []
      setClients(list)
      if (preselectedClientId) {
        const pre = list.find(c => c.id === preselectedClientId)
        if (pre) setSelectedClient(pre)
      }
      setLoadingClients(false)
    }
    loadClients()
  }, [preselectedClientId, router])

  // Warm up the landmarker when step 2 mounts (hides ~5s Chromium cold-start)
  useEffect(() => {
    if (step !== 2 || testMode) return
    let cancelled = false
    async function warm() {
      setModelLoading(true)
      setModelError(false)
      try {
        const { warmUpLandmarker } = await import('@/lib/pose/detect')
        warmUpLandmarker()
        // Warm-up is fire-and-forget; clear the indicator after a brief settle
        await new Promise(r => setTimeout(r, 500))
        if (!cancelled) setModelLoading(false)
      } catch {
        if (!cancelled) { setModelLoading(false); setModelError(true) }
      }
    }
    warm()
    return () => { cancelled = true }
  }, [step, testMode])

  // Step 3: Poll assessment status and redirect when complete
  useEffect(() => {
    if (step !== 3 || !assessmentId) return
    let cancelled = false

    async function pollStatus() {
      if (cancelled) return
      try {
        console.log('[wizard] Polling status for assessment:', assessmentId)
        const r = await fetch('/api/assessments/' + assessmentId + '/status')
        if (!r.ok) {
          if (!cancelled) setProcessingError('Failed to check assessment status.')
          return
        }
        const data = await r.json()
        console.log('[wizard] Assessment status:', data.status)
        if (cancelled) return

        if (data.status === 'complete') {
          router.push('/assessments/' + assessmentId)
        } else if (data.status === 'failed') {
          setProcessingError('Scoring failed. Please try again.')
        } else {
          // Still processing — poll again in 2s
          setTimeout(pollStatus, 2000)
        }
      } catch {
        if (!cancelled) {
          setTimeout(pollStatus, 2000)
        }
      }
    }

    // Start polling after a brief delay (allow server to finish)
    const timer = setTimeout(pollStatus, 800)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [step, assessmentId, router])

  const filteredClients = clientSearch.trim()
    ? clients.filter(c => {
        const q = clientSearch.toLowerCase()
        return c.first_name.toLowerCase().includes(q) || c.last_name.toLowerCase().includes(q) || (c.first_name + ' ' + c.last_name).toLowerCase().includes(q)
      })
    : clients

  // Run detectPose + assessFrameQuality after each capture/upload
  async function runPreflight(view: ViewKey, preview: string, source: 'camera' | 'upload', captureRollDeg: number | null) {
    setCaptures(prev => ({
      ...prev,
      [view]: { ...prev[view], slotStatus: 'checking' },
    }))

    try {
      const { detectPose } = await import('@/lib/pose/detect')
      const { assessFrameQuality } = await import('@/lib/pose/quality')

      const detected = await detectPose(preview, view, source)
      const poseFrame: PoseFrame = captureRollDeg !== null ? { ...detected, captureRollDeg } : detected
      const quality = assessFrameQuality(poseFrame, view)

      const slotStatus: SlotStatus = quality.status === 'no_person' ? 'no_person'
        : quality.status === 'warnings' ? 'warnings'
        : 'ok'

      setCaptures(prev => ({
        ...prev,
        [view]: { ...prev[view], poseFrame, quality, slotStatus },
      }))
    } catch (err) {
      console.error('[wizard] preflight error:', err)
      // On model-load failure, don't block submission — mark idle
      setCaptures(prev => ({
        ...prev,
        [view]: { ...prev[view], slotStatus: 'idle' },
      }))
      setModelError(true)
    }
  }

  async function handleFileUpload(view: ViewKey, file: File) {
    const { normalizeUploadedImage } = await import('@/lib/pose/normalize-upload')
    const preview = (await normalizeUploadedImage(file)) ?? URL.createObjectURL(file)
    setCaptures(prev => ({
      ...prev,
      [view]: { file, preview, source: 'upload', poseFrame: null, quality: null, slotStatus: 'idle', captureRollDeg: null },
    }))
    setUploadError(null)
    if (!testMode) runPreflight(view, preview, 'upload', null)
  }

  function handleRetake(view: ViewKey) {
    const old = captures[view]
    if (old.preview && old.preview.startsWith('blob:')) URL.revokeObjectURL(old.preview)
    setCaptures(prev => ({
      ...prev,
      [view]: { file: null, preview: null, source: null, poseFrame: null, quality: null, slotStatus: 'idle', captureRollDeg: null },
    }))
  }

  function handleCameraCapture(view: ViewKey, dataUrl: string, captureRollDeg: number | null) {
    setCaptures(prev => ({
      ...prev,
      [view]: { file: null, preview: dataUrl, source: 'camera', poseFrame: null, quality: null, slotStatus: 'idle', captureRollDeg },
    }))
    setActiveCameraSlot(null)
    setUploadError(null)
    if (!testMode) runPreflight(view, dataUrl, 'camera', captureRollDeg)
  }

  // Check if submit should be blocked: a required slot has 'no_person' status
  function hasBlockingSlot(): boolean {
    const required: ViewKey[] = ['front', 'side']
    return required.some(v => captures[v].preview && captures[v].slotStatus === 'no_person')
  }

  async function validateAndProceed() {
    if (!selectedClient) { setUploadError('Please select a client.'); return }
    if (!testMode) {
      if (!captures.front.preview) { setUploadError('Front view is required before proceeding.'); return }
      if (!captures.side.preview) { setUploadError('Side view is required before proceeding.'); return }
      if (hasBlockingSlot()) {
        setUploadError('One or more views has no person detected. Please retake those photos.')
        return
      }
    }

    setUploadError(null)
    setProcessingError(null)
    setSubmitting(true)
    setStep(3)

    try {
      const clientId = selectedClient?.id

      // Reuse cached PoseFrames if available; fall back to detection if needed.
      let frames: unknown[] | undefined = undefined
      if (!testMode) {
        frames = []
        for (const v of ['front', 'side', 'back'] as ViewKey[]) {
          const cap = captures[v]
          if (!cap.preview) continue
          if (cap.poseFrame) {
            // Reuse the frame from preflight — no re-detection needed
            frames.push(cap.poseFrame)
          } else {
            // Preflight was skipped or failed — detect now
            const { detectPose } = await import('@/lib/pose/detect')
            const detected = await detectPose(cap.preview, v, cap.source ?? 'upload')
            frames.push(cap.captureRollDeg !== null ? { ...detected, captureRollDeg: cap.captureRollDeg } : detected)
          }
        }
      }

      const response = await fetch('/api/assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, test_mode: testMode, frames }),
      })

      if (!response.ok) {
        const err = await response.json()
        setProcessingError(err.error || 'Failed to create assessment.')
        setSubmitting(false)
        return
      }

      const data = await response.json()
      console.log('[wizard] Assessment created:', data.id, 'status:', data.status)
      setAssessmentId(data.id)
      // Polling useEffect will take over from here
    } catch (err) {
      console.error('[wizard] Fetch error:', err)
      setProcessingError('Network error. Please try again.')
    }
    setSubmitting(false)
  }

  function handleRetry() {
    setProcessingError(null)
    setAssessmentId(null)
    setStep(2)
  }

  const clientName = selectedClient
    ? selectedClient.first_name + ' ' + selectedClient.last_name
    : 'Client'

  return (
    <div style={{ padding: '24px 16px', maxWidth: '960px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <Link href="/clients" style={{ color: '#818CF8', textDecoration: 'none', fontSize: '0.875rem', minHeight: '44px', display: 'inline-flex', alignItems: 'center' }}>← Back to Clients</Link>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5', margin: 0 }}>New Assessment</h1>
        {testMode && (
          <span style={{ padding: '3px 10px', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, color: '#818CF8' }}>
            TEST MODE
          </span>
        )}
      </div>

      {/* Progress indicator */}
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '32px', overflowX: 'auto' }}>
        {STEPS.map((label, i) => {
          const stepNum = i + 1
          const isActive = stepNum === step
          const isDone = stepNum < step
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'flex-start', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <div style={{
                  width: '32px', height: '32px', borderRadius: '50%',
                  background: isActive ? '#4F46E5' : isDone ? '#10B981' : 'rgba(255,255,255,0.08)',
                  border: '2px solid ' + (isActive ? '#6366F1' : isDone ? '#10B981' : 'rgba(255,255,255,0.15)'),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: isActive || isDone ? '#fff' : '#8A8A93',
                  fontSize: '0.85rem', fontWeight: 700, flexShrink: 0,
                }}>
                  {isDone ? '✓' : stepNum}
                </div>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: isActive ? '#818CF8' : isDone ? '#34D399' : '#8A8A93', whiteSpace: 'nowrap' }}>{label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ flex: 1, height: '2px', background: isDone ? '#10B981' : 'rgba(255,255,255,0.08)', margin: '14px 8px 0', minWidth: '16px' }} />
              )}
            </div>
          )
        })}
      </div>

      {/* Step 1: Select Client */}
      {step === 1 && (
        <div>
          <div style={{ marginBottom: '16px' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#F5F5F5', margin: '0 0 4px' }}>Step 1: Select Client</h2>
            <p style={{ color: '#A1A1AA', fontSize: '0.875rem', margin: 0 }}>Search and select the client you are assessing.</p>
          </div>
          {testMode && (
            <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', fontSize: '0.875rem', color: '#818CF8' }}>
              Test mode active — fixture landmarks will be used instead of MediaPipe.
            </div>
          )}
          <div style={{ background: '#161618', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '24px' }}>
            <input type="text" placeholder="Search clients by name..." value={clientSearch} onChange={e => setClientSearch(e.target.value)}
              style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#F5F5F5', fontSize: '0.95rem', marginBottom: '16px', boxSizing: 'border-box', minHeight: '44px' }}
            />
            {loadingClients ? (
              <p style={{ color: '#A1A1AA', textAlign: 'center', padding: '24px 0', margin: 0 }}>Loading clients...</p>
            ) : filteredClients.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#A1A1AA' }}>
                {clientSearch ? 'No clients match your search.' : <span>No clients yet. <Link href="/clients/new" style={{ color: '#818CF8' }}>Create a client</Link></span>}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflowY: 'auto' }}>
                {filteredClients.map(c => {
                  const isSelected = selectedClient?.id === c.id
                  return (
                    <button key={c.id} onClick={() => setSelectedClient(c)} style={{
                      width: '100%', padding: '14px 16px', textAlign: 'left',
                      background: isSelected ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)',
                      border: '1px solid ' + (isSelected ? '#6366F1' : 'rgba(255,255,255,0.08)'),
                      borderRadius: '10px', cursor: 'pointer', color: '#F5F5F5', transition: 'all 0.15s ease', minHeight: '44px',
                    }}>
                      <span style={{ display: 'block', fontSize: '0.95rem', fontWeight: isSelected ? 600 : 400 }}>
                        {c.first_name} {c.last_name}
                        {isSelected && <span style={{ color: '#818CF8', marginLeft: '8px' }}>✓ Selected</span>}
                      </span>
                      {c.date_of_birth && (
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#A1A1AA', marginTop: '2px' }}>
                          DOB: {new Date(c.date_of_birth).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => selectedClient && setStep(2)}
              disabled={!selectedClient}
              style={{
                padding: '12px 28px', borderRadius: '10px',
                background: selectedClient ? '#4F46E5' : 'rgba(99,102,241,0.25)',
                color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.95rem',
                cursor: selectedClient ? 'pointer' : 'not-allowed', minHeight: '44px',
              }}>
              {testMode ? 'Next: Confirm' : 'Next: Upload Views'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Upload/Confirm */}
      {step === 2 && (
        <div>
          <div style={{ marginBottom: '16px' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#F5F5F5', margin: '0 0 4px' }}>
              {testMode ? 'Step 2: Confirm Test Mode' : 'Step 2: Upload Posture Views'}
            </h2>
            <p style={{ color: '#A1A1AA', fontSize: '0.875rem', margin: 0 }}>
              {selectedClient ? <>Client: <strong style={{ color: '#F5F5F5' }}>{clientName}</strong></> : 'Test mode — no client required'}
            </p>
          </div>
          {/* Non-diagnostic disclaimer - required on capture step */}
          <div data-testid="capture-disclaimer" style={{
            background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)',
            borderRadius: '8px', padding: '10px 14px', marginBottom: '16px',
            fontSize: '0.78rem', color: '#A1A1AA', lineHeight: 1.5,
          }}>
            <strong style={{ color: '#818CF8' }}>Screening Tool Only</strong> — Posture AI is a screening tool. Results are for informational purposes only and are not a substitute for evaluation by a qualified professional. Consult a qualified health professional before making any clinical decisions.
          </div>

          {/* Model loading / error indicators */}
          {!testMode && modelLoading && (
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '0.8rem', color: '#8A8A93' }}>
              Preparing pose engine…
            </div>
          )}
          {!testMode && modelError && (
            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '0.8rem', color: '#EF4444' }}>
              Could not load the pose engine — check connection and retry.
            </div>
          )}

          {testMode ? (
            <div style={{ background: '#161618', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '24px' }}>
              <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
                <p style={{ color: '#818CF8', fontWeight: 600, margin: '0 0 8px' }}>Test Mode Active</p>
                <p style={{ color: '#A1A1AA', fontSize: '0.875rem', margin: 0 }}>
                  Pre-computed fixture landmarks will be injected directly into the scoring engine.
                  Results will be saved to the database and you will be redirected to the results page.
                </p>
              </div>
            </div>
          ) : (
            <>
              {uploadError && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', color: '#EF4444', fontSize: '0.875rem' }}>
                  {uploadError}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
                {(['front', 'side', 'back'] as ViewKey[]).map(view => (
                  <ViewUploadSlot key={view} view={view} capture={captures[view]}
                    onFileUpload={(file) => handleFileUpload(view, file)}
                    onRetake={() => handleRetake(view)}
                    onUseCamera={() => setActiveCameraSlot(view)}
                  />
                ))}
              </div>
            </>
          )}

          <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
            <button onClick={() => setStep(1)} style={{ padding: '12px 24px', borderRadius: '10px', background: 'rgba(255,255,255,0.06)', color: '#A1A1AA', border: '1px solid rgba(255,255,255,0.1)', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', minHeight: '44px' }}>Back</button>
            <button onClick={validateAndProceed} disabled={submitting} style={{ padding: '12px 28px', borderRadius: '10px', background: submitting ? 'rgba(99,102,241,0.4)' : '#4F46E5', color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.95rem', cursor: submitting ? 'not-allowed' : 'pointer', minHeight: '44px' }}>
              {submitting ? 'Submitting...' : testMode ? 'Run Test Analysis' : 'Analyze Posture'}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Processing (with API polling) */}
      {step === 3 && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          {processingError ? (
            // Error state with retry
            <div>
              <div style={{
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: '16px', padding: '24px', marginBottom: '24px', display: 'inline-block', maxWidth: '400px',
              }}>
                <p style={{ color: '#EF4444', fontWeight: 700, fontSize: '1.1rem', margin: '0 0 8px' }}>Scoring Failed</p>
                <p style={{ color: '#A1A1AA', margin: '0 0 20px' }}>{processingError}</p>
                <button onClick={handleRetry} style={{
                  padding: '12px 24px', borderRadius: '10px', background: '#4F46E5', color: '#fff',
                  border: 'none', fontWeight: 600, cursor: 'pointer', minHeight: '44px',
                }}>Try Again</button>
              </div>
            </div>
          ) : (
            // Loading spinner + status (announced to screen readers)
            <div role="status" aria-live="polite">
              <div aria-hidden="true" style={{ width: '64px', height: '64px', border: '4px solid rgba(99,102,241,0.2)', borderTop: '4px solid #6366F1', borderRadius: '50%', margin: '0 auto 24px', animation: 'spin 1s linear infinite' }} />
              <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
              <h2 style={{ color: '#F5F5F5', fontSize: '1.3rem', fontWeight: 700, marginBottom: '8px' }}>
                {testMode ? 'Running Test Analysis...' : 'Analyzing Posture...'}
              </h2>
              <p style={{ color: '#A1A1AA', margin: 0 }}>
                {assessmentId
                  ? 'Checking results...'
                  : testMode
                    ? 'Submitting assessment to server...'
                    : 'Processing images for ' + clientName
                }
              </p>
              {assessmentId && (
                <p style={{ color: '#52525B', fontSize: '0.8rem', marginTop: '8px' }}>
                  Assessment ID: {assessmentId}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {activeCameraSlot && (
        <CameraCapture view={activeCameraSlot}
          onCapture={(dataUrl, rollDeg) => handleCameraCapture(activeCameraSlot, dataUrl, rollDeg)}
          onClose={() => setActiveCameraSlot(null)}
        />
      )}
    </div>
  )
}

export default function NewAssessmentPage() {
  return (
    <Suspense fallback={<div style={{ padding: '48px 16px', textAlign: 'center', color: '#A1A1AA' }}>Loading…</div>}>
      <NewAssessmentWizard />
    </Suspense>
  )
}

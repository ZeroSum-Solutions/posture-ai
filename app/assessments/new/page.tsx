'use client'
import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { Zone } from '@/lib/posture-engine'

interface Client {
  id: string
  first_name: string
  last_name: string
  date_of_birth: string | null
}

type ViewKey = 'front' | 'side' | 'back'

interface CaptureSlot {
  file: File | null
  preview: string | null
  source: 'upload' | 'camera' | null
}

type Captures = Record<ViewKey, CaptureSlot>

const STEPS = ['Client', 'Upload Views', 'Processing', 'Results']

const IS_TEST_MODE = process.env.NEXT_PUBLIC_POSTURE_TEST_MODE === '1'

// Zone colors
const ZONE_COLORS: Record<Zone, string> = {
  maintain: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  unreliable: '#71717A',
}

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
          <div style={{
            position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(16,185,129,0.9)',
            borderRadius: '6px', padding: '3px 10px', fontSize: '0.75rem', fontWeight: 700, color: '#fff',
          }}>Ready</div>
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
          <p style={{ color: '#71717A', fontSize: '0.75rem', margin: 0 }}>JPEG or PNG</p>
          <button onClick={(e) => { e.stopPropagation(); onUseCamera() }} style={{
            padding: '8px 14px', borderRadius: '8px', background: 'rgba(99,102,241,0.15)',
            color: '#6366F1', border: '1px solid rgba(99,102,241,0.3)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
          }}>Use Camera</button>
        </div>
      )}

      <input ref={inputRef} type="file" accept="image/jpeg,image/png" style={{ display: 'none' }} onChange={handleFileChange} />
    </div>
  )
}

// ---- CameraCapture ----
interface CameraCaptureProps {
  view: ViewKey
  onCapture: (dataUrl: string) => void
  onClose: () => void
}

function CameraCapture({ view, onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [phase, setPhase] = useState<'live' | 'countdown' | 'preview' | 'error'>('live')
  const [countdown, setCountdown] = useState(3)
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const label = view === 'front' ? 'Front' : view === 'side' ? 'Side' : 'Back'

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
    setCapturedUrl(dataUrl)
    setPhase('preview')
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()) }
  }, [])

  useEffect(() => {
    let active = true
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 720 }, height: { ideal: 960 } }
        })
        if (!active) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch {
        if (active) {
          setErrorMsg('Camera access denied. Please allow camera permission and try again.')
          setPhase('error')
        }
      }
    }
    startCamera()
    return () => {
      active = false
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()) }
    }
  }, [])

  useEffect(() => {
    if (phase !== 'countdown') return
    if (countdown <= 0) { captureFrame(); return }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [phase, countdown, captureFrame])

  function startCountdown() { setCountdown(3); setPhase('countdown') }

  async function handleRetake() {
    setCapturedUrl(null)
    setPhase('live')
    setCountdown(3)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 720 }, height: { ideal: 960 } }
      })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }
    } catch {
      setErrorMsg('Could not restart camera.')
      setPhase('error')
    }
  }

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
            <p style={{ color: '#A1A1AA', fontSize: '0.875rem', margin: '0 0 16px' }}>{errorMsg}</p>
            <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: '8px', background: 'rgba(255,255,255,0.08)', color: '#F5F5F5', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer', fontWeight: 600 }}>Use File Upload Instead</button>
          </div>
        )}

        {(phase === 'live' || phase === 'countdown') && (
          <div>
            <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', background: '#000', lineHeight: 0 }}>
              <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', display: 'block', maxHeight: '360px', objectFit: 'cover' }} />
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} viewBox="0 0 100 100" preserveAspectRatio="none">
                <line x1="50" y1="0" x2="50" y2="100" stroke="rgba(99,102,241,0.7)" strokeWidth="0.4" strokeDasharray="3,3" />
                <line x1="10" y1="18" x2="90" y2="18" stroke="rgba(255,255,255,0.25)" strokeWidth="0.25" strokeDasharray="2,4" />
                <line x1="10" y1="35" x2="90" y2="35" stroke="rgba(255,255,255,0.25)" strokeWidth="0.25" strokeDasharray="2,4" />
                <line x1="10" y1="55" x2="90" y2="55" stroke="rgba(255,255,255,0.25)" strokeWidth="0.25" strokeDasharray="2,4" />
                <line x1="10" y1="75" x2="90" y2="75" stroke="rgba(255,255,255,0.25)" strokeWidth="0.25" strokeDasharray="2,4" />
              </svg>
              {phase === 'countdown' && countdown > 0 && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)' }}>
                  <span style={{ fontSize: '5rem', fontWeight: 900, color: '#fff', lineHeight: 1 }}>{countdown}</span>
                </div>
              )}
            </div>
            <p style={{ color: '#71717A', fontSize: '0.78rem', textAlign: 'center', margin: '8px 0 14px' }}>Align subject along the plumb-line guide</p>
            {phase === 'live' && (
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={startCountdown} style={{ flex: 1, padding: '12px', borderRadius: '10px', background: '#6366F1', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' }}>3-2-1 Auto Capture</button>
                <button onClick={captureFrame} style={{ padding: '12px 16px', borderRadius: '10px', background: 'rgba(255,255,255,0.08)', color: '#F5F5F5', border: '1px solid rgba(255,255,255,0.12)', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>Capture Now</button>
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
            </div>
            <p style={{ color: '#A1A1AA', fontSize: '0.8rem', textAlign: 'center', margin: '10px 0 14px' }}>Preview - use this photo or retake</p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={handleRetake} style={{ flex: 1, padding: '12px', borderRadius: '10px', background: 'rgba(255,255,255,0.06)', color: '#A1A1AA', border: '1px solid rgba(255,255,255,0.1)', fontWeight: 600, cursor: 'pointer' }}>Retake</button>
              <button onClick={() => capturedUrl && onCapture(capturedUrl)} style={{ flex: 2, padding: '12px', borderRadius: '10px', background: '#6366F1', color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' }}>Use This Photo</button>
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
    front: { file: null, preview: null, source: null },
    side: { file: null, preview: null, source: null },
    back: { file: null, preview: null, source: null },
  })
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [activeCameraSlot, setActiveCameraSlot] = useState<ViewKey | null>(null)

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

  function handleFileUpload(view: ViewKey, file: File) {
    const preview = URL.createObjectURL(file)
    setCaptures(prev => ({ ...prev, [view]: { file, preview, source: 'upload' } }))
    setUploadError(null)
  }

  function handleRetake(view: ViewKey) {
    const old = captures[view]
    if (old.preview && old.source === 'upload') URL.revokeObjectURL(old.preview)
    setCaptures(prev => ({ ...prev, [view]: { file: null, preview: null, source: null } }))
  }

  function handleCameraCapture(view: ViewKey, dataUrl: string) {
    setCaptures(prev => ({ ...prev, [view]: { file: null, preview: dataUrl, source: 'camera' } }))
    setActiveCameraSlot(null)
    setUploadError(null)
  }

  async function validateAndProceed() {
    if (!selectedClient) { setUploadError('Please select a client.'); return }
    if (!testMode) {
      if (!captures.front.preview) { setUploadError('Front view is required before proceeding.'); return }
      if (!captures.side.preview) { setUploadError('Side view is required before proceeding.'); return }
    }

    setUploadError(null)
    setProcessingError(null)
    setSubmitting(true)
    setStep(3)

    try {
      const clientId = selectedClient?.id

      // Run MediaPipe pose detection on each captured view → real PoseFrames.
      // (Lazy-imported so MediaPipe only loads when an assessment is submitted.)
      let frames: unknown[] | undefined = undefined
      if (!testMode) {
        const { detectPose } = await import('@/lib/pose/detect')
        frames = []
        for (const v of ['front', 'side', 'back'] as ViewKey[]) {
          const cap = captures[v]
          if (!cap.preview) continue
          frames.push(await detectPose(cap.preview, v))
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
        <Link href="/clients" style={{ color: '#6366F1', textDecoration: 'none', fontSize: '0.875rem', minHeight: '44px', display: 'inline-flex', alignItems: 'center' }}>← Back to Clients</Link>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#F5F5F5', margin: 0 }}>New Assessment</h1>
        {testMode && (
          <span style={{ padding: '3px 10px', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, color: '#6366F1' }}>
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
                  background: isActive ? '#6366F1' : isDone ? '#10B981' : 'rgba(255,255,255,0.08)',
                  border: '2px solid ' + (isActive ? '#6366F1' : isDone ? '#10B981' : 'rgba(255,255,255,0.15)'),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: isActive || isDone ? '#fff' : '#71717A',
                  fontSize: '0.85rem', fontWeight: 700, flexShrink: 0,
                }}>
                  {isDone ? '✓' : stepNum}
                </div>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: isActive ? '#6366F1' : isDone ? '#10B981' : '#71717A', whiteSpace: 'nowrap' }}>{label}</span>
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
            <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', fontSize: '0.875rem', color: '#6366F1' }}>
              Test mode active — fixture landmarks will be used instead of MediaPipe.
            </div>
          )}
          <div style={{ background: '#161618', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '24px' }}>
            <input type="text" placeholder="Search clients by name..." value={clientSearch} onChange={e => setClientSearch(e.target.value)}
              style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#F5F5F5', fontSize: '0.95rem', outline: 'none', marginBottom: '16px', boxSizing: 'border-box', minHeight: '44px' }}
            />
            {loadingClients ? (
              <p style={{ color: '#A1A1AA', textAlign: 'center', padding: '24px 0', margin: 0 }}>Loading clients...</p>
            ) : filteredClients.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#A1A1AA' }}>
                {clientSearch ? 'No clients match your search.' : <span>No clients yet. <a href="/clients/new" style={{ color: '#6366F1' }}>Create a client</a></span>}
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
                        {isSelected && <span style={{ color: '#6366F1', marginLeft: '8px' }}>✓ Selected</span>}
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
                background: selectedClient ? '#6366F1' : 'rgba(99,102,241,0.25)',
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
            <strong style={{ color: '#6366F1' }}>Screening Tool Only</strong> — Posture AI is a screening tool. Results are for informational purposes only and are not a substitute for evaluation by a qualified professional. Consult a qualified health professional before making any clinical decisions.
          </div>

          {testMode ? (
            <div style={{ background: '#161618', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '24px' }}>
              <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
                <p style={{ color: '#6366F1', fontWeight: 600, margin: '0 0 8px' }}>Test Mode Active</p>
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
            <button onClick={validateAndProceed} disabled={submitting} style={{ padding: '12px 28px', borderRadius: '10px', background: submitting ? 'rgba(99,102,241,0.4)' : '#6366F1', color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.95rem', cursor: submitting ? 'not-allowed' : 'pointer', minHeight: '44px' }}>
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
                  padding: '12px 24px', borderRadius: '10px', background: '#6366F1', color: '#fff',
                  border: 'none', fontWeight: 600, cursor: 'pointer', minHeight: '44px',
                }}>Try Again</button>
              </div>
            </div>
          ) : (
            // Loading spinner + status
            <div>
              <div style={{ width: '64px', height: '64px', border: '4px solid rgba(99,102,241,0.2)', borderTop: '4px solid #6366F1', borderRadius: '50%', margin: '0 auto 24px', animation: 'spin 1s linear infinite' }} />
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
          onCapture={(dataUrl) => handleCameraCapture(activeCameraSlot, dataUrl)}
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

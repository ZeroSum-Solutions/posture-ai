'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { assessPosture } from '@/lib/posture-engine'
import type { AssessmentResult, PoseFrame, Zone } from '@/lib/posture-engine'
import TEST_FIXTURE from '@/lib/posture-engine/fixtures/test-landmarks.json'

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
          <span style={{ fontSize: '2rem' }}>Photo</span>
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
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#A1A1AA', fontSize: '1.3rem', cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}>X</button>
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

// ---- Results Display ----
function AssessmentResultsDisplay({ result, clientName }: { result: AssessmentResult; clientName: string }) {
  const gradeColor = result.overallGrade === 'S' || result.overallGrade === 'A'
    ? '#22C55E'
    : result.overallGrade === 'B' || result.overallGrade === 'C'
    ? '#F59E0B'
    : '#EF4444'

  const regionOrder: Record<string, number> = { head_shoulders: 0, spine: 1, pelvis: 2, leg: 3 }
  const regionLabel: Record<string, string> = {
    head_shoulders: 'Head & Shoulders',
    spine: 'Spine',
    pelvis: 'Pelvis',
    leg: 'Legs',
  }

  const grouped = result.findings.reduce((acc, f) => {
    if (!acc[f.region]) acc[f.region] = []
    acc[f.region].push(f)
    return acc
  }, {} as Record<string, typeof result.findings>)

  const regions = Object.keys(grouped).sort((a, b) => (regionOrder[a] ?? 99) - (regionOrder[b] ?? 99))

  return (
    <div>
      {/* Disclaimer banner */}
      <div style={{
        background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)',
        borderRadius: '10px', padding: '12px 16px', marginBottom: '24px', fontSize: '0.8rem', color: '#A1A1AA', lineHeight: 1.5,
      }}>
        <strong style={{ color: '#6366F1' }}>Screening Only</strong> — {result.disclaimer}
      </div>

      {/* Overall Rating */}
      <div style={{
        background: '#161618', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px',
        padding: '24px', marginBottom: '24px',
      }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#A1A1AA', marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Overall Rating — {clientName}
        </h2>
        <div style={{ display: 'flex', gap: '32px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Grade ring */}
          <div style={{ position: 'relative', width: '100px', height: '100px', flexShrink: 0 }}>
            <svg width="100" height="100" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
              <circle cx="50" cy="50" r="42" fill="none" stroke={gradeColor} strokeWidth="10"
                strokeDasharray={2 * Math.PI * 42} strokeDashoffset={2 * Math.PI * 42 * (result.overallScore / 100)}
                strokeLinecap="round" transform="rotate(-90 50 50)" />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '2rem', fontWeight: 900, color: gradeColor, lineHeight: 1 }}>{result.overallGrade}</span>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: '160px' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#F5F5F5', marginBottom: '4px' }}>
              Top {result.overallPercentile}%
            </div>
            <div style={{ fontSize: '0.875rem', color: '#A1A1AA', marginBottom: '16px' }}>
              Score: {result.overallScore}/100
            </div>
            {/* Grade band reference */}
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {(['S','A','B','C','D','E'] as const).map(g => (
                <span key={g} style={{
                  padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700,
                  background: g === result.overallGrade ? gradeColor : 'rgba(255,255,255,0.06)',
                  color: g === result.overallGrade ? '#fff' : '#71717A',
                }}>{g}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Skeletal diagram placeholder */}
      <div style={{
        background: '#161618', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px',
        padding: '24px', marginBottom: '24px',
      }}>
        <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#A1A1AA', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Skeletal Overview
        </h2>
        <div style={{ display: 'flex', gap: '24px', justifyContent: 'center', flexWrap: 'wrap' }}>
          {/* Front skeleton schematic */}
          <div style={{ textAlign: 'center' }}>
            <svg width="100" height="180" viewBox="0 0 100 180" style={{ display: 'block', margin: '0 auto' }}>
              {/* Head */}
              <circle cx="50" cy="15" r="12" fill="none" stroke="#A1A1AA" strokeWidth="2" />
              {/* Neck */}
              <line x1="50" y1="27" x2="50" y2="38" stroke="#A1A1AA" strokeWidth="2" />
              {/* Shoulders */}
              <line x1="20" y1="38" x2="80" y2="38" stroke="#A1A1AA" strokeWidth="2" />
              {/* Torso */}
              <line x1="50" y1="38" x2="50" y2="90" stroke="#A1A1AA" strokeWidth="2" />
              {/* Arms */}
              <line x1="20" y1="38" x2="10" y2="80" stroke="#A1A1AA" strokeWidth="1.5" />
              <line x1="80" y1="38" x2="90" y2="80" stroke="#A1A1AA" strokeWidth="1.5" />
              {/* Hips */}
              <line x1="30" y1="90" x2="70" y2="90" stroke="#A1A1AA" strokeWidth="2" />
              {/* Legs */}
              <line x1="35" y1="90" x2="32" y2="140" stroke="#A1A1AA" strokeWidth="1.5" />
              <line x1="65" y1="90" x2="68" y2="140" stroke="#A1A1AA" strokeWidth="1.5" />
              {/* Lower legs */}
              <line x1="32" y1="140" x2="30" y2="175" stroke="#A1A1AA" strokeWidth="1.5" />
              <line x1="68" y1="140" x2="70" y2="175" stroke="#A1A1AA" strokeWidth="1.5" />
              {/* Imbalance markers */}
              {result.findings.filter(f => f.viewUsed === 'front' && f.reliable && f.zone !== 'maintain').map(f => (
                <circle key={f.key} cx={f.region === 'head_shoulders' ? 50 : f.region === 'spine' ? 50 : f.region === 'pelvis' ? 50 : 50}
                  cy={f.region === 'head_shoulders' ? 38 : f.region === 'spine' ? 64 : f.region === 'pelvis' ? 90 : 130}
                  r="5" fill={ZONE_COLORS[f.zone]} opacity="0.7" />
              ))}
            </svg>
            <p style={{ fontSize: '0.72rem', color: '#71717A', margin: '6px 0 0' }}>Front View</p>
            <p style={{ fontSize: '0.65rem', color: '#4B5563', margin: '2px 0 0', maxWidth: '100px' }}>Rank: {result.ranks.front}th/100</p>
          </div>
          {/* Side skeleton schematic */}
          <div style={{ textAlign: 'center' }}>
            <svg width="80" height="180" viewBox="0 0 80 180" style={{ display: 'block', margin: '0 auto' }}>
              {/* Head */}
              <circle cx="45" cy="15" r="12" fill="none" stroke="#A1A1AA" strokeWidth="2" />
              {/* Neck */}
              <line x1="40" y1="27" x2="38" y2="38" stroke="#A1A1AA" strokeWidth="2" />
              {/* Spine curve */}
              <path d="M38,38 Q36,64 40,90" fill="none" stroke="#A1A1AA" strokeWidth="2" />
              {/* Hip */}
              <line x1="35" y1="90" x2="50" y2="90" stroke="#A1A1AA" strokeWidth="2" />
              {/* Leg */}
              <line x1="42" y1="90" x2="40" y2="140" stroke="#A1A1AA" strokeWidth="1.5" />
              <line x1="40" y1="140" x2="38" y2="175" stroke="#A1A1AA" strokeWidth="1.5" />
              {/* Foot */}
              <line x1="38" y1="175" x2="55" y2="175" stroke="#A1A1AA" strokeWidth="1.5" />
              {/* Imbalance markers */}
              {result.findings.filter(f => f.viewUsed === 'side' && f.reliable && f.zone !== 'maintain').map(f => (
                <circle key={f.key} cx={f.region === 'head_shoulders' ? 38 : 40}
                  cy={f.region === 'head_shoulders' ? 28 : f.region === 'spine' ? 64 : f.region === 'pelvis' ? 90 : 130}
                  r="5" fill={ZONE_COLORS[f.zone]} opacity="0.7" />
              ))}
            </svg>
            <p style={{ fontSize: '0.72rem', color: '#71717A', margin: '6px 0 0' }}>Side View</p>
            <p style={{ fontSize: '0.65rem', color: '#4B5563', margin: '2px 0 0' }}>Rank: {result.ranks.side}th/100</p>
          </div>
        </div>
        <p style={{ fontSize: '0.72rem', color: '#4B5563', textAlign: 'center', marginTop: '12px' }}>
          Colored dots indicate warning/danger zone imbalances. Diagrams are schematic, not literal measurements.
        </p>
      </div>

      {/* Imbalance cards */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#A1A1AA', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Body Imbalances
        </h2>
        {regions.map(region => (
          <div key={region} style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '0.8rem', fontWeight: 700, color: '#6366F1', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {regionLabel[region] ?? region}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {grouped[region].map(f => (
                <div key={f.key} style={{
                  background: '#161618', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '12px', padding: '16px',
                  borderLeft: '3px solid ' + ZONE_COLORS[f.zone],
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                    <div>
                      <span style={{ fontWeight: 600, color: '#F5F5F5', fontSize: '0.9rem' }}>{f.label}</span>
                      <span style={{ marginLeft: '8px', fontSize: '0.78rem', color: '#A1A1AA' }}>({f.viewUsed} view)</span>
                    </div>
                    <span style={{
                      padding: '2px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700,
                      background: ZONE_COLORS[f.zone] + '22',
                      color: ZONE_COLORS[f.zone], textTransform: 'uppercase',
                    }}>{f.zone}</span>
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#D4D4D8', marginBottom: '10px' }}>
                    <strong>{f.deviation.toFixed(1)}&deg;</strong> deviation
                    {f.direction !== 'Neutral' && <span style={{ color: '#A1A1AA' }}> — {f.direction}</span>}
                    <span style={{ color: '#71717A' }}> (standard: 0&deg;)</span>
                  </div>
                  {/* Risk bar */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '0.72rem', color: '#71717A' }}>Severity</span>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: ZONE_COLORS[f.zone] }}>{f.severityPct}%</span>
                    </div>
                    <div style={{ height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: f.reliable ? f.severityPct + '%' : '0%',
                        background: f.zone === 'maintain' ? '#22C55E' : f.zone === 'warning' ? '#F59E0B' : f.zone === 'danger' ? '#EF4444' : '#71717A',
                        borderRadius: '3px', transition: 'width 0.5s ease',
                      }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                      <span style={{ fontSize: '0.65rem', color: '#22C55E' }}>Maintain</span>
                      <span style={{ fontSize: '0.65rem', color: '#F59E0B' }}>Warning</span>
                      <span style={{ fontSize: '0.65rem', color: '#EF4444' }}>Danger</span>
                    </div>
                  </div>
                  {!f.reliable && (
                    <p style={{ fontSize: '0.75rem', color: '#71717A', margin: '8px 0 0', fontStyle: 'italic' }}>
                      Insufficient landmark visibility for this metric.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Disclaimer footer */}
      <div style={{
        background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)',
        borderRadius: '10px', padding: '12px 16px', fontSize: '0.78rem', color: '#71717A', lineHeight: 1.5,
      }}>
        <strong style={{ color: '#EF4444' }}>SCREENING ONLY.</strong> {result.disclaimer}
      </div>
    </div>
  )
}

// ---- Main Wizard ----
export default function NewAssessmentPage() {
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
  const [assessmentResult, setAssessmentResult] = useState<AssessmentResult | null>(null)

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

  function validateAndProceed() {
    if (testMode) {
      // Test mode: bypass image upload validation, use fixture
      setStep(3)
      setTimeout(() => {
        // Inject fixture landmarks and run engine (bypass MediaPipe)
        const frames = TEST_FIXTURE.frames as PoseFrame[]
        const result = assessPosture(frames)
        setAssessmentResult(result)
        setStep(4)
      }, 1500)
      return
    }
    if (!captures.front.preview) { setUploadError('Front view is required before proceeding.'); return }
    if (!captures.side.preview) { setUploadError('Side view is required before proceeding.'); return }
    setUploadError(null)
    setStep(3)
    // TODO: In production, upload images, extract landmarks with MediaPipe, run engine
    setTimeout(() => {
      // For now, run engine on fixture even in non-test mode (MediaPipe not yet integrated)
      const frames = TEST_FIXTURE.frames as PoseFrame[]
      const result = assessPosture(frames)
      setAssessmentResult(result)
      setStep(4)
    }, 2500)
  }

  const clientName = selectedClient
    ? selectedClient.first_name + ' ' + selectedClient.last_name
    : 'Client'

  return (
    <div style={{ padding: '24px 16px', maxWidth: '960px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <Link href="/clients" style={{ color: '#6366F1', textDecoration: 'none', fontSize: '0.875rem', minHeight: '44px', display: 'inline-flex', alignItems: 'center' }}>Back to Clients</Link>
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
                  {isDone ? 'v' : stepNum}
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
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#F5F5F5', margin: '0 0 4px' }}>Step 1 of {STEPS.length}: Select Client</h2>
            <p style={{ color: '#A1A1AA', fontSize: '0.875rem', margin: 0 }}>Search and select the client you are assessing.</p>
          </div>
          {testMode && (
            <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', fontSize: '0.875rem', color: '#6366F1' }}>
              Test mode active — fixture landmarks will be used instead of MediaPipe. No camera or file upload required.
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
                        {isSelected && <span style={{ color: '#6366F1', marginLeft: '8px' }}>Selected</span>}
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
            {testMode ? (
              <button onClick={() => setStep(2)} style={{
                padding: '12px 28px', borderRadius: '10px', background: '#6366F1',
                color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.95rem', cursor: 'pointer', minHeight: '44px',
              }}>Next: Confirm</button>
            ) : (
              <button onClick={() => selectedClient && setStep(2)} disabled={!selectedClient} style={{
                padding: '12px 28px', borderRadius: '10px',
                background: selectedClient ? '#6366F1' : 'rgba(99,102,241,0.25)',
                color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.95rem',
                cursor: selectedClient ? 'pointer' : 'not-allowed', minHeight: '44px',
              }}>Next: Upload Views</button>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Upload/Confirm */}
      {step === 2 && (
        <div>
          <div style={{ marginBottom: '16px' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#F5F5F5', margin: '0 0 4px' }}>
              {testMode ? 'Step 2 of 4: Confirm Test Mode' : 'Step 2 of 4: Upload Posture Views'}
            </h2>
            <p style={{ color: '#A1A1AA', fontSize: '0.875rem', margin: 0 }}>
              Client: <strong style={{ color: '#F5F5F5' }}>{clientName}</strong>
            </p>
          </div>

          {testMode ? (
            <div style={{ background: '#161618', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '24px' }}>
              <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
                <p style={{ color: '#6366F1', fontWeight: 600, margin: '0 0 8px' }}>Test Mode Active</p>
                <p style={{ color: '#A1A1AA', fontSize: '0.875rem', margin: 0 }}>
                  MediaPipe WASM will NOT be loaded. Pre-computed fixture landmarks from{' '}
                  <code style={{ fontSize: '0.8rem', background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: '4px' }}>
                    lib/posture-engine/fixtures/test-landmarks.json
                  </code>{' '}
                  will be injected directly into the scoring engine.
                </p>
              </div>
              <p style={{ color: '#A1A1AA', fontSize: '0.875rem', margin: 0 }}>
                Front and side view fixture data: 33 landmarks each with realistic posture deviations.
                Expected results: slight shoulder imbalance (warning), forward head posture (warning), T1 tilt (warning).
              </p>
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
            <button onClick={validateAndProceed} style={{ padding: '12px 28px', borderRadius: '10px', background: '#6366F1', color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.95rem', cursor: 'pointer', minHeight: '44px' }}>
              {testMode ? 'Run Test Analysis' : 'Analyze Posture'}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Processing */}
      {step === 3 && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ width: '64px', height: '64px', border: '4px solid rgba(99,102,241,0.2)', borderTop: '4px solid #6366F1', borderRadius: '50%', margin: '0 auto 24px', animation: 'spin 1s linear infinite' }} />
          <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
          <h2 style={{ color: '#F5F5F5', fontSize: '1.3rem', fontWeight: 700, marginBottom: '8px' }}>
            {testMode ? 'Running Test Analysis...' : 'Analyzing Posture...'}
          </h2>
          <p style={{ color: '#A1A1AA', margin: 0 }}>
            {testMode
              ? 'Injecting fixture landmarks and running scoring engine...'
              : 'Processing images for ' + clientName}
          </p>
        </div>
      )}

      {/* Step 4: Results */}
      {step === 4 && assessmentResult && (
        <div>
          <div style={{ marginBottom: '24px' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#F5F5F5', margin: '0 0 4px' }}>Assessment Results</h2>
            <p style={{ color: '#A1A1AA', fontSize: '0.875rem', margin: 0 }}>
              Posture analysis for <strong style={{ color: '#F5F5F5' }}>{clientName}</strong>
              {testMode && <span style={{ color: '#6366F1' }}> (test mode — fixture data)</span>}
            </p>
          </div>
          <AssessmentResultsDisplay result={assessmentResult} clientName={clientName} />
          <div style={{ marginTop: '24px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <Link href="/clients" style={{
              padding: '12px 24px', borderRadius: '10px', background: 'rgba(255,255,255,0.06)',
              color: '#A1A1AA', border: '1px solid rgba(255,255,255,0.1)',
              fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: '44px',
            }}>Back to Clients</Link>
            {testMode && (
              <button onClick={() => { setStep(1); setAssessmentResult(null) }} style={{
                padding: '12px 24px', borderRadius: '10px', background: 'rgba(99,102,241,0.12)',
                color: '#6366F1', border: '1px solid rgba(99,102,241,0.3)',
                fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', minHeight: '44px',
              }}>Run Again</button>
            )}
          </div>
        </div>
      )}

      {step === 4 && !assessmentResult && (
        <div style={{ textAlign: 'center', padding: '48px 24px' }}>
          <p style={{ color: '#A1A1AA' }}>Assessment complete. Results unavailable.</p>
          <Link href="/clients" style={{ color: '#6366F1' }}>Back to Clients</Link>
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

'use client'
import { useState, useEffect, useRef, Suspense } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { PoseFrame } from '@posture-ai/engine/types'
import { ageBand } from '@/lib/clients/age'
import { getConsentStatus, captureEligibility } from '@/lib/consent/record'
import FullScreenCapture from './FullScreenCapture'
import type { ViewKey, SlotStatus, Captures } from './types'

interface Client {
  id: string
  first_name: string
  last_name: string
  date_of_birth: string | null
}

const STEPS = ['Client', 'Upload Views', 'Processing', 'Results']

const IS_TEST_MODE = process.env.NEXT_PUBLIC_POSTURE_TEST_MODE === '1'

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
  const [ageGateError, setAgeGateError] = useState<string | null>(null)
  const [checkingConsent, setCheckingConsent] = useState(false)
  const [loadingClients, setLoadingClients] = useState(true)
  const [clientsError, setClientsError] = useState<string | null>(null)
  const [captures, setCaptures] = useState<Captures>({
    front: { file: null, preview: null, source: null, poseFrame: null, quality: null, slotStatus: 'idle', captureRollDeg: null, burstPreviews: null },
    side: { file: null, preview: null, source: null, poseFrame: null, quality: null, slotStatus: 'idle', captureRollDeg: null, burstPreviews: null },
    back: { file: null, preview: null, source: null, poseFrame: null, quality: null, slotStatus: 'idle', captureRollDeg: null, burstPreviews: null },
  })
  const [uploadError, setUploadError] = useState<string | null>(null)

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
      try {
        const { data, error } = await supabase
          .from('clients')
          .select('id, first_name, last_name, date_of_birth')
          .eq('practitioner_id', user.id)
          .is('archived_at', null)
          // Never offer an erased client in the picker — the assessment insert
          // would be rejected by the reject-deleted-client trigger anyway (QA-001).
          .is('deleted_at', null)
          .order('first_name')
        if (error) throw error
        const list = data || []
        setClients(list)
        if (preselectedClientId) {
          const pre = list.find(c => c.id === preselectedClientId)
          if (pre) setSelectedClient(pre)
        }
      } catch {
        setClientsError('Could not load your clients. Refresh to try again.')
      } finally {
        setLoadingClients(false)
      }
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
    // Track the latest scheduled poll (initial + every reschedule) so cleanup
    // can clear a queued timer instead of relying solely on the cancelled guard.
    let timer: ReturnType<typeof setTimeout> | undefined
    // Hard cap: scoring finishes in seconds; if a server-side write silently
    // stuck the row on 'processing', do not spin forever.
    let attempts = 0
    const MAX_ATTEMPTS = 45 // × 2s = 90s

    function reschedule() {
      if (++attempts >= MAX_ATTEMPTS) {
        setProcessingError('This is taking longer than expected. Please try the capture again.')
        return
      }
      timer = setTimeout(pollStatus, 2000)
    }

    async function pollStatus() {
      if (cancelled) return
      try {
        console.log('[wizard] Polling status for assessment:', assessmentId)
        const r = await fetch('/api/assessments/' + assessmentId + '/status')
        if (cancelled) return
        if (!r.ok) {
          setProcessingError('Failed to check assessment status.')
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
          // Still processing — poll again in 2s (bounded)
          reschedule()
        }
      } catch {
        if (cancelled) return
        reschedule()
      }
    }

    // Start polling after a brief delay (allow server to finish)
    timer = setTimeout(pollStatus, 800)
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

  // Monotonic preflight token per view: a re-capture/re-upload bumps the token so
  // a still-running preflight for the previous image discards its (now stale)
  // result instead of overwriting the newer slot.
  const preflightSeq = useRef<Record<string, number>>({})

  // Run detectPose + assessFrameQuality after each capture/upload
  async function runPreflight(view: ViewKey, preview: string, source: 'camera' | 'upload', captureRollDeg: number | null) {
    const token = (preflightSeq.current[view] ?? 0) + 1
    preflightSeq.current[view] = token
    const isStale = () => preflightSeq.current[view] !== token

    setCaptures(prev => ({
      ...prev,
      [view]: { ...prev[view], slotStatus: 'checking' },
    }))

    try {
      const { detectPose } = await import('@/lib/pose/detect')
      const { assessFrameQuality } = await import('@/lib/pose/quality')

      const detected = await detectPose(preview, view, source)
      if (isStale()) return
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
      if (isStale()) return
      // On model-load failure, don't block submission — mark idle
      setCaptures(prev => ({
        ...prev,
        [view]: { ...prev[view], slotStatus: 'idle' },
      }))
      setModelError(true)
    }
  }

  async function handleFileUpload(view: ViewKey, file: File) {
    const oldPreview = captures[view].preview
    const { normalizeUploadedImage } = await import('@/lib/pose/normalize-upload')
    const preview = (await normalizeUploadedImage(file)) ?? URL.createObjectURL(file)
    setCaptures(prev => ({
      ...prev,
      [view]: { file, preview, source: 'upload', poseFrame: null, quality: null, slotStatus: 'idle', captureRollDeg: null, burstPreviews: null },
    }))
    if (oldPreview && oldPreview.startsWith('blob:')) URL.revokeObjectURL(oldPreview)
    setUploadError(null)
    if (!testMode) runPreflight(view, preview, 'upload', null)
  }

  function handleCameraCapture(view: ViewKey, dataUrls: string[], captureRollDeg: number | null) {
    // dataUrls is the shutter burst; the representative (index 0) drives the
    // preview thumbnail + the fast quality preflight. Every frame is pose-detected
    // at submit so the engine can median them + report within-capture stability.
    const preview = dataUrls[0]
    setCaptures(prev => ({
      ...prev,
      [view]: { file: null, preview, source: 'camera', poseFrame: null, quality: null, slotStatus: 'idle', captureRollDeg, burstPreviews: dataUrls },
    }))
    setUploadError(null)
    if (!testMode) runPreflight(view, preview, 'camera', captureRollDeg)
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

      // Build the frame payload. A camera capture sends its whole shutter burst
      // (engine 1.3.0 medians them + scores within-capture stability); uploads
      // send a single frame. Landmarks only — no image bytes leave the device.
      let frames: unknown[] | undefined = undefined
      if (!testMode) {
        frames = []
        const { detectPose } = await import('@/lib/pose/detect')
        const withRoll = (f: PoseFrame, roll: number | null): PoseFrame =>
          roll !== null ? { ...f, captureRollDeg: roll } : f
        for (const v of ['front', 'side', 'back'] as ViewKey[]) {
          const cap = captures[v]
          if (!cap.preview) continue
          const burst = cap.source === 'camera' && cap.burstPreviews && cap.burstPreviews.length > 1
            ? cap.burstPreviews
            : null
          if (burst) {
            // Detect every frame of the burst (the representative was already
            // detected in preflight; re-detecting it here keeps the set uniform).
            for (const url of burst) {
              const detected = await detectPose(url, v, 'camera')
              frames.push(withRoll(detected, cap.captureRollDeg))
            }
          } else if (cap.poseFrame) {
            // Single frame from preflight — no re-detection needed.
            frames.push(cap.poseFrame)
          } else {
            // Preflight was skipped or failed — detect now.
            const detected = await detectPose(cap.preview, v, cap.source ?? 'upload')
            frames.push(withRoll(detected, cap.captureRollDeg))
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

  // Gate the camera on BIPA/subject consent, not just age. Biometric capture must
  // not begin before a valid consent is on record, so we verify it (via the same
  // authoritative getConsentStatus + captureEligibility the server enforces at
  // submit) BEFORE advancing to Step 2 and opening the camera. The server remains
  // the final gate; this stops biometric data from ever being captured for an
  // unconsented subject.
  async function proceedToCapture() {
    if (!selectedClient || checkingConsent) return
    const band = ageBand(selectedClient.date_of_birth)
    if (band === 'under_13') { setAgeGateError('Posture AI cannot be used to screen anyone under 13.'); return }
    if (band === 'unknown') { setAgeGateError('Add a date of birth for this client before screening.'); return }
    setAgeGateError(null)
    setCheckingConsent(true)
    try {
      const supabase = createSupabaseBrowserClient()
      const consent = await getConsentStatus(supabase, selectedClient.id)
      const eligibility = captureEligibility(selectedClient.date_of_birth, consent)
      if (!eligibility.ok) {
        setAgeGateError(eligibility.reason ?? 'This client is not eligible for screening yet.')
        return
      }
      setStep(2)
    } catch {
      setAgeGateError('Could not verify consent. Refresh and try again.')
    } finally {
      setCheckingConsent(false)
    }
  }

  const clientName = selectedClient
    ? selectedClient.first_name + ' ' + selectedClient.last_name
    : 'Client'

  // Non-test-mode Step 2 is the immersive full-screen camera; it renders as a
  // fixed overlay covering the wizard chrome below.
  const fullScreenCapture = step === 2 && !testMode

  return (
    <div className="app-standard-page">
      {!fullScreenCapture && (
        <>
          <div style={{ marginBottom: '24px' }}>
            <Link href="/clients" style={{ color: 'var(--brand)', textDecoration: 'none', fontSize: '0.875rem', minHeight: '44px', display: 'inline-flex', alignItems: 'center' }}>← Back to Clients</Link>
          </div>
          <p className="app-page-kicker">Guided capture</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <h1 className="app-page-heading" style={{ margin: 0 }}>New assessment</h1>
            {testMode && (
              <span style={{ padding: '3px 10px', background: 'rgba(0,152,243,0.15)', border: '1px solid rgba(0,152,243,0.35)', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--brand)' }}>
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
                      background: isActive ? 'var(--brand-strong)' : isDone ? '#10B981' : 'rgba(255,255,255,0.08)',
                      border: '2px solid ' + (isActive ? 'var(--brand)' : isDone ? '#10B981' : 'rgba(255,255,255,0.15)'),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: isActive || isDone ? '#fff' : 'var(--text-muted)',
                      fontSize: '0.85rem', fontWeight: 700, flexShrink: 0,
                    }}>
                      {isDone ? '✓' : stepNum}
                    </div>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: isActive ? 'var(--brand)' : isDone ? 'var(--maintain)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>{label}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div style={{ flex: 1, height: '2px', background: isDone ? '#10B981' : 'rgba(255,255,255,0.08)', margin: '14px 8px 0', minWidth: '16px' }} />
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Step 1: Select Client */}
      {step === 1 && (
        <div>
          <div style={{ marginBottom: '16px' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>Step 1: Select Client</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>Search and select the client you are assessing.</p>
          </div>
          {testMode && (
            <div style={{ background: 'rgba(0,152,243,0.08)', border: '1px solid rgba(0,152,243,0.25)', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', fontSize: '0.875rem', color: 'var(--brand)' }}>
              Test mode active — fixture landmarks will be used instead of MediaPipe.
            </div>
          )}
          <div className="app-panel" style={{ padding: '24px' }}>
            <div className="app-search-shell">
            <input type="text" placeholder="Search clients by name..." value={clientSearch} onChange={e => setClientSearch(e.target.value)}
              style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: 'var(--text-primary)', fontSize: '0.95rem', marginBottom: '16px', boxSizing: 'border-box', minHeight: '44px' }}
            />
            </div>
            {loadingClients ? (
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '24px 0', margin: 0 }}>Loading clients...</p>
            ) : clientsError ? (
              <p role="alert" style={{ color: 'var(--danger)', textAlign: 'center', padding: '24px 0', margin: 0 }}>{clientsError}</p>
            ) : filteredClients.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-secondary)' }}>
                {clientSearch ? 'No clients match your search.' : <span>No clients yet. <Link href="/clients/new" style={{ color: 'var(--brand)' }}>Create a client</Link></span>}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflowY: 'auto' }}>
                {filteredClients.map(c => {
                  const isSelected = selectedClient?.id === c.id
                  return (
                    <button key={c.id} onClick={() => setSelectedClient(c)} style={{
                      width: '100%', padding: '14px 16px', textAlign: 'left',
                      background: isSelected ? 'rgba(0,152,243,0.15)' : 'rgba(255,255,255,0.03)',
                      border: '1px solid ' + (isSelected ? 'var(--brand)' : 'rgba(255,255,255,0.08)'),
                      borderRadius: '10px', cursor: 'pointer', color: 'var(--text-primary)', transition: 'all 0.15s ease', minHeight: '44px',
                    }}>
                      <span style={{ display: 'block', fontSize: '0.95rem', fontWeight: isSelected ? 600 : 400 }}>
                        {c.first_name} {c.last_name}
                        {isSelected && <span style={{ color: 'var(--brand)', marginLeft: '8px' }}>✓ Selected</span>}
                      </span>
                      {c.date_of_birth && (
                        <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          DOB: {new Date(c.date_of_birth).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {ageGateError && (
            <div role="alert" style={{ marginTop: '16px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '12px', color: 'var(--danger)', fontSize: '0.875rem' }}>
              {ageGateError}
              {selectedClient && ageGateError.includes('date of birth') && (
                <>
                  {' '}
                  <Link href={`/clients/${selectedClient.id}/edit`} style={{ color: '#FCA5A5', fontWeight: 600, textDecoration: 'underline' }}>
                    Add it on their profile →
                  </Link>
                </>
              )}
              {selectedClient && ageGateError.toLowerCase().includes('consent') && (
                <>
                  {' '}
                  <Link href={`/clients/${selectedClient.id}`} style={{ color: '#FCA5A5', fontWeight: 600, textDecoration: 'underline' }}>
                    Record consent for this client →
                  </Link>
                </>
              )}
            </div>
          )}
          <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => { if (testMode) { setStep(2) } else { proceedToCapture() } }}
              disabled={!selectedClient || checkingConsent}
              style={{
                padding: '12px 28px', borderRadius: '10px',
                background: selectedClient && !checkingConsent ? 'var(--brand-strong)' : 'rgba(0,152,243,0.25)',
                color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.95rem',
                cursor: selectedClient && !checkingConsent ? 'pointer' : 'not-allowed', minHeight: '44px',
              }}>
              {checkingConsent ? 'Checking consent…' : testMode ? 'Next: Confirm' : 'Next: Upload Views'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Capture (full-screen camera) or Confirm (test mode) */}
      {step === 2 && (
        testMode ? (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>Step 2: Confirm Test Mode</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>Test mode — no client required</p>
            </div>
            <div style={{ background: 'var(--surface)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '24px' }}>
              <div style={{ background: 'rgba(0,152,243,0.08)', border: '1px solid rgba(0,152,243,0.25)', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
                <p style={{ color: 'var(--brand)', fontWeight: 600, margin: '0 0 8px' }}>Test Mode Active</p>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>
                  Pre-computed fixture landmarks will be injected directly into the scoring engine.
                  Results will be saved to the database and you will be redirected to the results page.
                </p>
              </div>
            </div>
            <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
              <button onClick={() => setStep(1)} style={{ padding: '12px 24px', borderRadius: '10px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.1)', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', minHeight: '44px' }}>Back</button>
              <button onClick={validateAndProceed} disabled={submitting} style={{ padding: '12px 28px', borderRadius: '10px', background: submitting ? 'rgba(0,152,243,0.4)' : 'var(--brand-strong)', color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.95rem', cursor: submitting ? 'not-allowed' : 'pointer', minHeight: '44px' }}>
                {submitting ? 'Submitting...' : 'Run Test Analysis'}
              </button>
            </div>
          </div>
        ) : (
          <FullScreenCapture
            captures={captures}
            onCameraCapture={handleCameraCapture}
            onFileUpload={handleFileUpload}
            onProceed={validateAndProceed}
            onExit={() => setStep(1)}
            modelLoading={modelLoading}
            modelError={modelError}
            submitting={submitting}
            uploadError={uploadError}
          />
        )
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
                <p style={{ color: 'var(--danger)', fontWeight: 700, fontSize: '1.1rem', margin: '0 0 8px' }}>Scoring Failed</p>
                <p style={{ color: 'var(--text-secondary)', margin: '0 0 20px' }}>{processingError}</p>
                <button onClick={handleRetry} style={{
                  padding: '12px 24px', borderRadius: '10px', background: 'var(--brand-strong)', color: '#fff',
                  border: 'none', fontWeight: 600, cursor: 'pointer', minHeight: '44px',
                }}>Try Again</button>
              </div>
            </div>
          ) : (
            // Loading spinner + status (announced to screen readers)
            <div role="status" aria-live="polite">
              <div aria-hidden="true" style={{ width: '64px', height: '64px', border: '4px solid rgba(0,152,243,0.2)', borderTop: '4px solid var(--brand)', borderRadius: '50%', margin: '0 auto 24px', animation: 'spin 1s linear infinite' }} />
              <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
              <h2 style={{ color: 'var(--text-primary)', fontSize: '1.3rem', fontWeight: 700, marginBottom: '8px' }}>
                {testMode ? 'Running Test Analysis...' : 'Analyzing Posture...'}
              </h2>
              <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                {assessmentId
                  ? 'Checking results...'
                  : testMode
                    ? 'Submitting assessment to server...'
                    : 'Processing images for ' + clientName
                }
              </p>
              {assessmentId && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '8px' }}>
                  Assessment ID: {assessmentId}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function NewAssessmentPage() {
  return (
    <Suspense fallback={<div style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</div>}>
      <NewAssessmentWizard />
    </Suspense>
  )
}

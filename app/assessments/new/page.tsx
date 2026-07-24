'use client'
import { memo, startTransition, useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { PoseFrame } from '@posture-ai/engine/types'
import { ageBand } from '@/lib/clients/age'
import FullScreenCapture from './FullScreenCapture'
import type { CaptureSlotKey, CaptureSlot, SlotStatus, Captures } from './types'
import { REQUIRED_SLOTS, SLOT_LABEL, slotToDomain, emptySlot, isCaptured } from './types'
import { buildFramePlan, stampFrame, toScoringFrame } from './framePlan'
import { revokeStaleUrls } from '@/lib/capture/object-urls'
import { mergePreflightQuality } from '@/lib/capture/pixel-quality'
import type { PixelQualityResult } from '@/lib/capture/pixel-quality'
import { syncPixelQualityTestHooks } from '@/lib/capture/pixel-quality-test-hooks'
import { createSubmissionGuard } from '@/lib/capture/submission-guard'
import InPersonConsentForm from '@/components/InPersonConsentForm'
import useLegalDocument from '@/components/useLegalDocument'
import DebouncedSearchInput from '@/components/DebouncedSearchInput'

interface Client {
  id: string
  first_name: string
  last_name: string
  date_of_birth: string | null
}

interface ClientPageResponse {
  clients?: Client[]
  pagination?: { has_more?: boolean; next_cursor?: string | null }
  error?: string
}

const ClientResultButton = memo(function ClientResultButton({
  client,
  isSelected,
  onChoose,
}: {
  client: Client
  isSelected: boolean
  onChoose: (client: Client) => void
}) {
  return (
    <button onClick={() => onChoose(client)} style={{
      width: '100%', padding: '14px 16px', textAlign: 'left',
      background: isSelected ? 'rgba(0,152,243,0.15)' : 'rgba(255,255,255,0.03)',
      border: '1px solid ' + (isSelected ? 'var(--brand)' : 'rgba(255,255,255,0.08)'),
      borderRadius: '10px', cursor: 'pointer', color: 'var(--text-primary)', minHeight: '44px',
    }}>
      <span style={{ display: 'block', fontSize: '0.95rem', fontWeight: isSelected ? 600 : 400 }}>
        {client.first_name} {client.last_name}
        {isSelected && <span style={{ color: 'var(--brand)', marginLeft: '8px' }}>✓ Selected</span>}
      </span>
      {client.date_of_birth && (
        <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
          DOB: {new Date(client.date_of_birth).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}
        </span>
      )}
    </button>
  )
}, (previous, next) => (
  previous.client === next.client
  && previous.isSelected === next.isSelected
))

const STEPS = ['Client', 'Upload Views', 'Processing', 'Results']

const IS_TEST_MODE = process.env.NEXT_PUBLIC_POSTURE_TEST_MODE === '1'
const CONSENT_WORK_AFTER_FEEDBACK_MS = 250

function initialCaptures(): Captures {
  return {
    'front': emptySlot(),
    'side-left': emptySlot(),
    'side-right': emptySlot(),
    'back': emptySlot(),
  }
}

function afterBusyStatePaint(): Promise<void> {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      // A zero-delay task can still be coalesced ahead of presentation on a
      // throttled browser. Preserve a bounded feedback window so consent I/O
      // and the capture overlay cannot be charged to the initiating click.
      window.setTimeout(resolve, CONSENT_WORK_AFTER_FEEDBACK_MS)
    })
  })
}

function ConsentAdvanceButton({
  disabled,
  testMode,
  onTestAdvance,
  onProceed,
}: {
  disabled: boolean
  testMode: boolean
  onTestAdvance: () => void
  onProceed: () => Promise<void>
}) {
  const [checking, setChecking] = useState(false)
  const checkingLock = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function handleClick() {
    if (disabled || checkingLock.current) return
    if (testMode) {
      onTestAdvance()
      return
    }

    // Keep this feedback local so the browser can paint it without reconciling
    // the client search and picker. The parent still owns the authoritative
    // age/consent gates and its own synchronous duplicate-request lock.
    checkingLock.current = true
    setChecking(true)
    try {
      await afterBusyStatePaint()
      await onProceed()
    } finally {
      checkingLock.current = false
      if (mounted.current) setChecking(false)
    }
  }

  const unavailable = disabled || checking
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={unavailable}
      style={{
        padding: '12px 28px', borderRadius: '10px',
        background: unavailable ? 'rgba(0,152,243,0.25)' : 'var(--brand-strong)',
        color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.95rem',
        cursor: unavailable ? 'not-allowed' : 'pointer', minHeight: '44px',
      }}
    >
      {checking ? 'Checking consent…' : testMode ? 'Next: Confirm' : 'Next: Upload Views'}
    </button>
  )
}

// ---- Main Wizard ----
export function NewAssessmentWizard() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedClientId = searchParams.get('client_id')
  const testModeParam = searchParams.get('testMode') === '1'
  const testMode = IS_TEST_MODE || testModeParam

  const [step, setStep] = useState(1)
  const [clients, setClients] = useState<Client[]>([])
  const [clientSearch, setClientSearch] = useState('')
  const [clientSearchRevision, setClientSearchRevision] = useState(0)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const screeningNotice = useLegalDocument(
    'screening_notice',
    Boolean(selectedClient) && !testMode,
  )
  const [selectedClientError, setSelectedClientError] = useState<string | null>(null)
  const [ageGateError, setAgeGateError] = useState<string | null>(null)
  const [showConsentForm, setShowConsentForm] = useState(false)
  const [loadingClients, setLoadingClients] = useState(false)
  const [loadingMoreClients, setLoadingMoreClients] = useState(false)
  const [nextClientCursor, setNextClientCursor] = useState<string | null>(null)
  const [clientsError, setClientsError] = useState<string | null>(null)
  const [captures, setCaptures] = useState<Captures>(initialCaptures)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const checkingConsentLock = useRef(false)
  const selectedClientRef = useRef<Client | null>(null)
  const clientSelectionVersion = useRef(0)
  const captureSelectionLocked = useRef(false)
  const preselectedClientController = useRef<AbortController | null>(null)
  const consentRequestVersion = useRef(0)
  const consentRequestController = useRef<AbortController | null>(null)

  // Assessment API state
  const [assessmentId, setAssessmentId] = useState<string | null>(null)
  const [processingError, setProcessingError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // A synchronous lock closes the pre-render double-click window. Its stable ID
  // is also the server idempotency key for retries of unchanged capture content.
  const [submissionGuard] = useState(createSubmissionGuard)

  // Stable browser-performance boundary: entering the real capture step starts
  // camera readiness. This is deliberately not route navigation because the
  // route first presents client selection and consent gates.
  useEffect(() => {
    if (step !== 2 || testMode || typeof performance.mark !== 'function') return
    performance.clearMarks?.('assessment_capture_route_navigation_start')
    performance.clearMarks?.('pose_runtime_ready_for_first_inference')
    performance.mark('assessment_capture_route_navigation_start')
  }, [step, testMode])

  // Expose the production pixel-sampling + scoring functions for out-of-process
  // drivers (T1b calibration, T4b cross-engine spec) under the CLIENT test-mode
  // gate only — absent entirely in production (T2 §"Test-mode hooks").
  useEffect(() => {
    syncPixelQualityTestHooks(testMode)
    return () => syncPixelQualityTestHooks(false)
  }, [testMode])

  const clientRequestVersion = useRef(0)
  const clientSearchRequestInvalidated = useRef(false)
  const clientPageController = useRef<AbortController | null>(null)
  const loadMoreClientController = useRef<AbortController | null>(null)
  const invalidateConsentForSelection = useCallback((nextClientId: string) => {
    if (selectedClientRef.current?.id === nextClientId) return
    consentRequestVersion.current += 1
    consentRequestController.current?.abort()
    consentRequestController.current = null
    checkingConsentLock.current = false
  }, [])
  useEffect(() => () => {
    clientPageController.current?.abort()
    clientPageController.current = null
    loadMoreClientController.current?.abort()
    consentRequestVersion.current += 1
    consentRequestController.current?.abort()
    consentRequestController.current = null
    checkingConsentLock.current = false
  }, [])
  const fetchClientPage = useCallback(async (input: {
    search: string
    cursor?: string | null
    signal?: AbortSignal
  }): Promise<ClientPageResponse> => {
    const query = new URLSearchParams({ limit: '50' })
    if (input.search) query.set('search', input.search)
    if (input.cursor) query.set('cursor', input.cursor)
    const response = await fetch(`/api/clients?${query.toString()}`, {
      cache: 'no-store',
      signal: input.signal,
    })
    if (response.status === 401) {
      router.push('/auth/sign-in')
      throw new Error('Unauthorized')
    }
    const body = await response.json().catch(() => ({})) as ClientPageResponse
    if (!response.ok) throw new Error(body.error || 'Could not load clients.')
    return body
  }, [router])

  useEffect(() => {
    const version = ++clientRequestVersion.current
    const normalizedSearch = clientSearch.trim().replace(/\s+/g, ' ')
    clientPageController.current?.abort()
    clientPageController.current = null
    if (!normalizedSearch) {
      startTransition(() => {
        setClients([])
        setNextClientCursor(null)
        setClientsError(null)
        setLoadingClients(false)
      })
      return
    }
    const controller = new AbortController()
    clientPageController.current = controller
    const timer = window.setTimeout(async () => {
      try {
        const body = await fetchClientPage({ search: normalizedSearch, signal: controller.signal })
        if (controller.signal.aborted || clientRequestVersion.current !== version) return
        startTransition(() => {
          setClients(body.clients ?? [])
          setNextClientCursor(body.pagination?.has_more ? body.pagination.next_cursor ?? null : null)
          setClientsError(null)
          setLoadingClients(false)
        })
      } catch (caught) {
        if ((caught as Error)?.name === 'AbortError' || clientRequestVersion.current !== version) return
        startTransition(() => {
          setClients([])
          setNextClientCursor(null)
          if ((caught as Error)?.message !== 'Unauthorized') {
            setClientsError('Could not load your clients. Refresh to try again.')
          }
          setLoadingClients(false)
        })
      } finally {
        if (clientPageController.current === controller) {
          clientPageController.current = null
        }
      }
    }, 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
      if (clientPageController.current === controller) {
        clientPageController.current = null
      }
    }
  }, [clientSearch, clientSearchRevision, fetchClientPage])

  // A deep-linked client may be on page 2 or page 200. Fetch that exact owned,
  // active record instead of requiring it to appear in the first directory page.
  useEffect(() => {
    if (!preselectedClientId) return
    const controller = new AbortController()
    const selectionVersionAtRequest = clientSelectionVersion.current
    preselectedClientController.current?.abort()
    preselectedClientController.current = controller
    const selectionIsStale = () => (
      controller.signal.aborted
      || captureSelectionLocked.current
      || clientSelectionVersion.current !== selectionVersionAtRequest
      || selectedClientRef.current !== null
    )
    fetch(`/api/clients/${encodeURIComponent(preselectedClientId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          router.push('/auth/sign-in')
          return null
        }
        if (!response.ok) throw new Error('Preselected client is unavailable')
        return response.json() as Promise<{ client?: Client }>
      })
      .then((body) => {
        if (body?.client && !selectionIsStale()) {
          clientSelectionVersion.current += 1
          invalidateConsentForSelection(body.client.id)
          selectedClientRef.current = body.client
          setSelectedClient(body.client)
          setSelectedClientError(null)
        }
      })
      .catch((caught) => {
        if ((caught as Error)?.name !== 'AbortError' && !selectionIsStale()) {
          setSelectedClientError('The selected client is unavailable. Choose another active client.')
        }
      })
      .finally(() => {
        if (preselectedClientController.current === controller) {
          preselectedClientController.current = null
        }
      })
    return () => {
      controller.abort()
      if (preselectedClientController.current === controller) {
        preselectedClientController.current = null
      }
    }
  }, [preselectedClientId, router, invalidateConsentForSelection])

  async function loadMoreClientOptions() {
    if (!nextClientCursor || loadingMoreClients) return
    const version = clientRequestVersion.current
    loadMoreClientController.current?.abort()
    const controller = new AbortController()
    loadMoreClientController.current = controller
    setLoadingMoreClients(true)
    try {
      const body = await fetchClientPage({
        search: clientSearch.trim().replace(/\s+/g, ' '),
        cursor: nextClientCursor,
        signal: controller.signal,
      })
      if (clientRequestVersion.current !== version) return
      setClients((current) => {
        const seen = new Set(current.map((client) => client.id))
        return [...current, ...(body.clients ?? []).filter((client) => !seen.has(client.id))]
      })
      setNextClientCursor(body.pagination?.has_more ? body.pagination.next_cursor ?? null : null)
    } catch (caught) {
      if ((caught as Error)?.name !== 'AbortError' && clientRequestVersion.current === version && (caught as Error)?.message !== 'Unauthorized') {
        setClientsError('Could not load more clients. Try again.')
      }
    } finally {
      if (loadMoreClientController.current === controller) {
        loadMoreClientController.current = null
        setLoadingMoreClients(false)
      }
    }
  }

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
          // The server confirmed a terminal row. A retry is a new scoring
          // attempt, not an ambiguous transport replay, so rotate the key.
          submissionGuard.contentChanged()
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
  }, [step, assessmentId, router, submissionGuard])

  // Monotonic op token per slot: every capture/upload bumps it, so a still-running
  // async commit for a SUPERSEDED capture — a preflight, or an upload's image
  // normalization — discards its result instead of overwriting the newer one.
  const commitSeq = useRef<Record<string, number>>({})
  const nextOp = (slot: CaptureSlotKey) => (commitSeq.current[slot] = (commitSeq.current[slot] ?? 0) + 1)

  // Mirror the latest captures for revocation + unmount cleanup, so object-URL
  // teardown never reads a stale closure.
  const capturesRef = useRef(captures)
  useEffect(() => { capturesRef.current = captures }, [captures])
  // False once the wizard unmounts — an upload still normalizing then must not
  // commit (setState-on-unmounted) nor leak its just-minted blob.
  const mountedRef = useRef(true)

  // Revoke every committed object URL when the wizard unmounts (SPA navigation to
  // results). Committed URLs live in `captures` — the capture overlay only revokes
  // its own uncommitted burst — so without this they leak until document unload.
  useEffect(() => {
    const ref = capturesRef
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      for (const slot of Object.values(ref.current)) {
        revokeStaleUrls([slot.rawRepresentativeUrl, slot.displayPreviewUrl, ...(slot.rawBurstUrls ?? [])], new Set())
      }
      // Close any resident landmarker (worker VIDEO or scoring IMAGE) so neither
      // backend outlives the wizard (§11.1 error/unmount path).
      void import('@/lib/pose/capture-runtime').then(m => m.getCaptureRuntime().dispose()).catch(() => {})
    }
  }, [])

  // Revoke a slot's object URLs (raw + display + burst) that aren't reused, so a
  // re-capture/re-upload never leaks the superseded blobs.
  function revokeSlotUrls(slot: CaptureSlot, keep: Set<string>) {
    revokeStaleUrls([slot.rawRepresentativeUrl, slot.displayPreviewUrl, ...(slot.rawBurstUrls ?? [])], keep)
  }

  function chooseClient(client: Client) {
    if (captureSelectionLocked.current) return
    const previousClient = selectedClientRef.current
    clientSelectionVersion.current += 1
    preselectedClientController.current?.abort()
    preselectedClientController.current = null
    invalidateConsentForSelection(client.id)
    if (previousClient && previousClient.id !== client.id) {
      // A capture belongs to one subject. Switching subjects invalidates every
      // pending async result, revokes every photo URL, clears the four slots,
      // and rotates the digest-bound submission identity before capture resumes.
      for (const slot of REQUIRED_SLOTS) {
        nextOp(slot)
        revokeSlotUrls(capturesRef.current[slot], new Set())
      }
      setCaptures(initialCaptures())
      submissionGuard.contentChanged()
      setAssessmentId(null)
      setProcessingError(null)
      setUploadError(null)
    }
    selectedClientRef.current = client
    setSelectedClient(client)
    setSelectedClientError(null)
    setAgeGateError(null)
    setShowConsentForm(false)
  }

  // Run detectPose + assessFrameQuality after each capture/upload on the RAW
  // still (never the display channel — design §4.3). `token` ties the result to
  // its capture; a newer capture bumps commitSeq and staleness-invalidates it.
  async function runPreflight(slot: CaptureSlotKey, rawUrl: string, source: 'camera' | 'upload', captureRollDeg: number | null, token: number, pixelQuality: PixelQualityResult | null) {
    const isStale = () => commitSeq.current[slot] !== token
    const { view, profileSide } = slotToDomain(slot)

    setCaptures(prev => ({ ...prev, [slot]: { ...prev[slot], slotStatus: 'checking' } }))

    try {
      const { getCaptureRuntime } = await import('@/lib/pose/capture-runtime')
      const { assessFrameQuality } = await import('@/lib/pose/quality')

      // Route through the runtime owner: it closes the live worker and warms the
      // IMAGE landmarker first, and serializes so a concurrent enterLive can't
      // close the landmarker mid-detection (§11.1).
      const detected = await getCaptureRuntime().detect(rawUrl, view, source)
      if (isStale()) return
      const rawPoseFrame: PoseFrame = {
        ...detected,
        ...(profileSide ? { profileSide } : {}),
        ...(captureRollDeg !== null ? { captureRollDeg } : {}),
      }
      // Merge in the slot's precomputed pixel-quality metrics (T2) — synchronous,
      // no new await; the merge is pure and total over these input types, so it
      // can never throw and never trips the catch below into setModelError(true)
      // (Product constraints: sampling/scoring failure fails open, never blocks).
      const quality = mergePreflightQuality(assessFrameQuality(rawPoseFrame, view), pixelQuality)

      const slotStatus: SlotStatus = quality.status === 'no_person' ? 'no_person'
        : quality.status === 'multiple_people' ? 'multiple_people'
        : quality.status === 'warnings' ? 'warnings'
        : 'ok'

      setCaptures(prev => ({ ...prev, [slot]: { ...prev[slot], rawPoseFrame, quality, slotStatus } }))
    } catch (err) {
      console.error('[wizard] preflight error:', err)
      if (isStale()) return
      // A model failure is a hard validation failure. Keep the capture and reason
      // so the user can retry without losing the photo, but never submit it unchecked.
      setCaptures(prev => ({ ...prev, [slot]: { ...prev[slot], slotStatus: 'model_error' } }))
    }
  }

  async function retryFailedChecks() {
    for (const slot of REQUIRED_SLOTS) {
      const capture = capturesRef.current[slot]
      if (capture.slotStatus !== 'model_error' || !capture.rawRepresentativeUrl || !capture.source || capture.captureId === null) continue
      await runPreflight(
        slot,
        capture.rawRepresentativeUrl,
        capture.source,
        capture.captureRollDeg,
        capture.captureId,
        capture.pixelQuality,
      )
    }
  }

  async function handleFileUpload(slot: CaptureSlotKey, file: File) {
    const op = nextOp(slot)
    const { normalizeUploadedImage } = await import('@/lib/pose/normalize-upload')
    const normalized = await normalizeUploadedImage(file)
    const rawUrl = normalized?.dataUrl ?? URL.createObjectURL(file)
    const pixelQuality = normalized?.pixelQuality ?? null
    // Superseded by a newer capture/upload for this slot, or the wizard unmounted,
    // while we were normalizing — discard this one (and its blob) instead of
    // clobbering the newer result or committing to an unmounted tree.
    if (!mountedRef.current || commitSeq.current[slot] !== op) {
      if (rawUrl.startsWith('blob:')) URL.revokeObjectURL(rawUrl)
      return
    }
    const prevSlot = capturesRef.current[slot]
    setCaptures(prev => ({
      ...prev,
      [slot]: { ...emptySlot(), file, source: 'upload', captureId: op, rawRepresentativeUrl: rawUrl, displayPreviewUrl: rawUrl, pixelQuality },
    }))
    submissionGuard.contentChanged()
    revokeSlotUrls(prevSlot, new Set([rawUrl]))
    setUploadError(null)
    if (!testMode) runPreflight(slot, rawUrl, 'upload', null, op, pixelQuality)
  }

  function handleCameraCapture(slot: CaptureSlotKey, burst: string[], captureRollDeg: number | null, representativePixelQuality: PixelQualityResult | null) {
    // burst is the shutter's raw object URLs; the representative (index 0) drives
    // the thumbnail + the fast quality preflight. Every frame is pose-detected at
    // submit so the engine can median them + report within-capture stability.
    const op = nextOp(slot)
    const prevSlot = capturesRef.current[slot]
    const rep = burst[0]
    setCaptures(prev => ({
      ...prev,
      [slot]: { ...emptySlot(), source: 'camera', captureRollDeg, captureId: op, rawRepresentativeUrl: rep, rawBurstUrls: burst, displayPreviewUrl: rep, pixelQuality: representativePixelQuality },
    }))
    submissionGuard.contentChanged()
    revokeSlotUrls(prevSlot, new Set(burst))
    setUploadError(null)
    if (!testMode) runPreflight(slot, rep, 'camera', captureRollDeg, op, representativePixelQuality)
  }

  // Check if submit should be blocked: every required slot must have completed
  // authoritative preflight as either valid or a soft-warning capture.
  function hasBlockingSlot(): boolean {
    return REQUIRED_SLOTS.some(v => isCaptured(captures[v])
      && captures[v].slotStatus !== 'ok'
      && captures[v].slotStatus !== 'warnings')
  }

  async function validateAndProceed() {
    if (!selectedClient) { setUploadError('Please select a client.'); return }
    if (!testMode) {
      for (const slot of REQUIRED_SLOTS) {
        if (!isCaptured(captures[slot])) { setUploadError(`${SLOT_LABEL[slot]} view is required before proceeding.`); return }
      }
      if (hasBlockingSlot()) {
        setUploadError('Every required view must finish its model check and show exactly one person. Retry or retake the marked photos.')
        return
      }
    }

    const attempt = submissionGuard.tryBegin()
    if (!attempt) return

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
        const { getCaptureRuntime } = await import('@/lib/pose/capture-runtime')
        const { assessFrameQuality } = await import('@/lib/pose/quality')
        const runtime = getCaptureRuntime()
        // Detect + stamp per the pure plan (framePlan.ts). It reads ONLY the raw
        // channel, so both side slots POST as distinct `{view:'side', profileSide}`
        // groups (Slice 1) and a corrected display image can never reach detection.
        // All scoring detection goes through the runtime owner so the live worker
        // is closed and exactly one landmarker is resident (§11.1). The IMAGE
        // landmarker is released in `finally` even if a detection throws.
        try {
          for (const p of buildFramePlan(captures)) {
            if (p.burstUrls) {
              // Detect every frame of the burst (the representative was already
              // detected in preflight; re-detecting it here keeps the set uniform).
              for (const url of p.burstUrls) {
                const detected = await runtime.detect(url, p.view, 'camera')
                const quality = assessFrameQuality(detected, p.view)
                if (quality.status === 'no_person' || quality.status === 'multiple_people') {
                  throw new Error(`${SLOT_LABEL[p.slot]} must show exactly one person. Retake that view.`)
                }
                frames.push(stampFrame(detected, p.profileSide, p.roll))
              }
            } else if (p.cachedFrame) {
              // Single frame from preflight — already carries profileSide + roll.
              frames.push(toScoringFrame(p.cachedFrame))
            } else if (p.fallbackUrl) {
              // Preflight was skipped or failed — detect now.
              const detected = await runtime.detect(p.fallbackUrl, p.view, p.source ?? 'upload')
              const quality = assessFrameQuality(detected, p.view)
              if (quality.status === 'no_person' || quality.status === 'multiple_people') {
                throw new Error(`${SLOT_LABEL[p.slot]} must show exactly one person. Retake that view.`)
              }
              frames.push(stampFrame(detected, p.profileSide, p.roll))
            }
          }
        } finally {
          // Release the IMAGE landmarker whether scoring succeeded or threw — no
          // backend stays resident while we navigate to results.
          await runtime.dispose()
        }
      }

      const response = await fetch('/api/assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, test_mode: testMode, frames, submission_id: attempt.submissionId }),
      })

      if (!response.ok) {
        const err = await response.json()
        setProcessingError(err.error || 'Failed to create assessment.')
        submissionGuard.release(attempt)
        setSubmitting(false)
        return
      }

      const data = await response.json()
      if (data.status === 'failed') {
        setProcessingError(data.error || 'Scoring failed. Please retry this submission.')
        submissionGuard.release(attempt)
        // This terminal result is confirmed, not a lost-response ambiguity. A
        // user retry is a new scoring attempt and therefore needs a fresh key;
        // transport failures above intentionally retain the old key for replay.
        submissionGuard.contentChanged()
        setSubmitting(false)
        return
      }
      if (!submissionGuard.isCurrent(attempt)) return
      // The transport completed and returned the authoritative assessment id.
      // The synchronous lock is no longer needed while polling. Preserve the
      // same key so an ambiguous poll failure can replay this exact row.
      submissionGuard.release(attempt)
      console.log('[wizard] Assessment created:', data.id, 'status:', data.status)
      setAssessmentId(data.id)
      // Polling useEffect will take over from here
    } catch (err) {
      console.error('[wizard] Fetch error:', err)
      submissionGuard.release(attempt)
      setProcessingError(err instanceof Error && err.message
        ? err.message
        : 'Network or posture-model error. Please try again.')
    }
    setSubmitting(false)
  }

  function handleRetry() {
    setProcessingError(null)
    setAssessmentId(null)
    advanceToCapture()
  }

  function advanceToCapture() {
    captureSelectionLocked.current = true
    clientSelectionVersion.current += 1
    const pendingClientPage = clientPageController.current
    if (pendingClientPage) {
      // Capture does not need directory results, but returning to the picker
      // must restart this exact settled search instead of pairing its text with
      // the prior query's rows.
      clientSearchRequestInvalidated.current = true
      pendingClientPage.abort()
    }
    clientPageController.current = null
    setLoadingClients(false)
    preselectedClientController.current?.abort()
    preselectedClientController.current = null
    setStep(2)
  }

  function returnToSelection() {
    captureSelectionLocked.current = false
    if (clientSearchRequestInvalidated.current && clientSearch.trim()) {
      clientSearchRequestInvalidated.current = false
      setLoadingClients(true)
      setNextClientCursor(null)
      setClientSearchRevision((current) => current + 1)
    }
    setStep(1)
  }

  // Gate the camera on BIPA/subject consent, not just age. Biometric capture must
  // not begin before a valid consent is on record, so we verify it (via the same
  // authoritative server consent endpoint that the submit route also enforces)
  // BEFORE advancing to Step 2 and opening the camera. The server remains
  // the final gate; this stops biometric data from ever being captured for an
  // unconsented subject.
  async function proceedToCapture() {
    if (
      !selectedClient
      || selectedClientRef.current?.id !== selectedClient.id
      || checkingConsentLock.current
    ) return
    const consentClient = selectedClient
    const band = ageBand(consentClient.date_of_birth)
    if (band === 'under_13') { setShowConsentForm(false); setAgeGateError('Posture AI cannot be used to screen anyone under 13.'); return }
    if (band === 'unknown') { setShowConsentForm(false); setAgeGateError('Add a date of birth for this client before screening.'); return }
    setAgeGateError(null)
    // Close the duplicate-click window synchronously. The isolated button owns
    // its lightweight busy paint; this parent remains the authoritative gate.
    const requestVersion = ++consentRequestVersion.current
    const controller = new AbortController()
    consentRequestController.current?.abort()
    consentRequestController.current = controller
    checkingConsentLock.current = true
    const isCurrentSelection = () => (
      !controller.signal.aborted
      && consentRequestVersion.current === requestVersion
      && selectedClientRef.current?.id === consentClient.id
    )
    try {
      if (!screeningNotice.document) {
        throw new Error(screeningNotice.error || 'The required screening notice is still loading.')
      }
      const response = await fetch(`/api/consent?client_id=${encodeURIComponent(consentClient.id)}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!isCurrentSelection()) return
      const decision = await response.json().catch(() => ({})) as {
        captureAllowed?: boolean
        reason?: string | null
        error?: string
      }
      if (!isCurrentSelection()) return
      if (!response.ok) throw new Error(decision.error || 'Could not verify consent.')
      if (!decision.captureAllowed) {
        setShowConsentForm(true)
        setAgeGateError(decision.reason ?? 'This client is not eligible for screening yet.')
        return
      }
      setShowConsentForm(false)
      advanceToCapture()
    } catch (caught) {
      if ((caught as Error)?.name === 'AbortError' || !isCurrentSelection()) return
      setShowConsentForm(false)
      setAgeGateError(caught instanceof Error && caught.message
        ? caught.message
        : 'Could not verify consent. Refresh and try again.')
    } finally {
      if (consentRequestVersion.current === requestVersion) {
        consentRequestController.current = null
        checkingConsentLock.current = false
      }
    }
  }

  async function handleConsentRecorded() {
    setShowConsentForm(false)
    setAgeGateError(null)
    await proceedToCapture()
  }

  const clientName = selectedClient
    ? selectedClient.first_name + ' ' + selectedClient.last_name
    : 'Client'

  // Non-test-mode Step 2 is the immersive full-screen camera; it renders as a
  // fixed overlay covering the wizard chrome below.
  const fullScreenCapture = step === 2 && !testMode
  const modelError = Object.values(captures).some(capture => capture.slotStatus === 'model_error')

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
          <div
            className="app-panel"
            style={{
              padding: '24px',
              // This interactive list repaints on selection. Sampling the full
              // page through a large live blur made the paint dominate INP on
              // older devices; the existing layered background remains.
              WebkitBackdropFilter: 'none',
              backdropFilter: 'none',
            }}
          >
            <div className="app-search-shell">
            <DebouncedSearchInput
              placeholder="Search clients by name..."
              ariaLabel="Search clients by name"
              initialValue={clientSearch}
              onInputActivity={() => {
                // A settled search result must not render over the next query's
                // keystrokes. Abort it immediately while the input remains
                // DOM-owned and render-free.
                const controller = clientPageController.current
                if (!controller) return false
                clientRequestVersion.current += 1
                controller.abort()
                clientPageController.current = null
                clientSearchRequestInvalidated.current = true
                return true
              }}
              onQueryChange={(query) => {
              // Step 1 unmounts while capture is open. A remounted search input
              // is seeded from this settled query and must not strand the picker
              // in a loading state by re-emitting an unchanged value.
              const requestWasInvalidated = clientSearchRequestInvalidated.current
              clientSearchRequestInvalidated.current = false
              if (query === clientSearch && !requestWasInvalidated) return
              loadMoreClientController.current?.abort()
              loadMoreClientController.current = null
              setLoadingMoreClients(false)
              setLoadingClients(true)
              setNextClientCursor(null)
              if (query === clientSearch) {
                setClientSearchRevision((current) => current + 1)
              } else {
                setClientSearch(query)
              }
              }}
              style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: 'var(--text-primary)', fontSize: '0.95rem', marginBottom: '16px', boxSizing: 'border-box', minHeight: '44px' }}
            />
            </div>
            <div
              role="status"
              aria-hidden={selectedClient ? undefined : true}
              data-testid="selected-client-summary"
              style={{
                minHeight: '64px', boxSizing: 'border-box',
                marginBottom: '16px', padding: '12px 14px', borderRadius: '10px',
                background: 'rgba(0,152,243,0.12)', border: '1px solid rgba(0,152,243,0.35)',
                color: 'var(--text-primary)', visibility: selectedClient ? 'visible' : 'hidden',
              }}
            >
              <span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Selected client
              </span>
              <strong>{selectedClient ? `${selectedClient.first_name} ${selectedClient.last_name}` : 'No client selected'}</strong>
            </div>
            {selectedClientError && (
              <p role="alert" style={{ color: 'var(--danger)', margin: '0 0 16px' }}>{selectedClientError}</p>
            )}
            {loadingClients ? (
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '24px 0', margin: 0 }}>Loading clients...</p>
            ) : clientsError ? (
              <p role="alert" style={{ color: 'var(--danger)', textAlign: 'center', padding: '24px 0', margin: 0 }}>{clientsError}</p>
            ) : !clientSearch.trim() ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-secondary)' }}>
                Search by first or last name to select a client.{' '}
                <Link href="/clients/new" style={{ color: 'var(--brand)' }}>Create a client</Link>
              </div>
            ) : clients.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-secondary)' }}>
                No clients match your search.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflowY: 'auto' }}>
                {clients.map(c => {
                  const isSelected = selectedClient?.id === c.id
                  return (
                    <ClientResultButton
                      key={c.id}
                      client={c}
                      isSelected={isSelected}
                      onChoose={chooseClient}
                    />
                  )
                })}
                {nextClientCursor && (
                  <button
                    type="button"
                    onClick={loadMoreClientOptions}
                    disabled={loadingMoreClients}
                    style={{
                      width: '100%', padding: '12px 16px', borderRadius: '10px', minHeight: '44px',
                      background: 'rgba(255,255,255,0.05)', color: 'var(--brand)',
                      border: '1px solid rgba(0,152,243,0.28)', cursor: loadingMoreClients ? 'wait' : 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    {loadingMoreClients ? 'Loading…' : 'Load more clients'}
                  </button>
                )}
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
              {showConsentForm && ' Record consent below to continue.'}
            </div>
          )}
          {selectedClient && showConsentForm && (
            <InPersonConsentForm
              clientId={selectedClient.id}
              subjectName={`${selectedClient.first_name} ${selectedClient.last_name}`}
              submitLabel="Record Consent & Continue"
              onRecorded={handleConsentRecorded}
            />
          )}
          <p
            role={screeningNotice.error ? 'alert' : 'status'}
            aria-hidden={!selectedClient || testMode || Boolean(screeningNotice.document)}
            style={{
              minHeight: '22px',
              margin: '16px 0 0',
              color: screeningNotice.error ? 'var(--danger)' : 'var(--text-secondary)',
              fontSize: '0.8rem',
              visibility: selectedClient && !testMode && !screeningNotice.document ? 'visible' : 'hidden',
            }}
          >
            {screeningNotice.error ?? 'Loading required screening notice…'}
          </p>
          <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
            <ConsentAdvanceButton
              key={selectedClient?.id ?? 'no-client'}
              disabled={!selectedClient || (!testMode && !screeningNotice.document)}
              testMode={testMode}
              onTestAdvance={advanceToCapture}
              onProceed={proceedToCapture}
            />
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
              <button onClick={returnToSelection} style={{ padding: '12px 24px', borderRadius: '10px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.1)', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', minHeight: '44px' }}>Back</button>
              <button onClick={validateAndProceed} disabled={submitting} style={{ padding: '12px 28px', borderRadius: '10px', background: submitting ? 'rgba(0,152,243,0.4)' : 'var(--brand-strong)', color: '#fff', border: 'none', fontWeight: 600, fontSize: '0.95rem', cursor: submitting ? 'not-allowed' : 'pointer', minHeight: '44px' }}>
                {submitting ? 'Submitting...' : 'Run Test Analysis'}
              </button>
            </div>
          </div>
        ) : (
          <FullScreenCapture
            screeningNotice={screeningNotice.document!}
            captures={captures}
            onCameraCapture={handleCameraCapture}
            onFileUpload={handleFileUpload}
            onProceed={validateAndProceed}
            onExit={() => { void import('@/lib/pose/capture-runtime').then(m => m.getCaptureRuntime().dispose()).catch(() => {}); returnToSelection() }}
            modelError={modelError}
            onRetryFailedChecks={retryFailedChecks}
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

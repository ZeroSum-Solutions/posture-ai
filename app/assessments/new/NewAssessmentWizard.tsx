'use client'
import { memo, startTransition, useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { PoseFrame } from '@posture-ai/engine/types'
import type { OperationMode } from '@/lib/prototype/runtime'
import { ageBand } from '@/lib/clients/age'
import { parseAssessmentProcessingResult } from '@/lib/assessments/processingStatus'
import type { CaptureSlotKey, CaptureSlot, SlotStatus, Captures } from './types'
import { REQUIRED_SLOTS, SLOT_LABEL, slotToDomain, emptySlot, isCaptured } from './types'
import { analyzeCaptureFrames } from './analyzeFrames'
import { captureImageFromDataUrl, saveCaptureImages } from './saveCaptureImages'
import type { AnalysisProgress } from './analyzeFrames'
import { revokeStaleUrls } from '@/lib/capture/object-urls'
import { mergePreflightQuality } from '@/lib/capture/pixel-quality'
import type { PixelQualityResult } from '@/lib/capture/pixel-quality'
import { syncPixelQualityTestHooks } from '@/lib/capture/pixel-quality-test-hooks'
import { createSubmissionGuard } from '@/lib/capture/submission-guard'
import type { SubmissionAttempt } from '@/lib/capture/submission-guard'
import { validateCaptureUpload } from '@/lib/capture/upload-validation'
import InPersonConsentForm from '@/components/InPersonConsentForm'
import useLegalDocument from '@/components/useLegalDocument'
import Icon from '@/components/array/Icon'
import type { CSSProperties } from 'react'
import {
  TopBar,
  SearchField,
  Button,
  ActionBar,
  Banner,
  EmptyState,
  ErrorState,
  BlobLoader,
  Lens,
  ProgressBar,
  Skeleton,
} from '@/components/ui'
import { mergeAndRankClientMatches } from './clientSearch'
import { Initials, ScanViewfinder } from './ScanViewfinder'
import styles from './NewAssessment.module.css'

// Rows stagger in 30ms apart, capped at 8 (DESIGN.md › Motion rule 7).
const STAGGER_CAP = 8

// The capture screen only opens after a client is chosen; load it on demand to
// keep the route inside its initial-JS budget.
const FullScreenCapture = dynamic(() => import('./FullScreenCapture'))

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

function formatDob(dateOfBirth: string | null): string | undefined {
  return dateOfBirth
    ? `DOB ${new Date(dateOfBirth).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}`
    : undefined
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
  // Selection reads through a surface-3 plate + a trailing check, never
  // colour alone (DESIGN.md › Colour) — and never volt, which means "do this".
  const name = `${client.first_name} ${client.last_name}`
  const dob = formatDob(client.date_of_birth)
  return (
    <button type="button" className={styles.clientRow} aria-pressed={isSelected} onClick={() => onChoose(client)}>
      <Initials name={name} />
      <span className={styles.rowText}>
        <span className={styles.rowName}>{name}</span>
        {dob && <span className="t-label">{dob}</span>}
      </span>
      {isSelected && (
        <span className={styles.rowCheck} aria-hidden="true">
          <Icon name="check-circle-bold" size={22} />
        </span>
      )}
    </button>
  )
}, (previous, next) => (
  previous.client === next.client
  && previous.isSelected === next.isSelected
))

const IS_TEST_MODE = process.env.NEXT_PUBLIC_POSTURE_TEST_MODE === '1'
const CONSENT_WORK_AFTER_FEEDBACK_MS = 250
const LOCAL_ANALYSIS_TIMEOUT_MS = 90_000

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
  blockedReason,
  testMode,
  skipConsent,
  onTestAdvance,
  onProceed,
}: {
  /** When set, the button is blocked and states this reason above it (Button's own `disabledReason`). */
  blockedReason?: string
  testMode: boolean
  skipConsent: boolean
  onTestAdvance: () => void
  onProceed: () => Promise<void>
}) {
  const disabled = Boolean(blockedReason)
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
    if (skipConsent) {
      checkingLock.current = true
      try {
        await onProceed()
      } finally {
        checkingLock.current = false
      }
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

  return (
    <Button
      type="button"
      onClick={handleClick}
      variant="primary"
      size="lg"
      block
      loading={checking}
      disabledReason={!checking ? blockedReason : undefined}
      haptic={false}
    >
      {checking ? 'Checking consent…' : testMode ? 'Next: Confirm' : 'Choose capture method'}
    </Button>
  )
}

// ---- Main Wizard ----
export function NewAssessmentWizard({ operationMode = 'governed' }: { operationMode?: OperationMode }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedClientId = searchParams.get('client_id')
  const testModeParam = searchParams.get('testMode') === '1'
  const testMode = IS_TEST_MODE || testModeParam

  const [step, setStep] = useState(1)
  const [clients, setClients] = useState<Client[]>([])
  const recentClientsRef = useRef<Client[]>([])
  const [clientSearch, setClientSearch] = useState('')
  const [clientSearchRevision, setClientSearchRevision] = useState(0)
  const [clientListExpanded, setClientListExpanded] = useState(false)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const screeningNotice = useLegalDocument(
    'screening_notice',
    Boolean(selectedClient) && !testMode && operationMode === 'governed',
  )
  const [selectedClientError, setSelectedClientError] = useState<string | null>(null)
  const [ageGateError, setAgeGateError] = useState<string | null>(null)
  const [showConsentForm, setShowConsentForm] = useState(false)
  const [loadingClients, setLoadingClients] = useState(true)
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
  const [savingCaptureImages, setSavingCaptureImages] = useState(false)
  // Presentation only: the scoring row reported complete and the hard
  // navigation to the results is under way — the Lens blooms into a check.
  const [scanComplete, setScanComplete] = useState(false)
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null)
  // A synchronous lock closes the pre-render double-click window. Its stable ID
  // is also the server idempotency key for retries of unchanged capture content.
  const [submissionGuard] = useState(createSubmissionGuard)
  const analysisControlRef = useRef<{
    controller: AbortController
    attempt: SubmissionAttempt
    timeoutId: number
    cancelledByUser: boolean
    timedOut: boolean
  } | null>(null)

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
    const controller = new AbortController()
    clientPageController.current = controller
    const timer = window.setTimeout(async () => {
      try {
        const body = await fetchClientPage({ search: normalizedSearch, signal: controller.signal })
        if (controller.signal.aborted || clientRequestVersion.current !== version) return
        const pageClients = body.clients ?? []
        const visibleClients = normalizedSearch
          ? mergeAndRankClientMatches(recentClientsRef.current, pageClients, normalizedSearch)
          : pageClients
        if (!normalizedSearch) recentClientsRef.current = pageClients
        startTransition(() => {
          setClients(visibleClients)
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
        const merged = [...current, ...(body.clients ?? []).filter((client) => !seen.has(client.id))]
        if (!clientSearch.trim()) recentClientsRef.current = merged
        return merged
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
    const activeAssessmentId = assessmentId
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
        console.log('[wizard] Polling status for assessment:', activeAssessmentId)
        const r = await fetch('/api/assessments/' + activeAssessmentId + '/status')
        if (cancelled) return
        if (!r.ok) {
          setProcessingError('Failed to check assessment status.')
          return
        }
        const data: unknown = await r.json()
        const processing = parseAssessmentProcessingResult(data, activeAssessmentId)
        if (!processing) {
          setProcessingError('The assessment status response was invalid. Please refresh and try again.')
          return
        }
        console.log('[wizard] Assessment status:', processing.status)
        if (cancelled) return

        if (processing.status === 'complete') {
          setScanComplete(true)
          // A hard navigation commits the terminal results URL immediately and
          // cannot remain stranded behind an App Router data prefetch. The
          // results loader owns unavailable/incompatible finding presentation.
          window.location.assign('/assessments/' + activeAssessmentId)
        } else if (processing.status === 'failed') {
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
  // Uploads can arrive faster than the IMAGE landmarker initializes. Keep their
  // checks in one wizard-owned queue so one failed model startup does not cause
  // every waiting slot to repeat the full GPU→CPU startup deadline in turn.
  const preflightQueueRef = useRef<Promise<void>>(Promise.resolve())
  const preflightUnavailableRef = useRef(false)

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
      const analysis = analysisControlRef.current
      if (analysis) {
        window.clearTimeout(analysis.timeoutId)
        analysis.controller.abort()
        submissionGuard.release(analysis.attempt)
        analysisControlRef.current = null
      }
      for (const slot of Object.values(ref.current)) {
        revokeStaleUrls([slot.rawRepresentativeUrl, slot.displayPreviewUrl, ...(slot.rawBurstUrls ?? [])], new Set())
      }
      // Close any resident landmarker (worker VIDEO or scoring IMAGE) so neither
      // backend outlives the wizard (§11.1 error/unmount path).
      void import('@/lib/pose/capture-runtime').then(m => m.getCaptureRuntime().dispose()).catch(() => {})
    }
  }, [submissionGuard])

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
  async function runPreflight(
    slot: CaptureSlotKey,
    rawUrl: string,
    source: 'camera' | 'upload',
    captureRollDeg: number | null,
    token: number,
    pixelQuality: PixelQualityResult | null,
    poseInput: CaptureSlot['poseInput'],
  ) {
    const isStale = () => commitSeq.current[slot] !== token
    const { view, profileSide } = slotToDomain(slot)

    setCaptures(prev => ({ ...prev, [slot]: { ...prev[slot], slotStatus: 'checking' } }))

    const check = preflightQueueRef.current.then(async () => {
      if (isStale()) return
      if (preflightUnavailableRef.current) {
        setCaptures(prev => ({ ...prev, [slot]: { ...prev[slot], slotStatus: 'model_error' } }))
        return
      }
      try {
        const { getCaptureRuntime } = await import('@/lib/pose/capture-runtime')
        const { assessFrameQuality } = await import('@/lib/pose/quality')

        // Route through the runtime owner: it closes the live worker and warms the
        // IMAGE landmarker first, and serializes so a concurrent enterLive can't
        // close the landmarker mid-detection (§11.1).
        const detected = await getCaptureRuntime().detect(rawUrl, view, source, poseInput)
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
        preflightUnavailableRef.current = true
        // A model failure is a hard validation failure. Keep the capture and reason
        // so the user can retry without losing the photo, but never submit it unchecked.
        setCaptures(prev => ({ ...prev, [slot]: { ...prev[slot], slotStatus: 'model_error' } }))
      }
    })
    preflightQueueRef.current = check.catch(() => {})
    return check
  }

  async function retryFailedChecks() {
    preflightUnavailableRef.current = false
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
        capture.poseInput,
      )
    }
  }

  async function handleFileUpload(slot: CaptureSlotKey, file: File) {
    const op = nextOp(slot)
    let rawUrl: string | null = null
    try {
      await validateCaptureUpload(file)

      const bitmapDecoderAvailable = typeof createImageBitmap === 'function'
      const { normalizeUploadedImage } = await import('@/lib/pose/normalize-upload')
      const normalized = await normalizeUploadedImage(file)
      if (!normalized && bitmapDecoderAvailable) {
        throw new Error('The selected image could not be decoded. Choose another JPEG or PNG.')
      }
      rawUrl = normalized?.dataUrl ?? URL.createObjectURL(file)
      const rawImage = normalized ? captureImageFromDataUrl(normalized.dataUrl) : file
      const pixelQuality = normalized?.pixelQuality ?? null
      const poseInput: NonNullable<CaptureSlot['poseInput']> = normalized?.poseInput ?? {
        sourceWidthPx: null,
        sourceHeightPx: null,
        orientationNormalization: 'browser_decoder',
        analysisMirrored: false,
        displayMirrored: false,
        requestedCameraFacingMode: null,
        observedCameraFacingMode: null,
      }
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
        [slot]: {
          ...emptySlot(), file, source: 'upload', captureId: op, poseInput,
          rawRepresentativeUrl: rawUrl, rawRepresentativeImage: rawImage,
          displayPreviewUrl: rawUrl, pixelQuality,
        },
      }))
      submissionGuard.contentChanged()
      revokeSlotUrls(prevSlot, new Set([rawUrl]))
      setUploadError(null)
      if (!testMode) void runPreflight(slot, rawUrl, 'upload', null, op, pixelQuality, poseInput)
    } catch (caught) {
      if (rawUrl?.startsWith('blob:')) URL.revokeObjectURL(rawUrl)
      const message = caught instanceof Error && caught.message
        ? caught.message
        : 'The selected image could not be prepared.'
      setUploadError(`${SLOT_LABEL[slot]}: ${message}`)
      throw caught
    }
  }

  function handleCameraCapture(
    slot: CaptureSlotKey,
    burst: string[],
    captureRollDeg: number | null,
    representativePixelQuality: PixelQualityResult | null,
    poseInput: NonNullable<CaptureSlot['poseInput']>,
    representativeImage: Blob,
  ) {
    // burst is the shutter's raw object URLs; the representative (index 0) drives
    // the thumbnail + the fast quality preflight. Every frame is pose-detected at
    // submit so the engine can median them + report within-capture stability.
    const op = nextOp(slot)
    const prevSlot = capturesRef.current[slot]
    const rep = burst[0]
    setCaptures(prev => ({
      ...prev,
      [slot]: {
        ...emptySlot(), source: 'camera', captureRollDeg, captureId: op, poseInput,
        rawRepresentativeUrl: rep, rawRepresentativeImage: representativeImage,
        rawBurstUrls: burst, displayPreviewUrl: rep,
        pixelQuality: representativePixelQuality,
      },
    }))
    submissionGuard.contentChanged()
    revokeSlotUrls(prevSlot, new Set(burst))
    setUploadError(null)
    if (!testMode) {
      runPreflight(slot, rep, 'camera', captureRollDeg, op, representativePixelQuality, poseInput)
    }
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
    setAnalysisProgress(null)
    setStep(3)

    const controller = new AbortController()
    const control = {
      controller,
      attempt,
      timeoutId: 0,
      cancelledByUser: false,
      timedOut: false,
    }
    control.timeoutId = window.setTimeout(() => {
      control.timedOut = true
      controller.abort()
    }, LOCAL_ANALYSIS_TIMEOUT_MS)
    analysisControlRef.current = control

    try {
      const clientId = selectedClient?.id

      // Build the frame payload. A camera capture sends its whole shutter burst
      // (engine 1.3.0 medians them + scores within-capture stability); uploads
      // send a single frame. Representative photographs are saved separately
      // after the server confirms the assessment identity.
      let frames: unknown[] | undefined = undefined
      if (!testMode) {
        const { getCaptureRuntime } = await import('@/lib/pose/capture-runtime')
        const { assessFrameQuality } = await import('@/lib/pose/quality')
        const runtime = getCaptureRuntime()
        try {
          frames = await analyzeCaptureFrames({
            captures,
            runtime,
            assessFrameQuality,
            signal: controller.signal,
            onProgress: progress => {
              if (!controller.signal.aborted) setAnalysisProgress(progress)
            },
          })
        } finally {
          // Release the IMAGE landmarker whether scoring succeeded or threw — no
          // backend stays resident while we navigate to results. On cancellation,
          // queue teardown without delaying the immediate return to capture.
          if (controller.signal.aborted) void runtime.dispose()
          else await runtime.dispose()
        }
      }

      if (controller.signal.aborted) throw new DOMException('Analysis cancelled', 'AbortError')
      setAnalysisProgress(null)

      const response = await fetch('/api/assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, test_mode: testMode, frames, submission_id: attempt.submissionId }),
        signal: controller.signal,
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
      if (!testMode) {
        setSavingCaptureImages(true)
        await saveCaptureImages({ assessmentId: data.id, captures, signal: controller.signal })
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
      submissionGuard.release(attempt)
      if (control.cancelledByUser) return
      if (control.timedOut) {
        setProcessingError('Posture processing timed out after 90 seconds. Return to the photos and try again.')
      } else {
        console.error('[wizard] Fetch error:', err)
        setProcessingError(err instanceof Error && err.message
          ? err.message
          : 'Network or posture-model error. Please try again.')
      }
    } finally {
      window.clearTimeout(control.timeoutId)
      if (analysisControlRef.current === control) analysisControlRef.current = null
      setSubmitting(false)
      setSavingCaptureImages(false)
    }
  }

  function cancelAnalysis() {
    const control = analysisControlRef.current
    if (!control) return
    control.cancelledByUser = true
    window.clearTimeout(control.timeoutId)
    control.controller.abort()
    submissionGuard.release(control.attempt)
    setAnalysisProgress(null)
    setSubmitting(false)
    setProcessingError(null)
    setAssessmentId(null)
    advanceToCapture()
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
    if (operationMode === 'prototype') {
      setAgeGateError(null)
      setShowConsentForm(false)
      advanceToCapture()
      return
    }
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
  const normalizedClientSearch = clientSearch.trim()
  const visibleClients = normalizedClientSearch || clientListExpanded ? clients : clients.slice(0, 4)
  // Stepper (spec §3.14): Client · Capture · Review. Step 3 (processing) reads
  // as "Review" — the operator's position has moved past capturing photos and
  // is now waiting on/reviewing the scoring result, not a 4th named step.
  const stepLabel = step === 1 ? 'Step 1 of 3 · Client' : step === 2 ? 'Step 2 of 3 · Capture' : 'Step 3 of 3 · Review'
  const continueBlockedReason = !selectedClient
    ? 'Choose a client to continue'
    : (!testMode && operationMode === 'governed' && !screeningNotice.document)
      ? 'Waiting for the required screening notice'
      : undefined

  const processingTitle = scanComplete
    ? 'Scan complete'
    : savingCaptureImages ? 'Saving capture photos…' : testMode ? 'Running Test Analysis...' : 'Analyzing Posture...'
  const processingDetail = scanComplete
    ? 'Opening the results…'
    : savingCaptureImages
      ? 'Saving your selected views with this screening…'
      : assessmentId
        ? 'Checking results...'
        : testMode
          ? 'Submitting assessment to server...'
          : analysisProgress
            ? `Analyzed ${analysisProgress.completed} of ${analysisProgress.total} frames — ${SLOT_LABEL[analysisProgress.slot]} view`
            : 'Preparing local analysis for ' + clientName

  return (
    <div className="app-screen">
      {!fullScreenCapture && step !== 3 && (
        <TopBar title="New assessment" back={{ href: '/clients', label: 'Back to Clients' }} />
      )}
      <div className="app-screen-x">

      {/* Step 1: Select Client */}
      {step === 1 && (
        <div className={styles.screen}>
          <ScanViewfinder
            stepLabel={stepLabel}
            testMode={testMode}
            subject={selectedClient
              ? { name: `${selectedClient.first_name} ${selectedClient.last_name}`, detail: formatDob(selectedClient.date_of_birth) }
              : null}
          />

          <div className={styles.clientStep}>
            <div className={styles.stepHead}>
              <h2 className="t-headline"><span className="sr-only">Step 1: </span>Select Client</h2>
              <Link href="/clients/new?returnTo=capture" className={styles.quiet}>
                <Icon name="add-circle-linear" size={20} />
                New client
              </Link>
            </div>

            {testMode && (
              <Banner variant="info">
                Test mode active — fixture landmarks will be used instead of MediaPipe.
              </Banner>
            )}

            <SearchField
              label="Search clients by name"
              placeholder="Search clients by name..."
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
                setClientListExpanded(false)
                setNextClientCursor(null)
                if (query === clientSearch) {
                  setClientSearchRevision((current) => current + 1)
                } else {
                  setClientSearch(query)
                }
              }}
            />

            {selectedClientError && <Banner variant="error">{selectedClientError}</Banner>}

            {loadingClients ? (
              <div className={styles.skeletons} role="status" aria-busy="true">
                <span className="sr-only">Loading clients...</span>
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className={styles.skeletonRow} aria-hidden="true">
                    <Skeleton shape="row" style={{ width: 40, height: 40, borderRadius: 'var(--r-full)' }} />
                    <div className={styles.skeletonText}>
                      <Skeleton shape="line" style={{ width: `${46 + ((index * 17) % 30)}%`, height: 16 }} />
                      <Skeleton shape="line" style={{ width: '34%', height: 12 }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : clientsError ? (
              <Banner variant="error">{clientsError}</Banner>
            ) : clients.length === 0 ? (
              <EmptyState
                icon="users-group-rounded-linear"
                variant="inline"
                title={normalizedClientSearch ? 'No matches' : 'No active clients yet'}
                body={normalizedClientSearch ? 'No clients match your search.' : 'Add a client to start a screening.'}
              />
            ) : (
              <div>
                <div className={styles.listHead}>
                  <h3 className="t-micro">
                    {normalizedClientSearch
                      ? `${clients.length} matching client${clients.length === 1 ? '' : 's'}`
                      : 'Recent'}
                  </h3>
                  {!normalizedClientSearch && clients.length > 4 && (
                    <button type="button" className={styles.quiet} onClick={() => setClientListExpanded(current => !current)}>
                      {clientListExpanded ? 'Show fewer' : `Show all ${clients.length} clients`}
                    </button>
                  )}
                </div>
                <ul className={styles.list} aria-label="Clients">
                  {visibleClients.map((c, index) => (
                    <li key={c.id} className={styles.item} style={{ '--i': Math.min(index, STAGGER_CAP) } as CSSProperties}>
                      <ClientResultButton
                        client={c}
                        isSelected={selectedClient?.id === c.id}
                        onChoose={chooseClient}
                      />
                    </li>
                  ))}
                </ul>
                {nextClientCursor && (
                  <button
                    type="button"
                    onClick={loadMoreClientOptions}
                    disabled={loadingMoreClients}
                    className={`${styles.quiet} ${styles.loadMore}`}
                  >
                    {loadingMoreClients ? 'Loading…' : 'Load more clients'}
                  </button>
                )}
              </div>
            )}

            {ageGateError && (
              <Banner variant="error">
                {ageGateError}
                {selectedClient && ageGateError.includes('date of birth') && (
                  <>
                    {' '}
                    <Link href={`/clients/${selectedClient.id}/edit`} className={styles.ageGateLink}>
                      Add it on their profile →
                    </Link>
                  </>
                )}
                {showConsentForm && ' Record consent below to continue.'}
              </Banner>
            )}

            {operationMode === 'governed' && selectedClient && showConsentForm && (
              <InPersonConsentForm
                clientId={selectedClient.id}
                subjectName={`${selectedClient.first_name} ${selectedClient.last_name}`}
                submitLabel="Record Consent & Continue"
                onRecorded={handleConsentRecorded}
              />
            )}

            <p
              role={screeningNotice.error ? 'alert' : 'status'}
              aria-hidden={!selectedClient || testMode || operationMode === 'prototype' || Boolean(screeningNotice.document)}
              className={`t-label ${styles.noticeLine}`}
              style={{
                color: screeningNotice.error ? 'var(--review)' : undefined,
                visibility: selectedClient && !testMode && operationMode === 'governed' && !screeningNotice.document ? 'visible' : 'hidden',
              }}
            >
              {screeningNotice.error ?? 'Loading required screening notice…'}
            </p>
          </div>

          <ActionBar>
            <ConsentAdvanceButton
              key={selectedClient?.id ?? 'no-client'}
              blockedReason={continueBlockedReason}
              testMode={testMode}
              skipConsent={operationMode === 'prototype'}
              onTestAdvance={advanceToCapture}
              onProceed={proceedToCapture}
            />
          </ActionBar>
        </div>
      )}

      {/* Step 2: Capture (full-screen camera) or Confirm (test mode) */}
      {step === 2 && (
        testMode ? (
          <div className={styles.screen}>
            <ScanViewfinder stepLabel={stepLabel} testMode={testMode} subject={null} />
            <div className={styles.testConfirmStep}>
              <h2 className="t-headline">Step 2: Confirm Test Mode</h2>
              <p className="t-body">Test mode — no client required</p>
              <p className="t-label">
                Pre-computed fixture landmarks will be injected directly into the scoring engine.
                Results will be saved to the database and you will be redirected to the results page.
              </p>
            </div>
            <ActionBar>
              <Button variant="secondary" onClick={returnToSelection} haptic={false}>Back</Button>
              <Button variant="primary" onClick={validateAndProceed} loading={submitting} haptic={false}>
                Run Test Analysis
              </Button>
            </ActionBar>
          </div>
        ) : (
          <FullScreenCapture
            screeningNotice={operationMode === 'prototype' ? null : screeningNotice.document!}
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

      {/* Step 3: Processing (with API polling) — the signature moment: the
          Lens works (squircle ⇄ circle) and blooms into a check on completion. */}
      {step === 3 && (
        processingError ? (
          <div className={styles.processing}>
            <ErrorState
              title="Screening needs attention"
              body={processingError}
              onRetry={handleRetry}
              retryLabel="Try Again"
              variant="page"
            />
          </div>
        ) : (
          <div className={styles.processing}>
            {scanComplete ? (
              <div className={styles.doneLens} role="status" aria-label="Scan complete">
                <Lens size={120} state="done" />
              </div>
            ) : (
              <BlobLoader label={processingDetail} size={120} />
            )}
            <div className={styles.processingCopy}>
              <span className="t-micro">{stepLabel}{selectedClient ? ` · ${clientName}` : ''}</span>
              <h2 className="t-title">{processingTitle}</h2>
              <p className="t-callout">{processingDetail}</p>
            </div>
            {!scanComplete && !assessmentId && !testMode && analysisProgress && (
              <ProgressBar
                className={styles.processingProgress}
                value={analysisProgress.completed / Math.max(1, analysisProgress.total)}
                label={`Analyzed ${analysisProgress.completed} of ${analysisProgress.total} frames`}
              />
            )}
            {assessmentId && (
              <p className="t-label">Assessment ID: {assessmentId}</p>
            )}
            {!assessmentId && !testMode && submitting && (
              <ActionBar>
                <Button variant="secondary" onClick={cancelAnalysis} haptic={false}>Cancel analysis</Button>
              </ActionBar>
            )}
          </div>
        )
      )}
      </div>
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

// @vitest-environment jsdom
//
// Follow-up to the T3 pixel-quality merge (FullScreenCapture.pixel-quality.test.tsx):
// the review-card warnings block only exists in the camera review phase, so an
// uploaded (or already-committed) slot's coaching copy never rendered outside
// that phase. This adds a compact, non-blocking caption near the slot strip
// for a committed slot with quality warnings.
//
// Seam: mount the full FullScreenCapture component (same jsdom browser-boundary
// stubs as the sibling pixel-quality test file) and assert on the new
// `slot-quality-caption` testid directly off the `captures` prop — the caption
// is a pure function of `captures`/`activeSlot`/`phase`, so most cases don't
// need to drive an actual capture.
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import FullScreenCapture from '../FullScreenCapture'
import { emptySlot } from '../types'
import type { Captures, CaptureSlotKey } from '../types'

vi.mock('@/lib/pose/capture-runtime', () => ({
  getCaptureRuntime: () => ({
    detect: vi.fn().mockResolvedValue({ landmarks: {} }),
    enterLive: vi.fn().mockResolvedValue(undefined),
    closeLive: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    frameLive: vi.fn(),
    state: vi.fn(() => 'idle'),
  }),
}))

// Neutral frame quality — the review-phase test drives a real capture, and this
// keeps its (unrelated) review-card content deterministic.
vi.mock('@/lib/pose/quality', () => ({
  assessFrameQuality: vi.fn(() => ({ status: 'ok', warnings: [] })),
}))

vi.mock('@/lib/capture/pixel-sample', () => ({
  samplePixelsFromSource: vi.fn(() => ({ width: 4, height: 4, data: new Uint8ClampedArray(64) })),
  MAX_SAMPLE_EDGE: 320,
}))

const BLUR_WARNING = 'Photo looks blurry — hold the camera steady and retake.'

function baseCaptures(overrides: Partial<Captures> = {}): Captures {
  return {
    'front': emptySlot(), 'side-left': emptySlot(), 'side-right': emptySlot(), 'back': emptySlot(),
    ...overrides,
  }
}

/** A committed slot with a single pixel-quality warning. */
function warnedSlot(): Captures[keyof Captures] {
  return {
    ...emptySlot(), source: 'upload', slotStatus: 'warnings', captureId: 1,
    rawRepresentativeUrl: 'blob:rep', displayPreviewUrl: 'blob:rep',
    quality: { status: 'warnings', warnings: [BLUR_WARNING] },
  }
}

function multiplePeopleSlot(): Captures[keyof Captures] {
  return {
    ...emptySlot(), source: 'upload', slotStatus: 'multiple_people', captureId: 1,
    rawRepresentativeUrl: 'blob:collage', displayPreviewUrl: 'blob:collage',
    quality: {
      status: 'multiple_people',
      warnings: ['More than one person detected — use one uncropped full-body photo per view.'],
    },
  }
}

/**
 * Stubs the browser boundary `capture()` touches — copied from
 * FullScreenCapture.pixel-quality.test.tsx's `stubBrowserBoundary` (same
 * pattern), trimmed to the no-encode-failure case this file needs to drive a
 * real capture into the review phase.
 */
function stubBrowserBoundary() {
  const originalGetUserMedia = (navigator as unknown as { mediaDevices?: unknown }).mediaDevices
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
      getVideoTracks: () => [{ addEventListener: vi.fn(), stop: vi.fn() }],
    }) },
  })

  const originalPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()) as unknown as typeof HTMLMediaElement.prototype.play

  const originalGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement, type: string) {
    if (type !== '2d') return null
    return { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext

  const originalToBlob = HTMLCanvasElement.prototype.toBlob
  HTMLCanvasElement.prototype.toBlob = vi.fn(function (cb: BlobCallback) {
    cb(new Blob(['x'], { type: 'image/jpeg' }))
  }) as unknown as typeof HTMLCanvasElement.prototype.toBlob

  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:frame-${n++}`)
  URL.revokeObjectURL = vi.fn()

  return {
    restore: () => {
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalGetUserMedia })
      HTMLMediaElement.prototype.play = originalPlay
      HTMLCanvasElement.prototype.getContext = originalGetContext
      HTMLCanvasElement.prototype.toBlob = originalToBlob
      URL.createObjectURL = originalCreateObjectURL
      URL.revokeObjectURL = originalRevokeObjectURL
    },
  }
}

let activeStubs: ReturnType<typeof stubBrowserBoundary> | null = null

afterEach(() => {
  cleanup()
  activeStubs?.restore()
  activeStubs = null
  vi.clearAllMocks()
})

function mount(captures: Captures) {
  // Always stub the browser boundary — even tests that never trigger a capture
  // still unmount through the effect that calls URL.revokeObjectURL on any
  // uncommitted burst (see the sibling pixel-quality test file's afterEach note).
  activeStubs = stubBrowserBoundary()
  render(
    <FullScreenCapture
      captures={captures}
      onCameraCapture={vi.fn()}
      onFileUpload={vi.fn()}
      onProceed={vi.fn()}
      onExit={vi.fn()}
      modelError={false}
      submitting={false}
      uploadError={null}
    />,
  )
  fireEvent.click(screen.getByTestId('capture-disclaimer-dismiss'))
}

describe('FullScreenCapture — committed-slot warning caption', () => {
  it('renders the caption for the active committed slot once it is warned', async () => {
    const captures = baseCaptures({ 'side-left': warnedSlot() })
    mount(captures)
    // Front (the default active slot) is uncaptured — no caption yet.
    expect(screen.queryByTestId('slot-quality-caption')).toBeNull()
    // Selecting the warned tile makes it active — the caption should appear
    // with the warning text verbatim, no slot-label prefix (it IS the active slot).
    fireEvent.click(screen.getByLabelText(/Left Side.*quality warning/))
    const caption = await screen.findByTestId('slot-quality-caption')
    expect(caption.textContent).toContain(BLUR_WARNING)
    expect(caption.textContent).not.toContain('Left Side:')
    // The live region wrapping the caption stays mounted (content-gated only)
    // so insertion is reliably announced.
    const region = caption.closest('[role="status"]')
    expect(region).toBeTruthy()
    expect(region?.getAttribute('aria-live')).toBe('polite')
  })

  it('renders no caption when no committed slot has warnings', () => {
    const captures = baseCaptures({
      'front': { ...emptySlot(), source: 'upload', slotStatus: 'ok', captureId: 1, rawRepresentativeUrl: 'blob:rep', displayPreviewUrl: 'blob:rep', quality: { status: 'ok', warnings: [] } },
    })
    mount(captures)
    expect(screen.queryByTestId('slot-quality-caption')).toBeNull()
  })

  it('renders the fallback caption with a slot-label prefix after upload auto-advances off the warned slot', async () => {
    // Stateful wrapper standing in for the wizard page: an upload commits the
    // slot (here resolving straight to a warned quality, like runPreflight
    // would) while FullScreenCapture auto-advances activeSlot to the next
    // uncaptured slot — the caption must surface the just-committed slot's
    // warnings without a tap back, prefixed with its label.
    activeStubs = stubBrowserBoundary()
    function Harness() {
      const [captures, setCaptures] = useState<Captures>(baseCaptures())
      return (
        <FullScreenCapture
          captures={captures}
          onCameraCapture={vi.fn()}
          onFileUpload={(slot: CaptureSlotKey) => setCaptures(prev => ({ ...prev, [slot]: warnedSlot() }))}
          onProceed={vi.fn()}
          onExit={vi.fn()}
          modelError={false}
          submitting={false}
          uploadError={null}
        />
      )
    }
    render(<Harness />)
    fireEvent.click(screen.getByTestId('capture-disclaimer-dismiss'))
    // Upload into the default active slot (Front) via its hidden file input.
    const input = screen.getByLabelText('Upload Front photo')
    fireEvent.change(input, { target: { files: [new File(['x'], 'front.jpg', { type: 'image/jpeg' })] } })
    // Auto-advance moved the active slot off Front (Left Side is now current)…
    await waitFor(() => expect(screen.getByLabelText(/Left Side.*current/)).toBeTruthy())
    // …yet Front's coaching copy renders, prefixed with its slot label.
    const caption = await screen.findByTestId('slot-quality-caption')
    expect(caption.textContent).toContain(`Front: ${BLUR_WARNING}`)
  })

  it('does not duplicate the caption during the camera review phase', async () => {
    // `front` (the default active slot) already carries a warned commit —
    // simulates re-shooting a previously warned slot. While the new burst is
    // under review, the caption must not render (the review card owns
    // warnings display for the in-progress capture).
    const captures = baseCaptures({ 'front': warnedSlot() })
    mount(captures)
    // Sanity: caption shows for the active (front) slot before any capture starts.
    expect(await screen.findByTestId('slot-quality-caption')).toBeTruthy()
    await waitFor(() => expect(screen.getByLabelText('Capture photo').getAttribute('aria-disabled')).toBe('false'))
    fireEvent.click(screen.getByLabelText('Capture photo'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Use This Photo' })).toBeTruthy(), { timeout: 5000 })
    // Now in the review phase — the caption must be suppressed even though the
    // underlying `captures.front` prop is still 'warnings' (unchanged; nothing
    // has been committed yet).
    expect(screen.queryByTestId('slot-quality-caption')).toBeNull()
  })
})

describe('FullScreenCapture — blocking subject-count feedback', () => {
  it('labels a multi-person upload as blocked and tells the user to retake it', async () => {
    mount(baseCaptures({ front: multiplePeopleSlot() }))

    const alert = await screen.findByRole('alert', { name: /more than one person/i })
    expect(alert.textContent).toContain('More than one person detected')
    expect(alert.textContent).toContain('Front')
  })
})

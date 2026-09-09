// @vitest-environment jsdom
//
// T3 unit coverage for the FullScreenCapture review-card pixel-quality merge
// + a11y, and the middle-frame association (PRD "T3" — assigned here because
// T2 deferred it: the association lives inside `capture()`'s burst-assembly
// loop, not a standalone pure function).
//
// Seam chosen: the FULL FullScreenCapture component, mounted in jsdom with the
// browser boundary stubbed (getUserMedia, video.play, canvas 2d context,
// canvas.toBlob, URL.createObjectURL) and ONLY `samplePixelsFromSource`
// module-mocked (so every burst samples a fixed, known PixelSample instead of
// reading real pixels off a jsdom canvas, which has no rendering backend).
// `assessPixelQuality` and `mergePreflightQuality` run FOR REAL, as does the
// entire `capture()` burst-assembly/association loop — so this test exercises
// the actual production association logic (URL-based, not index-based), not a
// reimplementation of it. `getCaptureRuntime`/`assessFrameQuality` are mocked
// to a neutral 'ok' result so the ONLY warnings that can appear come from the
// pixel merge under test.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import FullScreenCapture from '../FullScreenCapture'
import { emptySlot } from '../types'
import type { Captures } from '../types'
import { assessPixelQuality } from '@/lib/capture/pixel-quality'
import type { PixelSample } from '@/lib/capture/pixel-quality'
import { SCREENING_NOTICE_SNAPSHOT } from '@/components/legal-test-fixture'

vi.mock('@/lib/pose/capture-runtime', () => ({
  getCaptureRuntime: () => ({
    detect: vi.fn().mockResolvedValue({ landmarks: {} }),
    enterLive: vi.fn().mockResolvedValue(undefined),
    closeLive: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    frameLive: vi.fn(),
    state: vi.fn(() => 'idle'),
    readiness: vi.fn(() => ({ phase: 'ready', backend: 'live', delegate: 'gpu', message: null })),
    subscribeReadiness: vi.fn((listener: (state: { phase: string; backend: string; delegate: string; message: null }) => void) => { listener({ phase: 'ready', backend: 'live', delegate: 'gpu', message: null }); return () => {} }),
    retry: vi.fn().mockResolvedValue(undefined),
  }),
}))

// Neutral frame quality — isolates the assertions to the pixel-quality merge.
vi.mock('@/lib/pose/quality', () => ({
  assessFrameQuality: vi.fn(() => ({ status: 'ok', warnings: [] })),
}))

// A flat 4x4 gray sample: zero Laplacian variance (blurry) with a mid-range
// luma (no dark/bright warning) — one deterministic, known warning.
const FIXED_SAMPLE: PixelSample = {
  width: 4,
  height: 4,
  data: new Uint8ClampedArray(Array.from({ length: 16 }, () => [180, 180, 180, 255]).flat()),
}
const EXPECTED_PQ = assessPixelQuality(FIXED_SAMPLE)

vi.mock('@/lib/capture/pixel-sample', () => ({
  samplePixelsFromSource: vi.fn(() => FIXED_SAMPLE),
  MAX_SAMPLE_EDGE: 320,
}))

const BURST_SIZE = 5
const MID_INDEX = 2 // Math.floor(BURST_SIZE / 2)

function baseCaptures(overrides: Partial<Captures> = {}): Captures {
  return {
    'front': emptySlot(), 'side-left': emptySlot(), 'side-right': emptySlot(), 'back': emptySlot(),
    ...overrides,
  }
}

/**
 * Stubs the browser boundary `capture()` touches: getUserMedia, video.play,
 * the outer capture canvas's 2d context (drawImage only — pixel sampling
 * itself is module-mocked above), and canvas.toBlob → URL.createObjectURL.
 * `failAtIndex` makes the encode at that burst iteration (0-based) fail
 * (blob === null), so the loop skips it exactly like a real dropped frame;
 * 'all' fails every encode (the empty-burst bail path).
 * Returns a `urlFor(i)` helper for asserting on the resulting object URLs.
 */
function stubBrowserBoundary(failAtIndex: number | null | 'all') {
  let intrinsicWidth = 720
  let intrinsicHeight = 1280
  const originalVideoWidth = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoWidth')
  const originalVideoHeight = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoHeight')
  const originalReadyState = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState')
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => intrinsicWidth })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => intrinsicHeight })
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => HTMLMediaElement.HAVE_CURRENT_DATA })

  const originalGetUserMedia = (navigator as unknown as { mediaDevices?: unknown }).mediaDevices
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
      getVideoTracks: () => [{
        addEventListener: vi.fn(),
        stop: vi.fn(),
        getSettings: () => ({ facingMode: 'environment' }),
      }],
    }) },
  })

  const originalPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()) as unknown as typeof HTMLMediaElement.prototype.play

  const originalGetContext = HTMLCanvasElement.prototype.getContext
  const drawImage = vi.fn()
  const scale = vi.fn()
  const transform = vi.fn()
  const setTransform = vi.fn()
  HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement, type: string) {
    if (type !== '2d') return null
    return { drawImage, scale, transform, setTransform } as unknown as CanvasRenderingContext2D
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext

  let callIndex = 0
  const blobIndex = new WeakMap<Blob, number>()
  const originalToBlob = HTMLCanvasElement.prototype.toBlob
  HTMLCanvasElement.prototype.toBlob = vi.fn(function (cb: BlobCallback) {
    const idx = callIndex++
    if (failAtIndex === 'all' || idx === failAtIndex) { cb(null); return }
    const blob = new Blob(['x'], { type: 'image/jpeg' })
    blobIndex.set(blob, idx)
    cb(blob)
  }) as unknown as typeof HTMLCanvasElement.prototype.toBlob

  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL
  URL.createObjectURL = vi.fn((blob: Blob) => `blob:frame-${blobIndex.get(blob)}`)
  URL.revokeObjectURL = vi.fn()

  return {
    urlFor: (i: number) => `blob:frame-${i}`,
    indexForImage: (image: Blob) => blobIndex.get(image),
    setIntrinsicDimensions: (width: number, height: number) => {
      intrinsicWidth = width
      intrinsicHeight = height
    },
    drawImage,
    scale,
    transform,
    setTransform,
    restore: () => {
      if (originalVideoWidth) Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', originalVideoWidth)
      else delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>).videoWidth
      if (originalVideoHeight) Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', originalVideoHeight)
      else delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>).videoHeight
      if (originalReadyState) Object.defineProperty(HTMLMediaElement.prototype, 'readyState', originalReadyState)
      else delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).readyState
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalGetUserMedia })
      HTMLMediaElement.prototype.play = originalPlay
      HTMLCanvasElement.prototype.getContext = originalGetContext
      HTMLCanvasElement.prototype.toBlob = originalToBlob
      URL.createObjectURL = originalCreateObjectURL
      URL.revokeObjectURL = originalRevokeObjectURL
    },
  }
}

async function mountReady(captures: Captures) {
  const onCameraCapture = vi.fn()
  render(
    <FullScreenCapture
      screeningNotice={SCREENING_NOTICE_SNAPSHOT}
      captures={captures}
      onCameraCapture={onCameraCapture}
      onFileUpload={vi.fn()}
      onProceed={vi.fn()}
      onExit={vi.fn()}
      modelError={false}
      submitting={false}
      uploadError={null}
    />,
  )
  fireEvent.click(screen.getByTestId('capture-disclaimer-dismiss'))
  await waitFor(() => expect(screen.getByLabelText('Capture photo').getAttribute('aria-disabled')).toBe('false'))
  return { onCameraCapture }
}

// Torn down in afterEach AFTER cleanup() unmounts — the unmount effect itself
// calls URL.revokeObjectURL on any uncommitted burst, so the stub must still
// be installed while React tears the tree down.
let activeStubs: ReturnType<typeof stubBrowserBoundary> | null = null

afterEach(() => {
  cleanup()
  activeStubs?.restore()
  activeStubs = null
  vi.clearAllMocks()
})

describe('FullScreenCapture — pixel-quality merge + a11y (T3)', () => {
  it('appends "— quality warning" to the tile aria-label and shows the amber badge for a warned slot', async () => {
    const captures = baseCaptures({
      'side-left': {
        ...emptySlot(), source: 'camera', slotStatus: 'warnings', captureId: 1,
        rawRepresentativeUrl: 'blob:rep', displayPreviewUrl: 'blob:rep',
      },
    })
    activeStubs = stubBrowserBoundary(null)
    await mountReady(captures)
    const tile = screen.getByLabelText(/Left Side.*— quality warning/)
    expect(tile).toBeTruthy()
    // No-person/ok slots must NOT carry the suffix.
    expect(screen.queryByLabelText(/Front.*— quality warning/)).toBeNull()
  })

  it('merges the precomputed representative pixel-quality into the review card before "Use This Photo"', async () => {
    activeStubs = stubBrowserBoundary(null)
    const { onCameraCapture } = await mountReady(baseCaptures())
    fireEvent.click(screen.getByLabelText('Capture photo'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Use This Photo' })).toBeTruthy(), { timeout: 5000 })
    // Let the post-burst macrotask (setTimeout 0) scoring pass resolve before
    // asserting — it runs off the shutter-tap path, ahead of "Use This Photo".
    // (The warning renders as "• {text}" across two text nodes, so assert on
    // the status region's textContent rather than an exact getByText match.)
    await waitFor(() => {
      const region = screen.getByTestId('review-quality-status')
      expect(region?.textContent).toContain(EXPECTED_PQ.warnings[0])
    }, { timeout: 2000 })
    // Not yet committed — proves the warning is visible BEFORE "Use This Photo".
    expect(onCameraCapture).not.toHaveBeenCalled()
  })
})

describe('FullScreenCapture — middle-frame association (URL-based, not index)', () => {
  const cases: Array<{ name: string; failAtIndex: number | null; expectBurst0: number; expectPQ: boolean }> = [
    { name: 'no encode failures', failAtIndex: null, expectBurst0: MID_INDEX, expectPQ: true },
    { name: 'encode fails BEFORE the midpoint (i=1)', failAtIndex: 1, expectBurst0: MID_INDEX, expectPQ: true },
    { name: 'encode fails AT the midpoint (i=2)', failAtIndex: MID_INDEX, expectBurst0: 3, expectPQ: false },
    { name: 'encode fails AFTER the midpoint (i=3)', failAtIndex: 3, expectBurst0: MID_INDEX, expectPQ: true },
  ]

  it('bails to the camera-error screen when EVERY encode fails (empty burst)', async () => {
    activeStubs = stubBrowserBoundary('all')
    const { onCameraCapture } = await mountReady(baseCaptures())
    fireEvent.click(screen.getByLabelText('Capture photo'))
    // The empty-burst bail surfaces the existing camera-error panel instead of
    // handing the review phase an undefined burst[0]/reviewUrl.
    await waitFor(() => {
      expect(screen.getByTestId('camera-error-msg').textContent).toContain('Capture failed')
    }, { timeout: 5000 })
    expect(screen.queryByRole('button', { name: 'Use This Photo' })).toBeNull()
    expect(onCameraCapture).not.toHaveBeenCalled()
  })

  it('refuses capture when intrinsic video dimensions disappear instead of stamping fallback dimensions', async () => {
    const stubs = stubBrowserBoundary(null)
    activeStubs = stubs
    const { onCameraCapture } = await mountReady(baseCaptures())
    stubs.setIntrinsicDimensions(0, 0)

    fireEvent.click(screen.getByLabelText('Capture photo'))

    await waitFor(() => {
      expect(screen.getByTestId('camera-error-msg').textContent).toContain('Capture failed')
    }, { timeout: 5000 })
    expect(stubs.drawImage).not.toHaveBeenCalled()
    expect(onCameraCapture).not.toHaveBeenCalled()
  })

  it('keeps live video, canvas acquisition, and the reviewed still unmirrored', async () => {
    const stubs = stubBrowserBoundary(null)
    activeStubs = stubs
    await mountReady(baseCaptures())
    const video = screen.getByTestId('capture-video') as HTMLVideoElement
    expect(video.style.transform).toBe('')

    fireEvent.click(screen.getByLabelText('Capture photo'))

    const review = await screen.findByAltText('Captured frame', {}, { timeout: 5000 }) as HTMLImageElement
    expect(review.style.transform).toBe('')
    expect(stubs.drawImage).toHaveBeenCalledWith(video, 0, 0)
    expect(stubs.scale).not.toHaveBeenCalled()
    expect(stubs.transform).not.toHaveBeenCalled()
    expect(stubs.setTransform).not.toHaveBeenCalled()
  })

  for (const { name, failAtIndex, expectBurst0, expectPQ } of cases) {
    it(`reports the burst[0]-frame's metrics when ${name}`, async () => {
      const stubs = stubBrowserBoundary(failAtIndex)
      activeStubs = stubs
      const { onCameraCapture } = await mountReady(baseCaptures())
      fireEvent.click(screen.getByLabelText('Capture photo'))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Use This Photo' })).toBeTruthy(), { timeout: 5000 })
      // Give the macrotask-yielded scoring pass time to settle before commit.
      await new Promise(r => setTimeout(r, 50))
      fireEvent.click(screen.getByRole('button', { name: 'Use This Photo' }))
      await waitFor(() => expect(onCameraCapture).toHaveBeenCalledTimes(1))

      const [, burst, , representativePixelQuality, poseInput, representativeImage] = onCameraCapture.mock.calls[0] as [
        string,
        string[],
        number | null,
        unknown,
        unknown,
        Blob,
      ]
      expect(burst[0]).toBe(stubs.urlFor(expectBurst0))
      expect(representativeImage).toBeInstanceOf(Blob)
      expect(stubs.indexForImage(representativeImage)).toBe(expectBurst0)
      expect(burst).toHaveLength(BURST_SIZE - (failAtIndex === null ? 0 : 1))
      if (expectPQ) {
        expect(representativePixelQuality).toEqual(EXPECTED_PQ)
      } else {
        expect(representativePixelQuality).toBeNull()
      }
      expect(poseInput).toEqual({
        sourceWidthPx: 720,
        sourceHeightPx: 1280,
        orientationNormalization: 'camera_video_frame',
        analysisMirrored: false,
        displayMirrored: false,
        requestedCameraFacingMode: 'environment',
        observedCameraFacingMode: 'environment',
      })
    })
  }
})

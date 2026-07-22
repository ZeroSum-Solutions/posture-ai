// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SCREENING_NOTICE_SNAPSHOT } from '@/components/legal-test-fixture'
import FullScreenCapture from '../FullScreenCapture'
import { emptySlot } from '../types'
import type { Captures } from '../types'

const mocks = vi.hoisted(() => {
  const runtime = {
    currentState: 'closed' as 'closed' | 'live-video' | 'review-image',
    detect: vi.fn().mockResolvedValue({ landmarks: {}, detectedPoseCount: 1 }),
    enterLive: vi.fn(),
    closeLive: vi.fn(),
    dispose: vi.fn(),
    frameLive: vi.fn(),
    retry: vi.fn().mockResolvedValue(undefined),
  }
  runtime.enterLive.mockImplementation(async () => { runtime.currentState = 'live-video' })
  runtime.closeLive.mockImplementation(async () => { runtime.currentState = 'closed' })
  runtime.dispose.mockImplementation(async () => { runtime.currentState = 'closed' })
  runtime.frameLive.mockImplementation(async (bitmap: { close?: () => void }) => { bitmap.close?.(); return null })
  return { runtime }
})

vi.mock('@/lib/pose/capture-runtime', () => ({
  getCaptureRuntime: () => ({
    ...mocks.runtime,
    state: () => mocks.runtime.currentState,
    readiness: () => ({ phase: 'ready', backend: 'live', delegate: 'gpu', message: null }),
    subscribeReadiness: (listener: (state: { phase: 'ready'; backend: 'live'; delegate: 'gpu'; message: null }) => void) => {
      listener({ phase: 'ready', backend: 'live', delegate: 'gpu', message: null })
      return () => {}
    },
  }),
}))

vi.mock('@/lib/capture/use-camera-level', () => ({
  useCameraLevel: () => ({
    permission: 'unsupported',
    rollDeg: null,
    pitchDeg: null,
    rollRef: { current: null },
    requestAccess: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/lib/capture/pixel-sample', () => ({ samplePixelsFromSource: vi.fn(() => null), MAX_SAMPLE_EDGE: 320 }))
vi.mock('../CaptureTelemetryPanel', () => ({ default: () => null }))

type TestSentinel = {
  release: ReturnType<typeof vi.fn>
  emitRelease: () => void
}

function makeSentinel(): TestSentinel {
  let listener: (() => void) | null = null
  return {
    release: vi.fn().mockResolvedValue(undefined),
    emitRelease: () => listener?.(),
    addEventListener(type: string, next: () => void) {
      if (type === 'release') listener = next
    },
  } as TestSentinel
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function fakeStream(stop: ReturnType<typeof vi.fn>): MediaStream {
  return {
    getTracks: () => [{ stop }],
    getVideoTracks: () => [{ addEventListener: vi.fn(), stop }],
  } as unknown as MediaStream
}

function captures(): Captures {
  return { front: emptySlot(), 'side-left': emptySlot(), 'side-right': emptySlot(), back: emptySlot() }
}

function completedCaptures(): Captures {
  const result = captures()
  for (const slot of Object.keys(result) as Array<keyof Captures>) {
    result[slot] = {
      ...emptySlot(),
      source: 'upload',
      slotStatus: 'ok',
      captureId: 1,
      rawRepresentativeUrl: `blob:${slot}`,
      displayPreviewUrl: `blob:${slot}`,
    }
  }
  return result
}

function CaptureHarness({
  onCameraCapture = vi.fn(),
  onFileUpload = vi.fn(),
  onProceed = vi.fn(),
  initialCaptures = captures(),
}: {
  onCameraCapture?: ReturnType<typeof vi.fn>
  onFileUpload?: ReturnType<typeof vi.fn>
  onProceed?: ReturnType<typeof vi.fn>
  initialCaptures?: Captures
} = {}) {
  return (
    <FullScreenCapture
      screeningNotice={SCREENING_NOTICE_SNAPSHOT}
      captures={initialCaptures}
      onCameraCapture={onCameraCapture}
      onFileUpload={onFileUpload}
      onProceed={onProceed}
      onExit={vi.fn()}
      modelError={false}
      submitting={false}
      uploadError={null}
    />
  )
}

class MutableOrientation extends EventTarget {
  type = 'portrait-primary'
  angle = 0
  lock = vi.fn().mockResolvedValue(undefined)
  unlock = vi.fn()
  onchange: ((this: ScreenOrientation, ev: Event) => unknown) | null = null

  setType(type: string) {
    this.type = type
    this.dispatchEvent(new Event('change'))
    window.dispatchEvent(new Event('orientationchange'))
    this.onchange?.call(this as unknown as ScreenOrientation, new Event('change'))
  }
}

const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
const originalWakeLock = Object.getOwnPropertyDescriptor(navigator, 'wakeLock')
const originalOrientation = Object.getOwnPropertyDescriptor(window.screen, 'orientation')
const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')
const originalPlay = HTMLMediaElement.prototype.play
const originalVideoWidth = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoWidth')
const originalVideoHeight = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'videoHeight')
const originalCreateImageBitmap = globalThis.createImageBitmap
const originalRequestAnimationFrame = globalThis.requestAnimationFrame
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
const originalGetContext = HTMLCanvasElement.prototype.getContext
const originalToBlob = HTMLCanvasElement.prototype.toBlob
const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

let orientation: MutableOrientation
let visibility: DocumentVisibilityState
let trackStops: ReturnType<typeof vi.fn>[]
let getUserMedia: ReturnType<typeof vi.fn>
let wakeRequest: ReturnType<typeof vi.fn>
let wakeSentinels: TestSentinel[]
let animationFrames: Map<number, FrameRequestCallback>
let nextAnimationFrameId: number
let now: number
let drawImage: ReturnType<typeof vi.fn>
let objectUrlId: number

function restoreDescriptor(target: object, property: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor) Object.defineProperty(target, property, descriptor)
  else delete (target as Record<string, unknown>)[property]
}

beforeEach(() => {
  mocks.runtime.currentState = 'closed'
  mocks.runtime.enterLive.mockClear()
  mocks.runtime.closeLive.mockClear()
  mocks.runtime.dispose.mockClear()
  mocks.runtime.frameLive.mockClear()

  orientation = new MutableOrientation()
  visibility = 'visible'
  trackStops = []
  getUserMedia = vi.fn().mockImplementation(async () => {
    const stop = vi.fn()
    trackStops.push(stop)
    return {
      getTracks: () => [{ stop }],
      getVideoTracks: () => [{ addEventListener: vi.fn(), stop }],
    }
  })
  wakeSentinels = []
  wakeRequest = vi.fn().mockImplementation(async () => {
    const lock = makeSentinel()
    wakeSentinels.push(lock)
    return lock
  })

  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: wakeRequest } })
  Object.defineProperty(window.screen, 'orientation', { configurable: true, value: orientation })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()) as unknown as typeof HTMLMediaElement.prototype.play
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 720 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 960 })

  animationFrames = new Map()
  nextAnimationFrameId = 1
  globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = nextAnimationFrameId++
    animationFrames.set(id, callback)
    return id
  })
  globalThis.cancelAnimationFrame = vi.fn((id: number) => { animationFrames.delete(id) })
  globalThis.createImageBitmap = vi.fn(async () => ({ close: vi.fn() } as unknown as ImageBitmap))
  drawImage = vi.fn()
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage })) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => callback(new Blob(['frame'], { type: 'image/jpeg' }))) as unknown as typeof HTMLCanvasElement.prototype.toBlob
  objectUrlId = 0
  URL.createObjectURL = vi.fn(() => `blob:lifecycle-${++objectUrlId}`)
  URL.revokeObjectURL = vi.fn()
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => { now += 100; return now })
})

afterEach(() => {
  cleanup()
  restoreDescriptor(navigator, 'mediaDevices', originalMediaDevices)
  restoreDescriptor(navigator, 'wakeLock', originalWakeLock)
  restoreDescriptor(window.screen, 'orientation', originalOrientation)
  restoreDescriptor(document, 'visibilityState', originalVisibility)
  HTMLMediaElement.prototype.play = originalPlay
  restoreDescriptor(HTMLVideoElement.prototype, 'videoWidth', originalVideoWidth)
  restoreDescriptor(HTMLVideoElement.prototype, 'videoHeight', originalVideoHeight)
  globalThis.createImageBitmap = originalCreateImageBitmap
  globalThis.requestAnimationFrame = originalRequestAnimationFrame
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame
  HTMLCanvasElement.prototype.getContext = originalGetContext
  HTMLCanvasElement.prototype.toBlob = originalToBlob
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function mountLive(props: Parameters<typeof CaptureHarness>[0] = {}) {
  const view = render(<CaptureHarness {...props} />)
  fireEvent.click(screen.getByTestId('capture-disclaimer-dismiss'))
  await waitFor(() => expect((screen.getByRole('button', { name: 'Capture photo' }) as HTMLButtonElement).disabled).toBe(false))
  return view
}

async function setVisibility(next: DocumentVisibilityState) {
  await act(async () => {
    visibility = next
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
  })
}

describe('FullScreenCapture device lifecycle', () => {
  it('updates portrait guidance after rotation without restarting the stream or losing the selected view', async () => {
    await mountLive()
    fireEvent.click(screen.getByRole('button', { name: 'Left Side (required), pending' }))
    expect(screen.getByRole('button', { name: 'Left Side (required), current' }).getAttribute('aria-current')).toBe('step')

    act(() => { orientation.setType('landscape-primary') })
    expect(screen.getByText('Hold the phone upright (portrait) to capture')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Left Side (required), current' }).getAttribute('aria-current')).toBe('step')

    act(() => { orientation.setType('portrait-secondary') })
    expect(screen.queryByText('Hold the phone upright (portrait) to capture')).toBeNull()
    expect(getUserMedia).toHaveBeenCalledOnce()
  })

  it('coalesces timer reacquisition and releases a wake lock that resolves after unmount', async () => {
    const pending = deferred<TestSentinel>()
    wakeRequest.mockReset().mockReturnValue(pending.promise)
    const view = await mountLive()
    await waitFor(() => expect(wakeRequest).toHaveBeenCalledOnce())

    fireEvent.click(screen.getByRole('button', { name: 'Self-timer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Capture photo' }))
    expect(wakeRequest).toHaveBeenCalledOnce()

    view.unmount()
    const lock = makeSentinel()
    await act(async () => { pending.resolve(lock); await pending.promise })
    expect(lock.release).toHaveBeenCalledOnce()
  })

  it('keeps the runtime closed while hidden, then recovers without losing capture state', async () => {
    const view = await mountLive()
    await waitFor(() => expect(mocks.runtime.enterLive).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Right Side (required), pending' }))
    await waitFor(() => expect(mocks.runtime.enterLive).toHaveBeenCalledTimes(2))

    wakeSentinels.at(-1)?.emitRelease()
    await setVisibility('hidden')
    expect(mocks.runtime.dispose).toHaveBeenCalledOnce()
    expect(trackStops[0]).toHaveBeenCalledOnce()
    expect(animationFrames.size).toBe(0)
    const entersAtHide = mocks.runtime.enterLive.mock.calls.length

    expect(mocks.runtime.currentState).toBe('closed')

    await setVisibility('visible')
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(mocks.runtime.enterLive).toHaveBeenCalledTimes(entersAtHide + 1))
    expect(animationFrames.size).toBe(1)
    expect(wakeRequest).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Right Side (required), current' }).getAttribute('aria-current')).toBe('step')
    expect(getUserMedia).toHaveBeenCalledTimes(2)

    const activeLock = wakeSentinels.at(-1)!
    view.unmount()
    expect(activeLock.release).toHaveBeenCalledOnce()
    expect(trackStops[1]).toHaveBeenCalledOnce()
    expect(mocks.runtime.closeLive).toHaveBeenCalledOnce()
  })

  it('keeps scheduler and runtime ownership bounded across repeated visibility cycles', async () => {
    await mountLive()
    await waitFor(() => expect(mocks.runtime.enterLive).toHaveBeenCalledOnce())

    const cycles = 12
    for (let cycle = 0; cycle < cycles; cycle++) {
      wakeSentinels.at(-1)?.emitRelease()
      await setVisibility('hidden')
      expect(trackStops[cycle]).toHaveBeenCalledOnce()
      expect(animationFrames.size).toBe(0)

      await setVisibility('visible')
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(cycle + 2))
      await waitFor(() => expect(mocks.runtime.enterLive).toHaveBeenCalledTimes(cycle + 2))
      expect(animationFrames.size).toBe(1)
    }

    expect(mocks.runtime.dispose).toHaveBeenCalledTimes(cycles)
    expect(wakeRequest).toHaveBeenCalledTimes(cycles + 1)
    expect(getUserMedia).toHaveBeenCalledTimes(cycles + 1)
  })

  it('retires stale camera requests across rapid visibility changes', async () => {
    await mountLive()
    const first = deferred<MediaStream>()
    const second = deferred<MediaStream>()
    const third = deferred<MediaStream>()
    const firstStop = vi.fn()
    const thirdStop = vi.fn()
    getUserMedia.mockReset()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise)

    await setVisibility('hidden')
    await setVisibility('visible')
    await setVisibility('hidden')
    await setVisibility('visible')
    await setVisibility('hidden')
    await setVisibility('visible')
    expect(getUserMedia).toHaveBeenCalledTimes(3)

    await act(async () => { third.resolve(fakeStream(thirdStop)); await third.promise })
    await act(async () => { first.resolve(fakeStream(firstStop)); await first.promise })
    await act(async () => { second.reject(new DOMException('stale denial', 'NotAllowedError')); await second.promise.catch(() => undefined) })

    await waitFor(() => expect((screen.getByRole('button', { name: 'Capture photo' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByText('Camera access denied. Please allow camera permission and try again.')).toBeNull()
    expect(firstStop).toHaveBeenCalledOnce()
    expect(thirdStop).not.toHaveBeenCalled()
  })

  it('cancels a timed capture when the page is backgrounded during countdown', async () => {
    await mountLive()
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Self-timer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Capture photo' }))
    expect(screen.getByRole('timer').textContent).toBe('Capturing in 3')

    await setVisibility('hidden')
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })

    expect(screen.getByRole('timer').textContent).toBe('')
    expect(screen.queryByRole('button', { name: 'Use This Photo' })).toBeNull()
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled()
  })

  it('invalidates and revokes a partial burst when backgrounded mid-capture', async () => {
    await mountLive()
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Capture photo' }))
    await act(async () => { await Promise.resolve() })
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect((screen.getByRole('button', { name: 'Left Side (required), pending' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Upload photo instead' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Self-timer' }) as HTMLButtonElement).disabled).toBe(true)

    await setVisibility('hidden')
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:lifecycle-1')
    expect(screen.queryByRole('button', { name: 'Use This Photo' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Left Side (required), pending' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('locks slot selection to the shutter-owned view throughout a timed capture', async () => {
    await mountLive()
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Self-timer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Capture photo' }))
    const leftSlot = screen.getByRole('button', { name: 'Left Side (required), pending' }) as HTMLButtonElement

    expect(leftSlot.disabled).toBe(true)
    fireEvent.click(leftSlot)
    expect(screen.getByRole('button', { name: 'Front (required), current' }).getAttribute('aria-current')).toBe('step')
  })

  it('ignores upload input races throughout a timed capture', async () => {
    const onFileUpload = vi.fn()
    await mountLive({ onFileUpload })
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('button', { name: 'Self-timer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Capture photo' }))
    const input = screen.getByLabelText('Upload Front photo') as HTMLInputElement
    const uploadButton = screen.getByRole('button', { name: 'Upload photo instead' }) as HTMLButtonElement

    expect(input.disabled).toBe(true)
    expect(uploadButton.disabled).toBe(true)
    fireEvent.change(input, { target: { files: [new File(['frame'], 'front.jpg', { type: 'image/jpeg' })] } })
    expect(onFileUpload).not.toHaveBeenCalled()
  })

  it('blocks analysis while a completed set of views is being retaken', async () => {
    const onProceed = vi.fn()
    await mountLive({ initialCaptures: completedCaptures(), onProceed })
    vi.useFakeTimers()
    const analyze = screen.getByRole('button', { name: 'Analyze Posture' }) as HTMLButtonElement
    expect(analyze.disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Self-timer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Capture photo' }))

    expect(analyze.disabled).toBe(true)
    expect(analyze.textContent).toBe('Capturing photo…')
    expect(analyze.style.cursor).toBe('not-allowed')
    fireEvent.click(analyze)
    expect(onProceed).not.toHaveBeenCalled()
  })

  it.each(['draw', 'encode'] as const)('fails safe and revokes partial frames when %s throws', async failure => {
    await mountLive()
    vi.useFakeTimers()
    if (failure === 'draw') {
      drawImage.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('draw failed') })
    } else {
      vi.mocked(HTMLCanvasElement.prototype.toBlob)
        .mockImplementationOnce(callback => callback(new Blob(['frame'], { type: 'image/jpeg' })))
        .mockImplementationOnce(() => { throw new Error('encode failed') })
    }

    fireEvent.click(screen.getByRole('button', { name: 'Capture photo' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:lifecycle-1')
    expect(screen.queryByRole('button', { name: 'Use This Photo' })).toBeNull()
    expect(screen.getByTestId('camera-error-msg').textContent).toContain('Capture failed')
    expect((screen.getByRole('button', { name: /Use File Upload Instead/ }) as HTMLButtonElement).disabled).toBe(false)
  })
})

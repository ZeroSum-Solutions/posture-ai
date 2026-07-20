// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import FullScreenCapture from '../FullScreenCapture'
import { emptySlot } from '../types'
import type { Captures } from '../types'

const mocks = vi.hoisted(() => ({
  detect: vi.fn(),
  assess: vi.fn(),
  retry: vi.fn().mockResolvedValue(undefined),
  readiness: { phase: 'ready', backend: 'live', delegate: 'gpu', message: null } as {
    phase: 'downloading' | 'initializing' | 'ready' | 'failed'
    backend: 'live' | 'image'
    delegate: 'gpu' | 'cpu' | null
    message: string | null
  },
  readinessListeners: new Set<(state: { phase: 'downloading' | 'initializing' | 'ready' | 'failed'; backend: 'live' | 'image'; delegate: 'gpu' | 'cpu' | null; message: string | null }) => void>(),
}))

vi.mock('@/lib/pose/capture-runtime', () => ({
  getCaptureRuntime: () => ({
    detect: mocks.detect,
    enterLive: vi.fn().mockResolvedValue(undefined),
    closeLive: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    frameLive: vi.fn(),
    state: vi.fn(() => 'closed'),
    readiness: vi.fn(() => mocks.readiness),
    subscribeReadiness: vi.fn((listener: (state: typeof mocks.readiness) => void) => {
      mocks.readinessListeners.add(listener)
      listener(mocks.readiness)
      return () => mocks.readinessListeners.delete(listener)
    }),
    retry: mocks.retry,
  }),
}))

vi.mock('@/lib/pose/quality', () => ({ assessFrameQuality: mocks.assess }))
vi.mock('@/lib/capture/pixel-sample', () => ({ samplePixelsFromSource: vi.fn(() => null), MAX_SAMPLE_EDGE: 320 }))

function captures(): Captures {
  return { front: emptySlot(), 'side-left': emptySlot(), 'side-right': emptySlot(), back: emptySlot() }
}

function stubBrowserBoundary() {
  const originalMediaDevices = (navigator as Navigator & { mediaDevices?: MediaDevices }).mediaDevices
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }],
        getVideoTracks: () => [{ addEventListener: vi.fn(), stop: vi.fn() }],
      }),
    },
  })
  const originalPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()) as unknown as typeof HTMLMediaElement.prototype.play
  const originalGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as unknown as typeof HTMLCanvasElement.prototype.getContext
  const originalToBlob = HTMLCanvasElement.prototype.toBlob
  HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => callback(new Blob(['frame'], { type: 'image/jpeg' }))) as unknown as typeof HTMLCanvasElement.prototype.toBlob
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  let frame = 0
  URL.createObjectURL = vi.fn(() => `blob:hard-failure-${frame++}`)
  URL.revokeObjectURL = vi.fn()
  return () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalMediaDevices })
    HTMLMediaElement.prototype.play = originalPlay
    HTMLCanvasElement.prototype.getContext = originalGetContext
    HTMLCanvasElement.prototype.toBlob = originalToBlob
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  }
}

let restore: (() => void) | null = null
beforeEach(() => {
  mocks.readiness = { phase: 'ready', backend: 'live', delegate: 'gpu', message: null }
})
afterEach(() => {
  cleanup()
  restore?.()
  restore = null
  vi.clearAllMocks()
})

async function captureToReview() {
  restore = stubBrowserBoundary()
  const onCameraCapture = vi.fn()
  render(
    <FullScreenCapture
      captures={captures()}
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
  const shutter = await screen.findByRole('button', { name: 'Capture photo' })
  await waitFor(() => expect((shutter as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(shutter)
  return { onCameraCapture }
}

describe('FullScreenCapture hard-failure acceptance', () => {
  it('shows every production readiness phase and exposes failed-state retry', async () => {
    restore = stubBrowserBoundary()
    render(
      <FullScreenCapture
        captures={captures()}
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

    const emit = (state: typeof mocks.readiness) => {
      mocks.readiness = state
      mocks.readinessListeners.forEach(listener => listener(state))
    }
    emit({ phase: 'downloading', backend: 'live', delegate: null, message: 'Downloading live runtime.' })
    await screen.findByText('Downloading posture model…')
    emit({ phase: 'initializing', backend: 'live', delegate: 'cpu', message: 'GPU unavailable.' })
    await screen.findByText('Initializing posture model (CPU)…')
    emit({ phase: 'ready', backend: 'live', delegate: 'cpu', message: null })
    await screen.findByText('Posture model ready (CPU)')
    emit({ phase: 'failed', backend: 'live', delegate: null, message: 'Both delegates failed.' })
    await screen.findByText('Both delegates failed.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry Model' }))
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledTimes(1))
  })

  it('keeps acceptance disabled while the model check is pending', async () => {
    mocks.detect.mockReturnValueOnce(new Promise(() => {}))
    await captureToReview()
    const accept = await screen.findByRole('button', { name: 'Checking Photo…' }, { timeout: 5000 })
    expect((accept as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Checking person and framing…')).toBeTruthy()
  })

  it.each([
    ['no_person', 'No person detected — retake'],
    ['multiple_people', 'More than one person detected — retake'],
  ] as const)('keeps acceptance disabled for %s', async (status, reason) => {
    mocks.detect.mockResolvedValueOnce({ landmarks: {}, detectedPoseCount: status === 'multiple_people' ? 2 : 0 })
    mocks.assess.mockReturnValueOnce({ status, warnings: [] })
    const { onCameraCapture } = await captureToReview()
    const accept = await screen.findByRole('button', { name: 'Use This Photo' }, { timeout: 5000 })
    await screen.findByText(reason)
    expect((accept as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(accept)
    expect(onCameraCapture).not.toHaveBeenCalled()
  })

  it('recovers from a model failure and accepts a valid retry without reload', async () => {
    mocks.detect.mockRejectedValueOnce(new Error('both delegates failed'))
    const { onCameraCapture } = await captureToReview()
    await screen.findByTestId('review-model-error', {}, { timeout: 5000 })
    expect((screen.getByRole('button', { name: 'Use This Photo' }) as HTMLButtonElement).disabled).toBe(true)

    mocks.detect.mockResolvedValueOnce({ landmarks: { nose: { x: 0.5, y: 0.2 } }, detectedPoseCount: 1 })
    mocks.assess.mockReturnValueOnce({ status: 'ok', warnings: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Retry Check' }))

    const accept = await screen.findByRole('button', { name: 'Use This Photo' })
    await waitFor(() => expect((accept as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(accept)
    await waitFor(() => expect(onCameraCapture).toHaveBeenCalledTimes(1))
  })

  it('allows soft warnings after the authoritative check completes', async () => {
    mocks.detect.mockResolvedValueOnce({ landmarks: { nose: { x: 0.5, y: 0.2 } }, detectedPoseCount: 1 })
    mocks.assess.mockReturnValueOnce({ status: 'warnings', warnings: ['Step back so your feet are visible.'] })
    await captureToReview()
    const accept = await screen.findByRole('button', { name: 'Use This Photo' }, { timeout: 5000 })
    await waitFor(() => expect((accept as HTMLButtonElement).disabled).toBe(false))
  })
})

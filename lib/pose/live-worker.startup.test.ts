import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LITE_MODEL_URL, WASM_URL } from './pose-model'

const mediaPipe = vi.hoisted(() => ({
  forVisionTasks: vi.fn(),
  createFromOptions: vi.fn(),
}))

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: mediaPipe.forVisionTasks },
  PoseLandmarker: { createFromOptions: mediaPipe.createFromOptions },
}))

type PostedMessage = { type: string; [key: string]: unknown }
type MessageListener = (event: { data: unknown }) => void

const scope = globalThis as unknown as Record<string, unknown>

describe('live pose worker startup contract', () => {
  let posted: PostedMessage[]
  let listener: MessageListener | null

  beforeEach(() => {
    vi.resetModules()
    posted = []
    listener = null
    scope.self = globalThis
    scope.postMessage = (message: unknown) => posted.push(message as PostedMessage)
    scope.addEventListener = (type: string, next: MessageListener) => {
      if (type === 'message') listener = next
    }
    mediaPipe.forVisionTasks.mockReset().mockResolvedValue({ wasmLoaderPath: 'classic-loader' })
    mediaPipe.createFromOptions.mockReset()
  })

  afterEach(() => {
    for (const key of ['self', 'postMessage', 'addEventListener', 'importScripts', 'import']) {
      delete scope[key]
    }
  })

  it('uses the Chromium-safe classic fileset and proves the landmarker can process a frame', async () => {
    const close = vi.fn()
    const detectForVideo = vi.fn(() => ({
      landmarks: [[{ x: 0.25, y: 0.5, z: -0.1, visibility: 0.9 }]],
    }))
    mediaPipe.createFromOptions.mockResolvedValue({ close, detectForVideo })

    await import('./live-worker')
    listener!({ data: { type: 'init', preferCpu: true } })

    await vi.waitFor(() => expect(posted).toContainEqual({ type: 'ready', delegate: 'cpu' }))
    expect(mediaPipe.forVisionTasks).toHaveBeenCalledWith(WASM_URL)
    expect(mediaPipe.createFromOptions).toHaveBeenCalledWith(
      { wasmLoaderPath: 'classic-loader' },
      expect.objectContaining({
        baseOptions: { modelAssetPath: LITE_MODEL_URL, delegate: 'CPU' },
        runningMode: 'VIDEO',
      }),
    )

    listener!({ data: { type: 'frame', seq: 7, bitmap: { close }, generation: 0, timestampMs: 10, currentTime: 1 } })
    expect(detectForVideo).toHaveBeenCalledOnce()
    expect(posted).toContainEqual(expect.objectContaining({
      type: 'result',
      seq: 7,
      result: expect.objectContaining({ landmarks: expect.objectContaining({ nose: expect.any(Object) }) }),
    }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('never reports ready when MediaPipe resolves without a functional landmarker', async () => {
    mediaPipe.createFromOptions.mockResolvedValue({ close: vi.fn() })

    await import('./live-worker')
    listener!({ data: { type: 'init', preferCpu: true } })

    await vi.waitFor(() => expect(posted.some(message => message.type === 'error')).toBe(true))
    expect(posted.some(message => message.type === 'ready')).toBe(false)
  })
})

// @vitest-environment jsdom
import { afterEach, describe, test, expect, vi, beforeEach } from 'vitest'

const singlePoseResult = () => ({
  landmarks: [[{ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }]],
})
const detectSpy = vi.fn<(...args: unknown[]) => unknown>(singlePoseResult)
const closeSpy = vi.fn()
const createSpy = vi.fn(async (
  _vision: unknown,
  _options: { baseOptions: { delegate: 'GPU' | 'CPU' } },
) => {
  void _vision
  void _options
  return { detect: detectSpy, close: closeSpy }
})

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  PoseLandmarker: { createFromOptions: createSpy },
}))

// jsdom's Image never fires load for a data URL; stub a decoder that resolves.
class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 100
  naturalHeight = 200
  set src(_v: string) {
    queueMicrotask(() => this.onload?.())
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  detectSpy.mockReset()
  detectSpy.mockImplementation(singlePoseResult)
  createSpy.mockClear()
  closeSpy.mockClear()
  vi.resetModules()
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image)
})

afterEach(() => vi.useRealTimers())

describe('detectPose subject count', () => {
  test('asks MediaPipe for enough poses to distinguish one subject from a collage', async () => {
    const { detectPose } = await import('./detect')
    await detectPose('data:image/png;base64,ONE_PERSON', 'front', 'upload')

    expect(createSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ numPoses: 2 }),
    )
  })

  test('reports multiple detected poses instead of silently scoring the first one', async () => {
    detectSpy.mockReturnValueOnce({
      landmarks: [
        [{ x: 0.25, y: 0.5, z: 0, visibility: 0.9 }],
        [{ x: 0.75, y: 0.5, z: 0, visibility: 0.9 }],
      ],
    })
    const { detectPose } = await import('./detect')

    const frame = await detectPose('data:image/png;base64,TWO_PEOPLE', 'front', 'upload')

    expect(frame.detectedPoseCount).toBe(2)
  })
})

describe('detectPose result caching', () => {
  test('detects the same frame once — a byte-identical data URL is not re-run through the landmarker', async () => {
    const { detectPose } = await import('./detect')
    const src = 'data:image/png;base64,SAMEFRAME'
    await detectPose(src, 'front')
    await detectPose(src, 'front')
    await detectPose(src, 'front') // the representative frame is requested up to 3×
    expect(detectSpy).toHaveBeenCalledTimes(1)
  })

  test('detects distinct frames separately', async () => {
    const { detectPose } = await import('./detect')
    await detectPose('data:image/png;base64,FRAME_A', 'front')
    await detectPose('data:image/png;base64,FRAME_B', 'side')
    expect(detectSpy).toHaveBeenCalledTimes(2)
  })

  test('bounds a stalled detection, invalidates the backend, and permits retry', async () => {
    vi.useFakeTimers()
    detectSpy.mockImplementationOnce(() => new Promise(() => {}))
    const detector = await import('./detect')

    const detecting = detector.detectPose('data:image/png;base64,HUNG', 'front')
    await vi.advanceTimersByTimeAsync(detector.IMAGE_DETECT_TIMEOUT_MS)
    await expect(detecting).rejects.toThrow('Pose detection timed out')
    expect(detector.imageReadiness()).toMatchObject({
      phase: 'failed',
      backend: 'image',
      message: 'Pose detection timed out.',
    })
    expect(closeSpy).toHaveBeenCalledTimes(1)

    detectSpy.mockImplementation(singlePoseResult)
    await expect(detector.detectPose('data:image/png;base64,RETRY', 'front')).resolves.toMatchObject({
      detectedPoseCount: 1,
    })
    expect(createSpy).toHaveBeenCalledTimes(2)
  })

  test('fails an over-budget synchronous detect after it returns', async () => {
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValueOnce(100).mockReturnValueOnce(10_101)
    const detector = await import('./detect')

    await expect(detector.detectPose('data:image/png;base64,SLOW_SYNC', 'front')).rejects.toThrow('Pose detection timed out')
    expect(detector.imageReadiness()).toMatchObject({
      phase: 'failed',
      delegate: 'gpu',
      message: 'Pose detection timed out.',
    })
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  test('demotes a context-lost GPU to CPU until an explicit fresh lifecycle reset', async () => {
    detectSpy.mockImplementationOnce(() => { throw new Error('WebGL context lost') })
    const detector = await import('./detect')

    await expect(detector.detectPose('data:image/png;base64,GPU_CONTEXT_LOST', 'front')).rejects.toThrow('WebGL context lost')
    detectSpy.mockImplementation(singlePoseResult)
    await detector.detectPose('data:image/png;base64,CPU_RECOVERY', 'front')

    expect(createSpy.mock.calls.map(([, options]) => options.baseOptions.delegate)).toEqual(['GPU', 'CPU'])
    expect(detector.imageReadiness()).toMatchObject({ phase: 'ready', delegate: 'cpu' })

    await detector.closeLandmarker()
    detector.resetLandmarkerDelegatePreference()
    await detector.detectPose('data:image/png;base64,FRESH_LIFECYCLE', 'front')
    expect(createSpy.mock.calls.map(([, options]) => options.baseOptions.delegate)).toEqual(['GPU', 'CPU', 'GPU'])
  })
})

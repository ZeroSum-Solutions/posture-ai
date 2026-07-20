// @vitest-environment jsdom
import { afterEach, describe, test, expect, vi, beforeEach } from 'vitest'

// Count constructions + closes so we can prove the single-runtime invariant:
// warm→close→warm re-creates exactly one landmarker, and repeated warms within
// a cycle create only one.
let constructed = 0
let closed = 0
const closeSpy = vi.fn(() => { closed++ })
let gpuFailure: Error | null = null
let cpuFailure: Error | null = null
let gpuCreation: Promise<unknown> | null = null
const detectSpy = vi.fn(() => ({ landmarks: [] }))
const createSpy = vi.fn(async (_vision: unknown, options: { baseOptions: { delegate: 'GPU' | 'CPU' } }) => {
  constructed++
  if (options.baseOptions.delegate === 'GPU') {
    if (gpuFailure) throw gpuFailure
    if (gpuCreation) return gpuCreation
  }
  if (options.baseOptions.delegate === 'CPU' && cpuFailure) throw cpuFailure
  return { detect: detectSpy, close: closeSpy }
})

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  PoseLandmarker: {
    createFromOptions: createSpy,
  },
}))

beforeEach(() => {
  constructed = 0
  closed = 0
  gpuFailure = null
  cpuFailure = null
  gpuCreation = null
  closeSpy.mockClear()
  createSpy.mockClear()
  detectSpy.mockClear()
  vi.resetModules()
})

afterEach(() => vi.useRealTimers())

describe('landmarker lifecycle', () => {
  test('warmUpLandmarker resolves and constructs exactly one landmarker', async () => {
    const { warmUpLandmarker } = await import('./detect')
    await warmUpLandmarker()
    expect(constructed).toBe(1)
  })

  test('repeated warms within a cycle share one construction', async () => {
    const { warmUpLandmarker } = await import('./detect')
    await Promise.all([warmUpLandmarker(), warmUpLandmarker(), warmUpLandmarker()])
    expect(constructed).toBe(1)
  })

  test('closeLandmarker closes the resident landmarker and nulls the singleton', async () => {
    const { warmUpLandmarker, closeLandmarker } = await import('./detect')
    await warmUpLandmarker()
    await closeLandmarker()
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(closed).toBe(1)
  })

  test('re-warm after close creates exactly one new landmarker (never two resident)', async () => {
    const { warmUpLandmarker, closeLandmarker } = await import('./detect')
    await warmUpLandmarker()
    await closeLandmarker()
    await warmUpLandmarker()
    expect(constructed).toBe(2) // one per warm cycle
    expect(closed).toBe(1)      // the first was closed before the second was built
  })

  test('closeLandmarker with nothing resident is a no-op', async () => {
    const { closeLandmarker } = await import('./detect')
    await closeLandmarker()
    expect(closeSpy).not.toHaveBeenCalled()
  })

  test('falls back from GPU to CPU and reports the active delegate', async () => {
    gpuFailure = new Error('WebGL unavailable')
    const { imageReadiness, subscribeImageReadiness, warmUpLandmarker } = await import('./detect')
    const phases: string[] = []
    const unsubscribe = subscribeImageReadiness(value => phases.push(`${value.phase}:${value.delegate}`))

    await expect(warmUpLandmarker()).resolves.toEqual({ ok: true, delegate: 'cpu' })

    expect(imageReadiness()).toMatchObject({ phase: 'ready', backend: 'image', delegate: 'cpu' })
    expect(phases).toContain('initializing:gpu')
    expect(phases).toContain('initializing:cpu')
    unsubscribe()
  })

  test('returns an explicit both-delegates failure and retries cleanly', async () => {
    gpuFailure = new Error('GPU init failed')
    cpuFailure = new Error('CPU init failed')
    const detector = await import('./detect')

    await expect(detector.warmUpLandmarker()).resolves.toMatchObject({
      ok: false,
      code: 'gpu_and_cpu_failed',
    })
    expect(detector.imageReadiness()).toMatchObject({
      phase: 'failed',
      backend: 'image',
      message: expect.stringContaining('GPU init failed'),
    })

    gpuFailure = null
    cpuFailure = null
    await expect(detector.warmUpLandmarker()).resolves.toEqual({ ok: true, delegate: 'gpu' })
    expect(constructed).toBe(3)
  })

  test('bounds a hung GPU constructor, closes its late result, and promotes only CPU', async () => {
    vi.useFakeTimers()
    let resolveGpu!: (value: unknown) => void
    gpuCreation = new Promise(resolve => { resolveGpu = resolve })
    const detector = await import('./detect')

    const warming = detector.warmUpLandmarker()
    await vi.advanceTimersByTimeAsync(detector.IMAGE_INIT_TIMEOUT_MS)
    await expect(warming).resolves.toEqual({ ok: true, delegate: 'cpu' })
    expect(detector.imageReadiness()).toMatchObject({ phase: 'ready', delegate: 'cpu' })

    resolveGpu({ detect: detectSpy, close: closeSpy })
    await vi.advanceTimersByTimeAsync(0)
    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(detector.imageReadiness()).toMatchObject({ phase: 'ready', delegate: 'cpu' })
  })
})

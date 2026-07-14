// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach } from 'vitest'

// Count constructions + closes so we can prove the single-runtime invariant:
// warm→close→warm re-creates exactly one landmarker, and repeated warms within
// a cycle create only one.
let constructed = 0
let closed = 0
const closeSpy = vi.fn(() => { closed++ })

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  PoseLandmarker: {
    createFromOptions: async () => {
      constructed++
      return { detect: vi.fn(), close: closeSpy }
    },
  },
}))

beforeEach(() => {
  constructed = 0
  closed = 0
  closeSpy.mockClear()
  vi.resetModules()
})

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
})

// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach } from 'vitest'

const singlePoseResult = () => ({
  landmarks: [[{ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }]],
})
const detectSpy = vi.fn(singlePoseResult)
const createSpy = vi.fn(async () => ({ detect: detectSpy }))

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
  detectSpy.mockReset()
  detectSpy.mockImplementation(singlePoseResult)
  createSpy.mockClear()
  vi.resetModules()
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image)
})

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
})

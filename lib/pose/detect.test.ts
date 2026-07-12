// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach } from 'vitest'

const detectSpy = vi.fn(() => ({
  landmarks: [[{ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }]],
}))

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  PoseLandmarker: { createFromOptions: async () => ({ detect: detectSpy }) },
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
  detectSpy.mockClear()
  vi.stubGlobal('Image', FakeImage as unknown as typeof Image)
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

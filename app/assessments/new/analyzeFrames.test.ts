import { describe, expect, it, vi } from 'vitest'
import { analyzeCaptureFrames } from './analyzeFrames'
import { emptySlot, type Captures } from './types'

function capturesWithFrontBurst(): Captures {
  return {
    front: {
      ...emptySlot(),
      source: 'camera',
      slotStatus: 'ok',
      captureId: 1,
      poseInput: {
        sourceWidthPx: 720,
        sourceHeightPx: 1280,
        orientationNormalization: 'camera_video_frame',
        analysisMirrored: false,
        displayMirrored: false,
        requestedCameraFacingMode: 'environment',
        observedCameraFacingMode: null,
      },
      rawRepresentativeUrl: 'blob:front-1',
      rawBurstUrls: ['blob:front-1', 'blob:front-2', 'blob:front-3'],
      rawPoseFrame: { view: 'front', source: 'camera', landmarks: {} },
      displayPreviewUrl: 'blob:front-1',
    },
    'side-left': emptySlot(),
    'side-right': emptySlot(),
    back: emptySlot(),
  }
}

describe('analyzeCaptureFrames', () => {
  it('reuses the checked representative and reports deterministic burst progress', async () => {
    const detect = vi.fn(async (url: string) => ({ view: 'front' as const, source: 'camera' as const, landmarks: {}, url }))
    const onProgress = vi.fn()

    const frames = await analyzeCaptureFrames({
      captures: capturesWithFrontBurst(),
      runtime: { detect },
      assessFrameQuality: () => ({ status: 'ok', warnings: [] }),
      signal: new AbortController().signal,
      onProgress,
    })

    expect(frames).toHaveLength(3)
    expect(detect).toHaveBeenCalledTimes(2)
    expect(detect).toHaveBeenNthCalledWith(1, 'blob:front-2', 'front', 'camera', {
      sourceWidthPx: 720,
      sourceHeightPx: 1280,
      orientationNormalization: 'camera_video_frame',
      analysisMirrored: false,
      displayMirrored: false,
      requestedCameraFacingMode: 'environment',
      observedCameraFacingMode: null,
    })
    expect(onProgress).toHaveBeenLastCalledWith({ completed: 3, total: 3, slot: 'front' })
  })

  it('returns promptly when an in-flight detector is cancelled', async () => {
    const controller = new AbortController()
    const never = new Promise<never>(() => {})
    const analysis = analyzeCaptureFrames({
      captures: { ...capturesWithFrontBurst(), front: { ...capturesWithFrontBurst().front, rawPoseFrame: null } },
      runtime: { detect: vi.fn(() => never) },
      assessFrameQuality: () => ({ status: 'ok', warnings: [] }),
      signal: controller.signal,
      onProgress: vi.fn(),
    })

    controller.abort()

    await expect(analysis).rejects.toMatchObject({ name: 'AbortError' })
  })
})

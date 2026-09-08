// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/capture/pixel-sample', () => ({
  samplePixelsFromSource: vi.fn(() => null),
}))
vi.mock('@/lib/capture/pixel-quality', () => ({
  assessPixelQuality: vi.fn(),
}))

const originalCreateImageBitmap = globalThis.createImageBitmap
const originalGetContext = HTMLCanvasElement.prototype.getContext
const originalToDataURL = HTMLCanvasElement.prototype.toDataURL

afterEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('createImageBitmap', originalCreateImageBitmap)
  HTMLCanvasElement.prototype.getContext = originalGetContext
  HTMLCanvasElement.prototype.toDataURL = originalToDataURL
})

describe('normalizeUploadedImage provenance', () => {
  it('distinguishes the EXIF-decoded source dimensions from the resized analysis image', async () => {
    const close = vi.fn()
    const createdCanvas: { width?: number; height?: number } = {}
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
      width: 3000,
      height: 4000,
      close,
    }))
    HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
      createdCanvas.width = this.width
      createdCanvas.height = this.height
      return { drawImage: vi.fn() }
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/jpeg;base64,NORMALIZED')

    const { normalizeUploadedImage } = await import('./normalize-upload')
    const result = await normalizeUploadedImage(new File(['pixels'], 'portrait.jpg', { type: 'image/jpeg' }))

    expect(result).toMatchObject({
      dataUrl: 'data:image/jpeg;base64,NORMALIZED',
      poseInput: {
        sourceWidthPx: 3000,
        sourceHeightPx: 4000,
        orientationNormalization: 'exif_from_image_canvas_v1',
        analysisMirrored: false,
        displayMirrored: false,
        requestedCameraFacingMode: null,
        observedCameraFacingMode: null,
      },
    })
    expect(createdCanvas.width).toBe(1200)
    expect(createdCanvas.height).toBe(1600)
    expect(close).toHaveBeenCalledOnce()
  })
})

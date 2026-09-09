import { describe, expect, test } from 'vitest'
import sharp from 'sharp'
import {
  captureImageObjectPath,
  CaptureImageError,
  isCaptureImageSlot,
  normalizeCaptureImage,
} from './captureImage'

async function raster(type: 'image/jpeg' | 'image/png', withMetadata = false): Promise<File> {
  let pipeline = sharp({
    create: { width: 8, height: 5, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 0.5 } },
  })
  if (withMetadata) pipeline = pipeline.withMetadata({ orientation: 6 })
  const bytes = type === 'image/jpeg' ? await pipeline.jpeg().toBuffer() : await pipeline.png().toBuffer()
  return new File([bytes], `capture.${type === 'image/jpeg' ? 'jpg' : 'png'}`, { type })
}

describe('capture image normalization', () => {
  test('accepts only the four persisted view/side slots', () => {
    expect(['front', 'side-left', 'side-right', 'back'].every(isCaptureImageSlot)).toBe(true)
    expect(isCaptureImageSlot('side')).toBe(false)
    expect(isCaptureImageSlot(null)).toBe(false)
  })

  test('produces byte-identical metadata-free JPEG output across exact retries', async () => {
    const input = await raster('image/png', true)
    const first = await normalizeCaptureImage(input)
    const second = await normalizeCaptureImage(input)
    const metadata = await sharp(first.bytes).metadata()

    expect(first.bytes.equals(second.bytes)).toBe(true)
    expect(first.sha256).toBe(second.sha256)
    expect(first.contentType).toBe('image/jpeg')
    expect({ width: first.width, height: first.height }).toEqual({ width: 5, height: 8 })
    expect(metadata.orientation).toBeUndefined()
    expect(metadata.exif).toBeUndefined()
    expect(metadata.xmp).toBeUndefined()
  })

  test('rejects unsupported, spoofed, and undecodable input with stable codes', async () => {
    await expect(normalizeCaptureImage(new File(['gif'], 'x.gif', { type: 'image/gif' })))
      .rejects.toMatchObject({ code: 'unsupported_image_type', status: 415 } satisfies Partial<CaptureImageError>)
    await expect(normalizeCaptureImage(new File(['not jpeg'], 'x.jpg', { type: 'image/jpeg' })))
      .rejects.toMatchObject({ code: 'invalid_image', status: 422 } satisfies Partial<CaptureImageError>)
    await expect(normalizeCaptureImage(new File([new Uint8Array([0xff, 0xd8, 0xff])], 'x.jpg', { type: 'image/jpeg' })))
      .rejects.toMatchObject({ code: 'invalid_image', status: 422 } satisfies Partial<CaptureImageError>)
  })

  test('builds a tenant- and content-bound private object path', async () => {
    const normalized = await normalizeCaptureImage(await raster('image/jpeg'))
    expect(captureImageObjectPath({
      practitionerId: 'p1', assessmentId: 'a1', captureId: 'c1', sha256: normalized.sha256,
    })).toBe(`p1/a1/c1/${normalized.sha256}.jpg`)
  })
})

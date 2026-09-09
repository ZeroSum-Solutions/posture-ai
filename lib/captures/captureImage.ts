import { createHash } from 'node:crypto'
import sharp from 'sharp'

// Vercel rejects request bodies above 4.5 MB before application code runs. Keep
// the complete multipart request at 4 MB and the decoded raster bounded too.
export const CAPTURE_IMAGE_MAX_MULTIPART_BYTES = 4 * 1024 * 1024
export const CAPTURE_IMAGE_MAX_INPUT_BYTES = CAPTURE_IMAGE_MAX_MULTIPART_BYTES
export const CAPTURE_IMAGE_MAX_OUTPUT_BYTES = CAPTURE_IMAGE_MAX_MULTIPART_BYTES
export const CAPTURE_IMAGE_MAX_PIXELS = 16_000_000

export const CAPTURE_IMAGE_SLOTS = [
  'front',
  'side-left',
  'side-right',
  'back',
] as const

export type CaptureImageSlot = (typeof CAPTURE_IMAGE_SLOTS)[number]

export type NormalizedCaptureImage = Readonly<{
  bytes: Buffer
  byteSize: number
  contentType: 'image/jpeg'
  height: number
  sha256: string
  width: number
}>

export class CaptureImageError extends Error {
  constructor(
    readonly code: 'image_too_large' | 'unsupported_image_type' | 'invalid_image',
    readonly status: 413 | 415 | 422,
  ) {
    super(code)
    this.name = 'CaptureImageError'
  }
}

export function isCaptureImageSlot(value: unknown): value is CaptureImageSlot {
  return typeof value === 'string'
    && (CAPTURE_IMAGE_SLOTS as readonly string[]).includes(value)
}

export function captureImageObjectPath(input: {
  assessmentId: string
  captureId: string
  practitionerId: string
  sha256: string
}): string {
  return `${input.practitionerId}/${input.assessmentId}/${input.captureId}/${input.sha256}.jpg`
}

function hasExpectedSignature(bytes: Buffer, contentType: string): boolean {
  if (contentType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  return bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
}

/**
 * Decode and re-encode a browser capture to one deterministic storage format.
 * Sharp's default output excludes EXIF/ICC/XMP metadata; auto-orientation is
 * applied to pixels before those metadata are discarded.
 */
export async function normalizeCaptureImage(file: File): Promise<NormalizedCaptureImage> {
  const contentType = file.type.toLowerCase()
  if (contentType !== 'image/jpeg' && contentType !== 'image/png') {
    throw new CaptureImageError('unsupported_image_type', 415)
  }
  if (file.size === 0) throw new CaptureImageError('invalid_image', 422)
  if (file.size > CAPTURE_IMAGE_MAX_INPUT_BYTES) {
    throw new CaptureImageError('image_too_large', 413)
  }

  const source = Buffer.from(await file.arrayBuffer())
  if (!hasExpectedSignature(source, contentType)) {
    throw new CaptureImageError('invalid_image', 422)
  }

  try {
    const decoded = sharp(source, {
      failOn: 'error',
      limitInputPixels: CAPTURE_IMAGE_MAX_PIXELS,
      pages: 1,
      sequentialRead: true,
    })
    const metadata = await decoded.metadata()
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
      throw new CaptureImageError('invalid_image', 422)
    }

    const { data, info } = await sharp(source, {
      failOn: 'error',
      limitInputPixels: CAPTURE_IMAGE_MAX_PIXELS,
      pages: 1,
      sequentialRead: true,
    })
      .autoOrient()
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toColourspace('srgb')
      .jpeg({
        chromaSubsampling: '4:4:4',
        optimiseCoding: false,
        progressive: false,
        quality: 90,
      })
      .toBuffer({ resolveWithObject: true })

    if (!info.width || !info.height || data.byteLength > CAPTURE_IMAGE_MAX_OUTPUT_BYTES) {
      throw new CaptureImageError('image_too_large', 413)
    }

    const bytes = Buffer.from(data)
    return Object.freeze({
      bytes,
      byteSize: bytes.byteLength,
      contentType: 'image/jpeg' as const,
      height: info.height,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      width: info.width,
    })
  } catch (error) {
    if (error instanceof CaptureImageError) throw error
    throw new CaptureImageError('invalid_image', 422)
  }
}

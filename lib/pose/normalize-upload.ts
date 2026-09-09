'use client'
// Upload pre-processing (spec §4.5): apply EXIF orientation exactly once and
// cap the decode size, returning an upright JPEG data URL. Canvas re-encoding
// strips EXIF, so the orientation cannot be applied twice downstream.

import { samplePixelsFromSource } from '@/lib/capture/pixel-sample'
import { assessPixelQuality } from '@/lib/capture/pixel-quality'
import type { PixelQualityResult } from '@/lib/capture/pixel-quality'
import type { PoseInputProvenance } from './detect'

const MAX_DIMENSION_PX = 1600

export interface NormalizedUpload {
  dataUrl: string
  /** Provenance for the decoded source and the exact normalization path. */
  poseInput: PoseInputProvenance
  /** Pixel-quality metrics sampled from the decoded-and-resized canvas, pre-
   *  toDataURL (Core design: no post-encode sampling). Null on any sampling
   *  or scoring failure — fails open, never blocks the upload. */
  pixelQuality: PixelQualityResult | null
}

/**
 * Returns the upright JPEG data URL plus its pixel-quality sample, or null
 * when normalization is unavailable (old browsers, decode failure) — the
 * caller falls back to the raw file object URL, and detectPose attaches the
 * aspect ratio from the decoded image either way.
 *
 * Browser notes: Safari <16.4 may ignore the imageOrientation option, but
 * those versions already apply EXIF orientation when decoding blobs, so the
 * bitmap still arrives upright in practice. A synchronous TypeError from an
 * unsupported options argument is caught and degrades to the raw-file path.
 */
export async function normalizeUploadedImage(file: File): Promise<NormalizedUpload | null> {
  if (typeof createImageBitmap !== 'function') return null
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const sourceWidthPx = bitmap.width
    const sourceHeightPx = bitmap.height
    const scale = Math.min(1, MAX_DIMENSION_PX / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return null
    }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()

    let pixelQuality: PixelQualityResult | null = null
    const sample = samplePixelsFromSource(canvas, w, h)
    if (sample) {
      try {
        pixelQuality = assessPixelQuality(sample)
      } catch {
        pixelQuality = null
      }
    }

    return {
      dataUrl: canvas.toDataURL('image/jpeg', 0.92),
      pixelQuality,
      poseInput: {
        sourceWidthPx,
        sourceHeightPx,
        orientationNormalization: 'exif_from_image_canvas_v1',
        analysisMirrored: false,
        displayMirrored: false,
        requestedCameraFacingMode: null,
        observedCameraFacingMode: null,
      },
    }
  } catch {
    return null
  }
}

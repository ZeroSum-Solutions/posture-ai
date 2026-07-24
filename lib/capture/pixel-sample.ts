'use client'
// Cheap pixel sampler for the capture-quality preflight (spec §"Core design"):
// downscales a live source (video frame / decoded upload) onto a small canvas
// bounded by MAX_SAMPLE_EDGE and reads back the raw RGBA. Never resizes beyond
// the bound, never warps aspect ratio (Laplacian sharpness is aspect-sensitive).

import type { PixelSample } from './pixel-quality'
import calibration from './pixel-quality.calibration.json'

/** Calibrated long-edge sample bound (lib/capture/pixel-quality.calibration.json). */
export const MAX_SAMPLE_EDGE = calibration.scale
let reusableCanvas: HTMLCanvasElement | null = null

/**
 * Downscales `source` (srcW x srcH) onto a small canvas bounded by `maxEdge`
 * on its longest edge, preserving aspect ratio, and returns the raw RGBA
 * sample. Fails open (null) on invalid dimensions or any draw/readback error
 * — callers never let a sampling failure block capture.
 */
export function samplePixelsFromSource(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
  maxEdge: number = MAX_SAMPLE_EDGE,
): PixelSample | null {
  if (
    !Number.isFinite(srcW)
    || !Number.isFinite(srcH)
    || !Number.isFinite(maxEdge)
    || srcW <= 0
    || srcH <= 0
    || maxEdge <= 0
  ) return null

  try {
    const scale = Math.min(1, maxEdge / Math.max(srcW, srcH))
    const targetW = Math.max(1, Math.round(srcW * scale))
    const targetH = Math.max(1, Math.round(srcH * scale))

    // Sampling is synchronous, so one reusable canvas cannot overlap another
    // call. Keep one square backing store at the requested bound instead of
    // resizing it for every portrait/landscape frame: a resize discards the
    // browser's read-optimized store and made constrained WebKit occasionally
    // pay the allocation/readback cost inside the timed capture path.
    const canvas = reusableCanvas ??= document.createElement('canvas')
    if (canvas.width !== maxEdge || canvas.height !== maxEdge) {
      canvas.width = maxEdge
      canvas.height = maxEdge
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null

    // Reuse must not blend transparent pixels over the prior sample.
    ctx.clearRect(0, 0, targetW, targetH)
    ctx.drawImage(source, 0, 0, targetW, targetH)
    const imageData = ctx.getImageData(0, 0, targetW, targetH)
    return { data: imageData.data, width: targetW, height: targetH }
  } catch {
    return null
  }
}

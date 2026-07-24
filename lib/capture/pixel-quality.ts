import type { FrameQuality } from '../pose/quality'
import calibration from './pixel-quality.calibration.json'

// Rec.601 luma clip levels (spec §"Core design"): below this is "clipped dark",
// above this is "clipped bright".
const DARK_CLIP_LEVEL = 16
const BRIGHT_CLIP_LEVEL = 239

export interface PixelSample {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface PixelQualityResult {
  sharpness: number
  lumaMean: number
  darkClip: number
  brightClip: number
  warnings: string[]
}

interface LumaStats {
  luma: Float64Array
  lumaMean: number
  darkClip: number
  brightClip: number
}

// Rec.601 luma per pixel, summed for the mean and counted against the clip
// levels in one pass over the already-downscaled sample.
function lumaStats(data: Uint8ClampedArray, pixelCount: number): LumaStats {
  const luma = new Float64Array(pixelCount)
  let lumaSum = 0
  let darkCount = 0
  let brightCount = 0
  for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
    const l = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
    luma[i] = l
    lumaSum += l
    if (l < DARK_CLIP_LEVEL) darkCount++
    if (l > BRIGHT_CLIP_LEVEL) brightCount++
  }
  return {
    luma,
    lumaMean: lumaSum / pixelCount,
    darkClip: darkCount / pixelCount,
    brightClip: brightCount / pixelCount,
  }
}

// Variance of a 3x3 Laplacian ([[0,1,0],[1,-4,1],[0,1,0]]) over luma, restricted
// to interior pixels (no border padding — the sample is already small, so
// dropping a 1px border is negligible). Images too thin to have an interior
// (width or height < 3) are given a sharpness signal of zero.
function laplacianVariance(luma: Float64Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0

  // Accumulate variance online instead of materializing one boxed Number per
  // interior pixel. A 320px sample has roughly 100k interior pixels; avoiding
  // that temporary array removes a large WebKit allocation/GC spike from the
  // capture preflight while preserving population-variance semantics.
  let count = 0
  let mean = 0
  let sumSquaredDifferences = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      const lap = luma[idx - width] + luma[idx + width] + luma[idx - 1] + luma[idx + 1] - 4 * luma[idx]
      count++
      const delta = lap - mean
      mean += delta / count
      sumSquaredDifferences += delta * (lap - mean)
    }
  }

  return sumSquaredDifferences / count
}

/**
 * Pure pixel-quality scorer over an already-downscaled RGBA sample — this
 * function never resizes; the caller (the sampler) owns the downscale bound.
 * Fails loud on malformed/empty input; acquisition sites wrap this in
 * try/catch so a bad sample fails open (Product constraints: null → no pixel
 * warnings), never a hard block.
 */
export function assessPixelQuality(img: PixelSample): PixelQualityResult {
  const { data, width, height } = img
  const pixelCount = width * height
  if (width <= 0 || height <= 0 || data.length !== pixelCount * 4) {
    throw new Error('assessPixelQuality: empty or malformed pixel sample')
  }

  const { luma, lumaMean, darkClip, brightClip } = lumaStats(data, pixelCount)
  const sharpness = laplacianVariance(luma, width, height)

  const warnings: string[] = []
  if (sharpness < calibration.thresholds.sharpnessMin) {
    warnings.push('Photo looks blurry — hold the camera steady and retake.')
  }
  // Exposure warnings gate on BOTH signals: a globally dark/bright mean, OR a
  // large clipped fraction with a normal mean (blown window behind the subject,
  // crushed shadows) — the exact defect the clip fractions exist to catch.
  if (lumaMean < calibration.thresholds.lumaDarkMax || darkClip > calibration.thresholds.darkClipMax) {
    warnings.push('Photo is too dark — add more light and retake.')
  }
  if (lumaMean > calibration.thresholds.lumaBrightMin || brightClip > calibration.thresholds.brightClipMax) {
    warnings.push('Photo is overexposed — reduce direct light and retake.')
  }

  return { sharpness, lumaMean, darkClip, brightClip, warnings }
}

/**
 * Merges pixel-quality warnings into the existing frame-quality result.
 * Pure: subject-count failures are untouched (hard blocks; pixel warnings never apply),
 * a null pixelQuality (sampling/scoring failed open) returns frameQuality
 * verbatim, and otherwise pixel warnings are appended LAST after any existing
 * warnings, upgrading 'ok' to 'warnings' when pixel warnings exist.
 */
export function mergePreflightQuality(
  frameQuality: FrameQuality,
  pixelQuality: PixelQualityResult | null,
): FrameQuality {
  if (pixelQuality === null) return frameQuality
  if (frameQuality.status === 'no_person' || frameQuality.status === 'multiple_people') return frameQuality
  if (pixelQuality.warnings.length === 0) return frameQuality

  return {
    status: 'warnings',
    warnings: [...frameQuality.warnings, ...pixelQuality.warnings],
  }
}

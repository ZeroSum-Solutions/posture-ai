import { describe, it, expect } from 'vitest'
import { assessPixelQuality, mergePreflightQuality } from './pixel-quality'
import type { PixelSample, PixelQualityResult } from './pixel-quality'
import type { FrameQuality } from '../pose/quality'
import calibration from './pixel-quality.calibration.json'

const BLUR_WARNING = 'Photo looks blurry — hold the camera steady and retake.'
const DARK_WARNING = 'Photo is too dark — add more light and retake.'
const BRIGHT_WARNING = 'Photo is overexposed — reduce direct light and retake.'

// Thresholds come from the calibrated JSON (lib/capture/pixel-quality.calibration.json,
// produced by e2e/pixel-calibration.spec.ts), not hardcoded — these tests pin
// the scorer's COMPARISON LOGIC (boundaries, warning combinations), not any
// particular calibrated number, so they stay honest across recalibration.
const T = calibration.thresholds
// A luma value safely inside (lumaDarkMax, lumaBrightMin) with margin on both
// sides — the "mid-range, doesn't trigger dark/bright" value used wherever a
// test needs one that won't accidentally cross either exposure threshold.
const SAFE_MID_LUMA = Math.round((T.lumaDarkMax + T.lumaBrightMin) / 2)

function flatSample(value: number, width: number, height: number): PixelSample {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = value
    data[i * 4 + 1] = value
    data[i * 4 + 2] = value
    data[i * 4 + 3] = 255
  }
  return { data, width, height }
}

// Alternating 1px checkerboard — maximal-frequency pattern, so the 3x3
// Laplacian response is large at every interior pixel.
function checkerboardSample(colorA: number, colorB: number, width: number, height: number): PixelSample {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const v = (x + y) % 2 === 0 ? colorA : colorB
      data[i * 4] = v
      data[i * 4 + 1] = v
      data[i * 4 + 2] = v
      data[i * 4 + 3] = 255
    }
  }
  return { data, width, height }
}

// The first `countA` pixels (in raster order) at gray `valueA`, the rest at
// `valueB` — sets an exact clipped fraction while keeping the mean mid-range.
function mixedSample(countA: number, valueA: number, valueB: number, width: number, height: number): PixelSample {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const v = i < countA ? valueA : valueB
    data[i * 4] = v
    data[i * 4 + 1] = v
    data[i * 4 + 2] = v
    data[i * 4 + 3] = 255
  }
  return { data, width, height }
}

// A flat field of `base` with exactly one interior pixel (at the grid center)
// bumped by `delta`. Laplacian variance for this pattern is analytically
// exact: with N interior pixels, responses are -4*delta at the outlier and
// +delta at each of its 4 neighbors (0 elsewhere, mean 0), so
// variance = (16*delta^2 + 4*delta^2) / N = 20*delta^2 / N.
function singleOutlierSample(base: number, delta: number, size: number): { sample: PixelSample; expectedSharpness: number } {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = base
    data[i * 4 + 1] = base
    data[i * 4 + 2] = base
    data[i * 4 + 3] = 255
  }
  const cx = Math.floor(size / 2)
  const cy = Math.floor(size / 2)
  const idx = cy * size + cx
  const v = base + delta
  data[idx * 4] = v
  data[idx * 4 + 1] = v
  data[idx * 4 + 2] = v

  const interiorCount = (size - 2) * (size - 2)
  const expectedSharpness = (20 * delta * delta) / interiorCount
  return { sample: { data, width: size, height: size }, expectedSharpness }
}

describe('assessPixelQuality', () => {
  it('scores a flat mid-gray image as low sharpness and warns blurry only', () => {
    const result = assessPixelQuality(flatSample(SAFE_MID_LUMA, 8, 8))
    expect(result.sharpness).toBe(0)
    expect(result.lumaMean).toBeCloseTo(SAFE_MID_LUMA, 5)
    expect(result.darkClip).toBe(0)
    expect(result.brightClip).toBe(0)
    expect(result.warnings).toEqual([BLUR_WARNING])
  })

  it('scores a fine checkerboard as high sharpness with no warnings', () => {
    // Amplitude clears both the sharpness threshold and the clip levels
    // (16/239) around the safe mid-gray mean, so no exposure warning fires.
    const amplitude = Math.min(50, SAFE_MID_LUMA - 17, 238 - SAFE_MID_LUMA)
    const result = assessPixelQuality(checkerboardSample(SAFE_MID_LUMA - amplitude, SAFE_MID_LUMA + amplitude, 8, 8))
    expect(result.sharpness).toBeGreaterThan(T.sharpnessMin)
    expect(result.lumaMean).toBeCloseTo(SAFE_MID_LUMA, 5)
    expect(result.darkClip).toBe(0)
    expect(result.brightClip).toBe(0)
    expect(result.warnings).toEqual([])
  })

  it('scores a near-black flat image as dark (and blurry, not bright)', () => {
    const result = assessPixelQuality(flatSample(5, 8, 8))
    expect(result.lumaMean).toBeCloseTo(5, 5)
    expect(result.darkClip).toBe(1)
    expect(result.brightClip).toBe(0)
    expect(result.warnings).toEqual([BLUR_WARNING, DARK_WARNING])
  })

  it('scores a near-white flat image as overexposed (and blurry, not dark)', () => {
    const result = assessPixelQuality(flatSample(250, 8, 8))
    expect(result.lumaMean).toBeCloseTo(250, 5)
    expect(result.brightClip).toBe(1)
    expect(result.darkClip).toBe(0)
    expect(result.warnings).toEqual([BLUR_WARNING, BRIGHT_WARNING])
  })

  it('warns dark on a mid-gray mean with a large crushed-shadow fraction (clip signal, not mean)', () => {
    // countA safely above darkClipMax (out of 100 pixels) at 0 (clipped dark);
    // the other pixels sit at a value chosen so the OVERALL mean still lands
    // strictly above lumaDarkMax (and below lumaBrightMin), so only the clip
    // signal can fire the dark warning.
    const countA = Math.round(T.darkClipMax * 100) + 5
    const otherValue = Math.round(Math.min(254, ((T.lumaDarkMax + T.lumaBrightMin) / 2) * (100 / (100 - countA))))
    const result = assessPixelQuality(mixedSample(countA, 0, otherValue, 10, 10))
    expect(result.lumaMean).toBeGreaterThan(T.lumaDarkMax)
    expect(result.lumaMean).toBeLessThan(T.lumaBrightMin)
    expect(result.darkClip).toBeCloseTo(countA / 100, 5)
    expect(result.warnings).toContain(DARK_WARNING)
    expect(result.warnings).not.toContain(BRIGHT_WARNING)
  })

  it('warns overexposed on a mid-gray mean with a large blown-highlight fraction (clip signal, not mean)', () => {
    // countA safely above brightClipMax (out of 100 pixels); the other value
    // (50) holds the mean well clear of lumaBrightMin regardless, so only the
    // clip signal decides.
    const countA = Math.round(T.brightClipMax * 100) + 5
    const result = assessPixelQuality(mixedSample(countA, 255, 50, 10, 10))
    expect(result.lumaMean).toBeGreaterThan(T.lumaDarkMax)
    expect(result.lumaMean).toBeLessThan(T.lumaBrightMin)
    expect(result.brightClip).toBeCloseTo(countA / 100, 5)
    expect(result.warnings).toContain(BRIGHT_WARNING)
    expect(result.warnings).not.toContain(DARK_WARNING)
  })

  describe('threshold boundaries', () => {
    it('lumaDarkMax: mean just below warns dark, just above does not (exclusive upper bound)', () => {
      if (T.lumaDarkMax > 17) {
        // Threshold safely above the dark-clip level (16): a flat gray keeps
        // darkClip at 0, so the mean channel is isolated by construction.
        const justBelow = Math.ceil(T.lumaDarkMax) - 1
        const atOrAbove = Math.ceil(T.lumaDarkMax)
        expect(assessPixelQuality(flatSample(justBelow, 6, 6)).warnings).toContain(DARK_WARNING)
        expect(assessPixelQuality(flatSample(atOrAbove, 6, 6)).warnings).not.toContain(DARK_WARNING)
      } else {
        // Threshold at/below the clip level (the post-T4 calibration: ~14):
        // any flat gray with mean < threshold is also 100% dark-clipped, so
        // isolate the mean channel with a two-level sample instead — k pixels
        // at 0, the rest at 17: the first gray strictly above the clip level
        // (gray 16 itself clips — the Rec.601 weights sum to just under 1 in
        // float, so luma(16) is a hair below 16). Mean = (1 - k/N) * 17
        // straddles the threshold while darkClip = k/N stays under
        // darkClipMax. One extra granularity step on each side keeps the
        // comparison clear of float rounding in the luma sum.
        const total = 10_000
        const kAtThreshold = Math.floor((1 - T.lumaDarkMax / 17) * total)
        const kBelow = kAtThreshold + 2
        const kAbove = kAtThreshold - 1
        expect(kBelow / total).toBeLessThanOrEqual(T.darkClipMax) // precondition: clip channel stays quiet

        const below = assessPixelQuality(mixedSample(kBelow, 0, 17, 100, 100))
        expect(below.lumaMean).toBeLessThan(T.lumaDarkMax)
        expect(below.darkClip).toBeLessThanOrEqual(T.darkClipMax)
        expect(below.warnings).toContain(DARK_WARNING)

        const above = assessPixelQuality(mixedSample(kAbove, 0, 17, 100, 100))
        expect(above.lumaMean).toBeGreaterThan(T.lumaDarkMax)
        expect(above.warnings).not.toContain(DARK_WARNING)
      }
    })

    it('lumaBrightMin: smallest gray above warns overexposed, largest at/below does not (exclusive lower bound)', () => {
      const justAbove = Math.floor(T.lumaBrightMin) + 1
      const atOrBelow = Math.floor(T.lumaBrightMin)
      expect(assessPixelQuality(flatSample(justAbove, 6, 6)).warnings).toContain(BRIGHT_WARNING)
      expect(assessPixelQuality(flatSample(atOrBelow, 6, 6)).warnings).not.toContain(BRIGHT_WARNING)
    })

    it('darkClipMax: one fraction-unit above warns dark, exactly at the threshold does not (exclusive bound)', () => {
      // 10,000-pixel base gives exact-fraction granularity for any 4-sig-fig
      // threshold. The other value (200) holds the mean well clear of
      // lumaDarkMax regardless, so only the clip signal decides.
      const atBoundary = Math.round(T.darkClipMax * 10_000)
      expect(assessPixelQuality(mixedSample(atBoundary + 1, 0, 200, 100, 100)).warnings).toContain(DARK_WARNING)
      expect(assessPixelQuality(mixedSample(atBoundary, 0, 200, 100, 100)).warnings).not.toContain(DARK_WARNING)
    })

    it('brightClipMax: one fraction-unit above warns overexposed, exactly at the threshold does not (exclusive bound)', () => {
      // The other value (50) holds the mean well clear of lumaBrightMin
      // regardless of the (large) clipped fraction, so only the clip signal decides.
      const atBoundary = Math.round(T.brightClipMax * 10_000)
      expect(assessPixelQuality(mixedSample(atBoundary + 1, 255, 50, 100, 100)).warnings).toContain(BRIGHT_WARNING)
      expect(assessPixelQuality(mixedSample(atBoundary, 255, 50, 100, 100)).warnings).not.toContain(BRIGHT_WARNING)
    })

    it('sharpnessMin: a single-pixel outlier straddling the threshold pins the blur decision exactly', () => {
      const size = 6
      const interiorCount = (size - 2) * (size - 2) // 16
      // Laplacian variance for this pattern is analytically exact (see
      // singleOutlierSample): 20*delta^2/interiorCount. Solve for the delta
      // at the threshold, then step to the integers straddling it.
      const exactDelta = Math.sqrt((T.sharpnessMin * interiorCount) / 20)
      const belowDelta = Math.max(1, Math.floor(exactDelta - 1e-6))
      const aboveDelta = belowDelta + 1

      const below = singleOutlierSample(SAFE_MID_LUMA, belowDelta, size)
      expect(below.expectedSharpness).toBeLessThan(T.sharpnessMin)
      const belowResult = assessPixelQuality(below.sample)
      expect(belowResult.sharpness).toBeCloseTo(below.expectedSharpness, 5)
      expect(belowResult.warnings).toContain(BLUR_WARNING)

      const above = singleOutlierSample(SAFE_MID_LUMA, aboveDelta, size)
      expect(above.expectedSharpness).toBeGreaterThan(T.sharpnessMin)
      const aboveResult = assessPixelQuality(above.sample)
      expect(aboveResult.sharpness).toBeCloseTo(above.expectedSharpness, 5)
      expect(aboveResult.warnings).not.toContain(BLUR_WARNING)
    })
  })

  it('images too thin for a Laplacian interior (width or height < 3) get sharpness 0', () => {
    // High-contrast checkerboards, so any nonzero-sharpness path would score high.
    const thinWidth = assessPixelQuality(checkerboardSample(0, 255, 2, 8))
    expect(thinWidth.sharpness).toBe(0)
    expect(thinWidth.warnings).toContain(BLUR_WARNING)

    const thinHeight = assessPixelQuality(checkerboardSample(0, 255, 8, 2))
    expect(thinHeight.sharpness).toBe(0)
    expect(thinHeight.warnings).toContain(BLUR_WARNING)
  })

  it('does not mutate the input pixel buffer', () => {
    const sample = checkerboardSample(10, 240, 8, 8)
    const before = Uint8ClampedArray.from(sample.data)
    assessPixelQuality(sample)
    expect(sample.data).toEqual(before)
  })

  it('throws on empty/zero-size input', () => {
    expect(() => assessPixelQuality({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toThrow()
    expect(() => assessPixelQuality({ data: new Uint8ClampedArray(0), width: 5, height: 0 })).toThrow()
    expect(() => assessPixelQuality({ data: new Uint8ClampedArray(0), width: 0, height: 5 })).toThrow()
  })
})

describe('mergePreflightQuality', () => {
  const ok: FrameQuality = { status: 'ok', warnings: [] }
  const withWarnings: FrameQuality = { status: 'warnings', warnings: ['Shoulders not clearly visible — step back or turn to face the camera directly.'] }
  const noPerson: FrameQuality = { status: 'no_person', warnings: [] }

  const pixelWarnings: PixelQualityResult = {
    sharpness: 10, lumaMean: 128, darkClip: 0, brightClip: 0, warnings: [BLUR_WARNING],
  }
  const pixelClean: PixelQualityResult = {
    sharpness: 500, lumaMean: 128, darkClip: 0, brightClip: 0, warnings: [],
  }

  it('ok + pixel warnings → warnings, pixel warnings only', () => {
    expect(mergePreflightQuality(ok, pixelWarnings)).toEqual({ status: 'warnings', warnings: [BLUR_WARNING] })
  })

  it('ok + clean pixelQuality (no pixel warnings) → ok verbatim', () => {
    expect(mergePreflightQuality(ok, pixelClean)).toEqual(ok)
  })

  it('warnings + pixel warnings → concatenated, pixel warnings last', () => {
    expect(mergePreflightQuality(withWarnings, pixelWarnings)).toEqual({
      status: 'warnings',
      warnings: [...withWarnings.warnings, BLUR_WARNING],
    })
  })

  it('warnings + clean pixelQuality → warnings verbatim, unchanged', () => {
    expect(mergePreflightQuality(withWarnings, pixelClean)).toEqual(withWarnings)
  })

  it('no_person + pixel warnings → no_person unchanged (hard block wins)', () => {
    expect(mergePreflightQuality(noPerson, pixelWarnings)).toEqual(noPerson)
  })

  it('no_person + clean pixelQuality → no_person unchanged', () => {
    expect(mergePreflightQuality(noPerson, pixelClean)).toEqual(noPerson)
  })

  it('null pixelQuality → frameQuality verbatim, for every status', () => {
    expect(mergePreflightQuality(ok, null)).toEqual(ok)
    expect(mergePreflightQuality(withWarnings, null)).toEqual(withWarnings)
    expect(mergePreflightQuality(noPerson, null)).toEqual(noPerson)
  })
})

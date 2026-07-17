import { describe, it, expect } from 'vitest'
import { assessPixelQuality, mergePreflightQuality } from './pixel-quality'
import type { PixelSample, PixelQualityResult } from './pixel-quality'
import type { FrameQuality } from '../pose/quality'

const BLUR_WARNING = 'Photo looks blurry — hold the camera steady and retake.'
const DARK_WARNING = 'Photo is too dark — add more light and retake.'
const BRIGHT_WARNING = 'Photo is overexposed — reduce direct light and retake.'

// Calibration placeholder (lib/capture/pixel-quality.calibration.json):
// sharpnessMin 50, lumaDarkMax 40, lumaBrightMin 215,
// darkClipMax 0.3, brightClipMax 0.3.

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
    const result = assessPixelQuality(flatSample(128, 8, 8))
    expect(result.sharpness).toBe(0)
    expect(result.lumaMean).toBeCloseTo(128, 5)
    expect(result.darkClip).toBe(0)
    expect(result.brightClip).toBe(0)
    expect(result.warnings).toEqual([BLUR_WARNING])
  })

  it('scores a fine checkerboard as high sharpness with no warnings', () => {
    // 32/224 stays clear of both clip levels (16/239) so no exposure warning fires.
    const result = assessPixelQuality(checkerboardSample(32, 224, 8, 8))
    expect(result.sharpness).toBeGreaterThan(50)
    expect(result.lumaMean).toBeCloseTo(128, 5)
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
    // 40 of 100 pixels at 0 (clipped dark), 60 at 213 → mean ≈ 127.8 (normal),
    // darkClip = 0.4 > darkClipMax 0.3.
    const result = assessPixelQuality(mixedSample(40, 0, 213, 10, 10))
    expect(result.lumaMean).toBeGreaterThan(40)
    expect(result.lumaMean).toBeLessThan(215)
    expect(result.darkClip).toBeCloseTo(0.4, 5)
    expect(result.warnings).toContain(DARK_WARNING)
    expect(result.warnings).not.toContain(BRIGHT_WARNING)
  })

  it('warns overexposed on a mid-gray mean with a large blown-highlight fraction (clip signal, not mean)', () => {
    // 40 of 100 pixels at 255 (clipped bright), 60 at 43 → mean ≈ 127.8 (normal),
    // brightClip = 0.4 > brightClipMax 0.3.
    const result = assessPixelQuality(mixedSample(40, 255, 43, 10, 10))
    expect(result.lumaMean).toBeGreaterThan(40)
    expect(result.lumaMean).toBeLessThan(215)
    expect(result.brightClip).toBeCloseTo(0.4, 5)
    expect(result.warnings).toContain(BRIGHT_WARNING)
    expect(result.warnings).not.toContain(DARK_WARNING)
  })

  describe('threshold boundaries', () => {
    it('lumaDarkMax=40: 39 warns dark, 40 does not (exclusive upper bound)', () => {
      expect(assessPixelQuality(flatSample(39, 6, 6)).warnings).toContain(DARK_WARNING)
      expect(assessPixelQuality(flatSample(40, 6, 6)).warnings).not.toContain(DARK_WARNING)
    })

    it('lumaBrightMin=215: 216 warns overexposed, 215 does not (exclusive lower bound)', () => {
      expect(assessPixelQuality(flatSample(216, 6, 6)).warnings).toContain(BRIGHT_WARNING)
      expect(assessPixelQuality(flatSample(215, 6, 6)).warnings).not.toContain(BRIGHT_WARNING)
    })

    it('darkClipMax=0.3: clip fraction 0.31 warns dark, exactly 0.30 does not (exclusive bound)', () => {
      // Mean stays mid-range in both cases, so only the clip signal decides.
      expect(assessPixelQuality(mixedSample(31, 0, 180, 10, 10)).warnings).toContain(DARK_WARNING)
      expect(assessPixelQuality(mixedSample(30, 0, 180, 10, 10)).warnings).not.toContain(DARK_WARNING)
    })

    it('brightClipMax=0.3: clip fraction 0.31 warns overexposed, exactly 0.30 does not (exclusive bound)', () => {
      expect(assessPixelQuality(mixedSample(31, 255, 73, 10, 10)).warnings).toContain(BRIGHT_WARNING)
      expect(assessPixelQuality(mixedSample(30, 255, 73, 10, 10)).warnings).not.toContain(BRIGHT_WARNING)
    })

    it('sharpnessMin=50: a single-pixel outlier straddling the threshold pins the blur decision exactly', () => {
      const below = singleOutlierSample(128, 6, 6) // 20*36/16 = 45 < 50
      expect(below.expectedSharpness).toBeCloseTo(45, 5)
      const belowResult = assessPixelQuality(below.sample)
      expect(belowResult.sharpness).toBeCloseTo(45, 5)
      expect(belowResult.warnings).toContain(BLUR_WARNING)

      const above = singleOutlierSample(128, 7, 6) // 20*49/16 = 61.25 > 50
      expect(above.expectedSharpness).toBeCloseTo(61.25, 5)
      const aboveResult = assessPixelQuality(above.sample)
      expect(aboveResult.sharpness).toBeCloseTo(61.25, 5)
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

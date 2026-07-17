// Phase-1 T1b acceptance: the calibrated thresholds must produce 0 warnings
// on every normal fixture and the expected warning(s) on every degraded
// fixture, per the labeled fixture matrix committed in
// pixel-quality.calibration.json (perFixture — real values from
// e2e/pixel-calibration.spec.ts, computed by the PRODUCTION sampler+scorer
// over the committed photos, in a real browser).
//
// This runs in node (no browser/canvas here), so it can't replay the actual
// JPEG pixels. Instead it builds a synthetic PixelSample per fixture that
// reproduces that fixture's calibrated lumaMean exactly and its sharpness on
// the correct side of sharpnessMin (checkerboard when the fixture must read
// as sharp, flat when it must read as blurry) — then runs the REAL
// assessPixelQuality threshold comparisons against it. Reproducing the exact
// source-photo pixels isn't the point; classifying the same lumaMean/
// sharpness magnitudes the calibration observed, through the unmodified
// scorer, is.
import { describe, it, expect } from 'vitest'
import { assessPixelQuality } from './pixel-quality'
import type { PixelSample } from './pixel-quality'
import calibration from './pixel-quality.calibration.json'

const BLUR_WARNING = 'Photo looks blurry — hold the camera steady and retake.'
const DARK_WARNING = 'Photo is too dark — add more light and retake.'
const BRIGHT_WARNING = 'Photo is overexposed — reduce direct light and retake.'

const SIZE = 40 // 40x40 -> 1444 interior pixels, plenty for a stable checkerboard variance

// Builds a PixelSample whose luma mean matches `lumaMean` and whose
// sharpness lands clearly on the correct side of the calibrated
// sharpnessMin: a checkerboard around lumaMean when `sharp` is true (the
// variance of a perfectly alternating +-A checkerboard is exactly 64*A^2 —
// each interior pixel's 4 neighbors are all the opposite color, so
// lap = 4*(opposite - own) = +-8A, and Var(+-8A) = 64*A^2 — solved for a
// target comfortably above sharpnessMin), or a flat fill (sharpness exactly
// 0) when `sharp` is false.
function buildSample(lumaMean: number, sharp: boolean): PixelSample {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  if (!sharp) {
    const v = Math.round(lumaMean)
    for (let i = 0; i < SIZE * SIZE; i++) {
      data[i * 4] = v
      data[i * 4 + 1] = v
      data[i * 4 + 2] = v
      data[i * 4 + 3] = 255
    }
    return { data, width: SIZE, height: SIZE }
  }

  const targetSharpness = calibration.thresholds.sharpnessMin * 4 // generous margin over the threshold
  const amplitude = Math.max(2, Math.sqrt(targetSharpness / 64))
  const colorA = Math.round(Math.min(255, Math.max(0, lumaMean - amplitude)))
  const colorB = Math.round(Math.min(255, Math.max(0, lumaMean + amplitude)))
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x
      const v = (x + y) % 2 === 0 ? colorA : colorB
      data[i * 4] = v
      data[i * 4 + 1] = v
      data[i * 4 + 2] = v
      data[i * 4 + 3] = 255
    }
  }
  return { data, width: SIZE, height: SIZE }
}

// The camera (720px, source-side) reading is used as the representative
// value for each fixture — both source sizes were within-margin at
// calibration time, so either would classify the same way.
const perFixture = calibration.perFixture

describe('pixel-quality matrix (calibrated thresholds)', () => {
  // The measured (browser-lane) per-fixture values themselves must sit on the
  // correct side of each calibrated threshold, at BOTH source sizes — this
  // pins the acceptance directly to the committed calibration artifact rather
  // than trusting this file's synthetic-sample construction.
  it('committed per-fixture metrics classify correctly against the committed thresholds (both source sizes)', () => {
    for (const source of ['camera', 'upload'] as const) {
      // Sharpness: normal and overexposed above sharpnessMin (no blur FP);
      // blurry below; dark also below (documented dual-warning finding).
      expect(perFixture.normal[source].sharpness).toBeGreaterThan(calibration.thresholds.sharpnessMin)
      expect(perFixture.overexposed[source].sharpness).toBeGreaterThan(calibration.thresholds.sharpnessMin)
      expect(perFixture.blurry[source].sharpness).toBeLessThan(calibration.thresholds.sharpnessMin)
      expect(perFixture.dark[source].sharpness).toBeLessThan(calibration.thresholds.sharpnessMin)

      // Luma mean: only the dark fixture below lumaDarkMax; only the
      // overexposed fixture above lumaBrightMin.
      expect(perFixture.normal[source].lumaMean).toBeGreaterThan(calibration.thresholds.lumaDarkMax)
      expect(perFixture.normal[source].lumaMean).toBeLessThan(calibration.thresholds.lumaBrightMin)
      expect(perFixture.blurry[source].lumaMean).toBeGreaterThan(calibration.thresholds.lumaDarkMax)
      expect(perFixture.blurry[source].lumaMean).toBeLessThan(calibration.thresholds.lumaBrightMin)
      expect(perFixture.dark[source].lumaMean).toBeLessThan(calibration.thresholds.lumaDarkMax)
      expect(perFixture.overexposed[source].lumaMean).toBeGreaterThan(calibration.thresholds.lumaBrightMin)

      // Clip fractions: no fixture may false-positive through the clip
      // channel except overexposed through brightClip (its intended signal
      // is lumaMean; brightClip firing too is consistent, not a FP).
      expect(perFixture.normal[source].darkClip).toBeLessThanOrEqual(calibration.thresholds.darkClipMax)
      expect(perFixture.normal[source].brightClip).toBeLessThanOrEqual(calibration.thresholds.brightClipMax)
      expect(perFixture.blurry[source].darkClip).toBeLessThanOrEqual(calibration.thresholds.darkClipMax)
      expect(perFixture.blurry[source].brightClip).toBeLessThanOrEqual(calibration.thresholds.brightClipMax)
      expect(perFixture.dark[source].brightClip).toBeLessThanOrEqual(calibration.thresholds.brightClipMax)
      expect(perFixture.overexposed[source].darkClip).toBeLessThanOrEqual(calibration.thresholds.darkClipMax)
    }
  })

  it('normal fixture: 0 warnings', () => {
    const sample = buildSample(perFixture.normal.camera.lumaMean, true)
    const result = assessPixelQuality(sample)
    expect(result.warnings).toEqual([])
  })

  it('blurry fixture: blur warning only', () => {
    const sample = buildSample(perFixture.blurry.camera.lumaMean, false)
    const result = assessPixelQuality(sample)
    expect(result.warnings).toEqual([BLUR_WARNING])
  })

  // Known finding (documented, not a bug): a uniform exposure multiply scales
  // the Laplacian linearly, so its variance scales by the SQUARE of the
  // exposure factor (×0.35 here -> ~0.1225x). At every calibration-candidate
  // scale, that reduction is larger than gaussian blur (sigma=3)'s own
  // reduction, so the darkened fixture's sharpness sits BELOW sharpnessMin
  // too — it is mathematically impossible for a threshold to catch the
  // blurry fixture (which requires sharpnessMin > blurry's sharpness) without
  // also catching the dark fixture (whose sharpness is even lower). This is
  // inherent to the pure-luma-Laplacian scorer + the PRD's fixed degradation
  // parameters, not a calibration bug — see the calibration spec for the
  // real per-fixture numbers.
  it('dark fixture: dark warning, AND blur warning (see comment above)', () => {
    const sample = buildSample(perFixture.dark.camera.lumaMean, false)
    const result = assessPixelQuality(sample)
    expect(result.warnings).toEqual([BLUR_WARNING, DARK_WARNING])
  })

  it('overexposed fixture: bright warning only', () => {
    const sample = buildSample(perFixture.overexposed.camera.lumaMean, true)
    const result = assessPixelQuality(sample)
    expect(result.warnings).toEqual([BRIGHT_WARNING])
  })
})

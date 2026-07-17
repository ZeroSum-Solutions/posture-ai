// Phase-1 T1b acceptance: the calibrated thresholds must produce 0 warnings
// on every normal fixture (front, side, back — ALL committed normals, post-T4
// amendment) and the expected warning(s) on every degraded fixture, per the
// labeled fixture matrix committed in pixel-quality.calibration.json
// (perFixture — real values from e2e/pixel-calibration.spec.ts, computed by
// the PRODUCTION sampler+scorer over the committed photos, in a real browser).
//
// This runs in node (no browser/canvas here), so it can't replay the actual
// JPEG pixels. Two layers instead:
// 1. Direct assertions on the committed per-fixture metrics against the
//    committed thresholds — pinning the acceptance to the calibration
//    artifact itself.
// 2. Synthetic samples reproducing each fixture's calibrated lumaMean and a
//    sharpness on the measured side of sharpnessMin, classified through the
//    REAL assessPixelQuality — pinning the scorer's comparison logic.
import { describe, it, expect } from 'vitest'
import { assessPixelQuality } from './pixel-quality'
import type { PixelSample } from './pixel-quality'
import calibration from './pixel-quality.calibration.json'

const BLUR_WARNING = 'Photo looks blurry — hold the camera steady and retake.'
const BRIGHT_WARNING = 'Photo is overexposed — reduce direct light and retake.'

const NORMAL_KEYS = ['normal_front', 'normal_side', 'normal_back'] as const

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
const T = calibration.thresholds

describe('pixel-quality matrix (calibrated thresholds)', () => {
  // The measured (browser-lane) per-fixture values themselves must sit on the
  // correct side of each calibrated threshold, at BOTH source sizes — this
  // pins the acceptance directly to the committed calibration artifact rather
  // than trusting this file's synthetic-sample construction.
  it('committed per-fixture metrics classify correctly against the committed thresholds (both source sizes)', () => {
    for (const source of ['camera', 'upload'] as const) {
      // Sharpness: every normal and the overexposed fixture above
      // sharpnessMin (no blur FP anywhere in the normal population); blurry
      // below; dark also below (documented dual-degradation finding — a
      // uniform x0.35 multiply scales Laplacian variance by 0.35^2).
      for (const normalKey of NORMAL_KEYS) {
        expect(perFixture[normalKey][source].sharpness).toBeGreaterThan(T.sharpnessMin)
      }
      expect(perFixture.overexposed[source].sharpness).toBeGreaterThan(T.sharpnessMin)
      expect(perFixture.blurry[source].sharpness).toBeLessThan(T.sharpnessMin)
      expect(perFixture.dark[source].sharpness).toBeLessThan(T.sharpnessMin)

      // Luma mean: every normal inside the (lumaDarkMax, lumaBrightMin) band;
      // only the overexposed fixture above lumaBrightMin.
      for (const normalKey of NORMAL_KEYS) {
        expect(perFixture[normalKey][source].lumaMean).toBeGreaterThan(T.lumaDarkMax)
        expect(perFixture[normalKey][source].lumaMean).toBeLessThan(T.lumaBrightMin)
      }
      expect(perFixture.blurry[source].lumaMean).toBeGreaterThan(T.lumaDarkMax)
      expect(perFixture.blurry[source].lumaMean).toBeLessThan(T.lumaBrightMin)
      expect(perFixture.overexposed[source].lumaMean).toBeGreaterThan(T.lumaBrightMin)

      // DOCUMENTED LIMITATION (post-T4 amendment): the dark fixture's
      // lumaMean (~70) sits ABOVE lumaDarkMax, because side/back normals are
      // natively darker (~45/~28 mean luma; dark backgrounds) than the
      // x0.35-degraded front fixture, and the PRD's 0-FP-on-normals bias is
      // binding — no lumaDarkMax can catch the degraded-dark fixture without
      // false-positive-ing on committed normals. Asserted here so the
      // limitation is pinned, not hidden.
      expect(perFixture.dark[source].lumaMean).toBeGreaterThan(T.lumaDarkMax)

      // Clip fractions: no fixture may false-positive through the clip
      // channel except overexposed through brightClip (its intended signal
      // is lumaMean; brightClip firing too is consistent, not a FP). The
      // dark fixture's darkClip (~0.003) is likewise uncatchable —
      // back_standing's dark background alone clips ~66% of the frame — so
      // it too must sit under darkClipMax.
      for (const normalKey of NORMAL_KEYS) {
        expect(perFixture[normalKey][source].darkClip).toBeLessThanOrEqual(T.darkClipMax)
        expect(perFixture[normalKey][source].brightClip).toBeLessThanOrEqual(T.brightClipMax)
      }
      expect(perFixture.blurry[source].darkClip).toBeLessThanOrEqual(T.darkClipMax)
      expect(perFixture.blurry[source].brightClip).toBeLessThanOrEqual(T.brightClipMax)
      expect(perFixture.dark[source].darkClip).toBeLessThanOrEqual(T.darkClipMax)
      expect(perFixture.dark[source].brightClip).toBeLessThanOrEqual(T.brightClipMax)
      expect(perFixture.overexposed[source].darkClip).toBeLessThanOrEqual(T.darkClipMax)
    }
  })

  it.each(NORMAL_KEYS.map(key => [key] as const))('%s fixture: 0 warnings', key => {
    const sample = buildSample(perFixture[key].camera.lumaMean, true)
    const result = assessPixelQuality(sample)
    expect(result.warnings).toEqual([])
  })

  it('blurry fixture: blur warning only', () => {
    const sample = buildSample(perFixture.blurry.camera.lumaMean, false)
    const result = assessPixelQuality(sample)
    expect(result.warnings).toEqual([BLUR_WARNING])
  })

  // Known finding, extended by the post-T4 amendment: the dark fixture gets
  // ONLY the blur warning. (1) A uniform exposure multiply scales the
  // Laplacian linearly, so its variance scales by the SQUARE of the factor
  // (x0.35 -> ~0.1225x) — at every candidate scale that reduction exceeds
  // gaussian sigma=3's own, so dark's sharpness sits below sharpnessMin
  // whenever blurry's does. (2) With side/back in the normal population, the
  // dark-exposure channel cannot fire on it at all: side (~45) and back
  // (~28) normals are natively darker than the degraded fixture (~70), and
  // 0-FP-on-normals is the binding PRD bias, so lumaDarkMax sits below all
  // of them. Inherent to the scorer + these committed (interim, stock)
  // fixtures, not a calibration bug — see the calibration spec's derivation
  // comments and the README's note that these fixtures are interim.
  it('dark fixture: blur warning only (dark channel honestly uncatchable — see comment)', () => {
    const sample = buildSample(perFixture.dark.camera.lumaMean, false)
    const result = assessPixelQuality(sample)
    expect(result.warnings).toEqual([BLUR_WARNING])
  })

  it('overexposed fixture: bright warning only', () => {
    const sample = buildSample(perFixture.overexposed.camera.lumaMean, true)
    const result = assessPixelQuality(sample)
    expect(result.warnings).toEqual([BRIGHT_WARNING])
  })
})

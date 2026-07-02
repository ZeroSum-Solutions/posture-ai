/**
 * Within-capture stability (engine 1.3.0).
 * A multi-frame burst per view lets the engine (a) take a robust median point
 * estimate that rejects a jittery outlier frame and (b) surface how much each
 * finding's own number wobbled across the burst as uncertaintyDeg / stabilityScore.
 * A single frame per view (every legacy assessment) behaves EXACTLY as before and
 * carries no stability fields — we never fabricate a stability from one sample.
 *
 * NOTE (honesty): this measures WITHIN-CAPTURE landmark/detector stability, NOT
 * test-retest repeatability (which would require re-positioning between captures).
 */
import { describe, it, expect } from 'vitest'
import { assessPosture } from '../src'
import type { PoseFrame } from '../src'

// FHP side fixture: ear=(0.570,0.150), shoulder=(0.500,0.250) → deviation ≈ 34.99°
function fhpSide(earX: number): PoseFrame {
  return {
    view: 'side',
    landmarks: {
      left_ear:       { x: earX,  y: 0.150, visibility: 0.90 },
      right_ear:      { x: 0.560, y: 0.150, visibility: 0.10 },
      left_shoulder:  { x: 0.500, y: 0.250, visibility: 0.90 },
      right_shoulder: { x: 0.510, y: 0.250, visibility: 0.10 },
      left_hip:       { x: 0.500, y: 0.550, visibility: 0.90 },
      right_hip:      { x: 0.505, y: 0.550, visibility: 0.10 },
      left_knee:      { x: 0.500, y: 0.750, visibility: 0.90 },
      right_knee:     { x: 0.505, y: 0.750, visibility: 0.10 },
      left_ankle:     { x: 0.500, y: 0.930, visibility: 0.90 },
      right_ankle:    { x: 0.505, y: 0.930, visibility: 0.10 },
    },
  }
}

const FRONT: PoseFrame = {
  view: 'front',
  landmarks: {
    left_shoulder:  { x: 0.350, y: 0.220, visibility: 0.90 },
    right_shoulder: { x: 0.650, y: 0.220, visibility: 0.90 },
    left_hip:       { x: 0.380, y: 0.530, visibility: 0.90 },
    right_hip:      { x: 0.620, y: 0.530, visibility: 0.90 },
    left_knee:      { x: 0.380, y: 0.730, visibility: 0.90 },
    right_knee:     { x: 0.620, y: 0.730, visibility: 0.90 },
    left_ankle:     { x: 0.380, y: 0.930, visibility: 0.90 },
    right_ankle:    { x: 0.620, y: 0.930, visibility: 0.90 },
  },
}

const fhp = (r: ReturnType<typeof assessPosture>) => r.findings.find((f) => f.key === 'forward_head_posture')!

describe('within-capture stability', () => {
  it('a burst of identical frames yields uncertaintyDeg 0 and stabilityScore 1', () => {
    const r = assessPosture([FRONT, fhpSide(0.570), fhpSide(0.570), fhpSide(0.570)])
    const f = fhp(r)
    expect(f.deviation).toBeCloseTo(34.99, 1)
    expect(f.uncertaintyDeg).toBe(0)
    expect(f.stabilityScore).toBe(1)
  })

  it('rejects a single outlier frame from the point estimate (robust median)', () => {
    // 3 good ear positions + 1 wild outlier; the median ignores the outlier so
    // the reported deviation stays ~34.99, but the spread lifts uncertaintyDeg > 0.
    const r = assessPosture([FRONT, fhpSide(0.570), fhpSide(0.570), fhpSide(0.570), fhpSide(0.400)])
    const f = fhp(r)
    expect(f.deviation).toBeCloseTo(34.99, 1)
    expect(f.uncertaintyDeg).toBeGreaterThan(0)
    expect(f.stabilityScore).toBeLessThan(1)
    expect(f.stabilityScore).toBeGreaterThanOrEqual(0)
  })

  it('attaches NO stability fields for a single frame per view (back-compat)', () => {
    const r = assessPosture([FRONT, fhpSide(0.570)])
    const f = fhp(r)
    expect(f.deviation).toBeCloseTo(34.99, 1)
    expect(f.uncertaintyDeg).toBeUndefined()
    expect(f.stabilityScore).toBeUndefined()
    expect(r.captureStability ?? null).toBeNull()
  })

  it('reports an aggregate captureStability in [0,1] for a multi-frame capture', () => {
    const r = assessPosture([FRONT, fhpSide(0.570), fhpSide(0.572), fhpSide(0.568)])
    expect(typeof r.captureStability).toBe('number')
    expect(r.captureStability!).toBeGreaterThanOrEqual(0)
    expect(r.captureStability!).toBeLessThanOrEqual(1)
  })
})

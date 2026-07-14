import { describe, it, expect } from 'vitest'
import { shutterGate } from './shutter-gate'
import type { ToViewport } from './shutter-gate'
import { sourceToViewport } from './overlay-transform'
import type { Landmark } from '@posture-ai/engine/types'

const p = (x: number, y: number, v = 0.9): Landmark => ({ x, y, visibility: v })

// Identity transform: source coords already equal viewport coords (no crop).
const ID: ToViewport = (pt) => pt

// A well-framed, centered full-body pose: feet at x≈0.5, everything in [0,1].
function goodPose(): Record<string, Landmark> {
  return {
    nose: p(0.5, 0.10), left_ear: p(0.47, 0.11), right_ear: p(0.53, 0.11),
    left_shoulder: p(0.40, 0.30), right_shoulder: p(0.60, 0.30),
    left_hip: p(0.45, 0.55), right_hip: p(0.55, 0.55),
    left_knee: p(0.45, 0.75), right_knee: p(0.55, 0.75),
    left_ankle: p(0.45, 0.95), right_ankle: p(0.55, 0.95),
  }
}

describe('shutterGate (§4.2 translation-only)', () => {
  it('allows a centered, in-frame, level shot', () => {
    const r = shutterGate({ landmarks: goodPose(), toViewport: ID, rollDeg: 0, overrideActive: false })
    expect(r.allowed).toBe(true)
    expect(r.factors).toEqual({ tilt: 'ok', centering: 'ok', inFrame: 'ok' })
    expect(r.coach).toBeNull()
  })

  it('blocks on tilt beyond 5° and coaches the phone first', () => {
    const r = shutterGate({ landmarks: goodPose(), toViewport: ID, rollDeg: 8, overrideActive: false })
    expect(r.allowed).toBe(false)
    expect(r.factors.tilt).toBe('blocked')
    expect(r.coach).toBe('Straighten the phone')
  })

  it('treats 5° as level and 6° as tilted (band boundary)', () => {
    expect(shutterGate({ landmarks: goodPose(), toViewport: ID, rollDeg: 5, overrideActive: false }).factors.tilt).toBe('ok')
    expect(shutterGate({ landmarks: goodPose(), toViewport: ID, rollDeg: 6, overrideActive: false }).factors.tilt).toBe('blocked')
  })

  it('blocks when the support base is off-center (feet not near screen center)', () => {
    const lm = goodPose()
    lm.left_ankle = p(0.05, 0.95); lm.right_ankle = p(0.15, 0.95) // anchorX = 0.10
    const r = shutterGate({ landmarks: lm, toViewport: ID, rollDeg: null, overrideActive: false })
    expect(r.factors.centering).toBe('blocked')
    expect(r.allowed).toBe(false)
    expect(r.coach).toBe('Line up with the center line')
  })

  it('disables only centering when the support base is unavailable (profile: one ankle)', () => {
    const lm = goodPose()
    delete lm.left_ankle; delete lm.left_knee; delete lm.left_hip // far side occluded
    const r = shutterGate({ landmarks: lm, toViewport: ID, rollDeg: 0, overrideActive: false })
    expect(r.factors.centering).toBe('na') // supportAnchor null → centering off
    expect(r.factors.inFrame).toBe('ok')   // head + near ankle still in frame
    expect(r.allowed).toBe(true)
  })

  it('falls back to tilt-only when there is no live tracking (degraded worker)', () => {
    expect(shutterGate({ landmarks: null, toViewport: ID, rollDeg: 0, overrideActive: false }))
      .toMatchObject({ allowed: true, factors: { tilt: 'ok', centering: 'na', inFrame: 'na' } })
    // Fewer than 4 visible landmarks also counts as no tracking.
    expect(shutterGate({ landmarks: { nose: p(0.5, 0.1) }, toViewport: ID, rollDeg: null, overrideActive: false }).factors.inFrame).toBe('na')
  })

  it('disables centering + framing when the viewport transform is unknown', () => {
    const r = shutterGate({ landmarks: goodPose(), toViewport: null, rollDeg: 3, overrideActive: false })
    expect(r.factors).toEqual({ tilt: 'ok', centering: 'na', inFrame: 'na' })
    expect(r.allowed).toBe(true)
  })

  it('blocks framing when a joint is pushed outside the frame (feet still centered)', () => {
    const lm = goodPose()
    lm.right_shoulder = p(1.2, 0.30) // shoulder out of frame; ankles stay at 0.45/0.55 → centered
    const r = shutterGate({ landmarks: lm, toViewport: ID, rollDeg: null, overrideActive: false })
    expect(r.factors.centering).toBe('ok')
    expect(r.factors.inFrame).toBe('blocked')
    expect(r.coach).toBe('Fit your whole body in the frame')
  })

  it('manual override bypasses every translation-only gate', () => {
    const lm = goodPose()
    lm.left_ankle = p(0.02, 0.95); lm.right_ankle = p(0.05, 0.95); lm.right_hip = p(1.3, 0.55)
    const r = shutterGate({ landmarks: lm, toViewport: ID, rollDeg: 30, overrideActive: true })
    expect(r.allowed).toBe(true)
    expect(r.coach).toBeNull()
  })

  // Fix 1 (Codex GO-blocker): gate in the coordinate space the user SEES. A raw
  // anchor that passes the raw tolerance can display off-center under cover-crop.
  describe('gates in viewport space through the cover-crop affine (§11.7)', () => {
    const t = sourceToViewport({ srcW: 720, srcH: 960, vpW: 390, vpH: 844, mirror: false })
    it('blocks a raw-near-center anchor that displays outside tolerance', () => {
      const lm = goodPose()
      lm.left_ankle = p(0.60, 0.95); lm.right_ankle = p(0.64, 0.95) // raw anchorX 0.62 (|Δ|=0.12 ≤ 0.15)
      // …but under cover-crop this displays at ~0.695 (|Δ|≈0.195 > 0.15).
      expect(t.toViewport({ x: 0.62, y: 0.95 }).x).toBeGreaterThan(0.65)
      const r = shutterGate({ landmarks: lm, toViewport: t.toViewport, rollDeg: null, overrideActive: false })
      expect(r.factors.centering).toBe('blocked')
    })
    it('blocks framing when a joint is cropped off-screen by cover-crop (raw x in [0,1])', () => {
      const lm = goodPose()
      lm.nose = p(0.05, 0.10) // raw in-bounds, but maps to viewport x < 0 (cropped left edge)
      expect(t.toViewport({ x: 0.05, y: 0.10 }).x).toBeLessThan(0)
      const r = shutterGate({ landmarks: lm, toViewport: t.toViewport, rollDeg: null, overrideActive: false })
      expect(r.factors.inFrame).toBe('blocked')
    })
  })

  // Correctness invariant #6: the gate is independent of the posture midline's
  // angle/shape. Hold the support base fixed and deform lean / shoulder-tilt /
  // head-carriage / single-knee-bend — the gate decision must not move.
  it('is invariant to posture deformation while the support base is fixed', () => {
    const baseline = shutterGate({ landmarks: goodPose(), toViewport: ID, rollDeg: 0, overrideActive: false })

    const lean = goodPose()
    lean.nose = p(0.60, 0.10); lean.left_shoulder = p(0.50, 0.30); lean.right_shoulder = p(0.70, 0.30)
    lean.left_hip = p(0.55, 0.55); lean.right_hip = p(0.65, 0.55) // torso leans right; feet unchanged

    const shoulderTilt = goodPose()
    shoulderTilt.left_shoulder = p(0.40, 0.26); shoulderTilt.right_shoulder = p(0.60, 0.36)

    const headCarriage = goodPose()
    headCarriage.nose = p(0.58, 0.13); headCarriage.left_ear = p(0.55, 0.14); headCarriage.right_ear = p(0.61, 0.14)

    const kneeBend = goodPose()
    kneeBend.left_knee = p(0.45, 0.68); kneeBend.right_knee = p(0.55, 0.82) // one knee bent

    for (const lm of [lean, shoulderTilt, headCarriage, kneeBend]) {
      const r = shutterGate({ landmarks: lm, toViewport: ID, rollDeg: 0, overrideActive: false })
      expect(r.allowed).toBe(baseline.allowed)
      expect(r.factors).toEqual(baseline.factors)
    }
  })
})

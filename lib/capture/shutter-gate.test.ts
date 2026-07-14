import { describe, it, expect } from 'vitest'
import { shutterGate } from './shutter-gate'
import type { Landmark } from '@posture-ai/engine/types'

const p = (x: number, y: number, v = 0.9): Landmark => ({ x, y, visibility: v })

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
    const r = shutterGate({ landmarks: goodPose(), rollDeg: 0, overrideActive: false })
    expect(r.allowed).toBe(true)
    expect(r.factors).toEqual({ tilt: 'ok', centering: 'ok', inFrame: 'ok' })
    expect(r.coach).toBeNull()
  })

  it('blocks on tilt beyond 5° and coaches the phone first', () => {
    const r = shutterGate({ landmarks: goodPose(), rollDeg: 8, overrideActive: false })
    expect(r.allowed).toBe(false)
    expect(r.factors.tilt).toBe('blocked')
    expect(r.coach).toBe('Straighten the phone')
  })

  it('treats 5° as level and 6° as tilted (band boundary)', () => {
    expect(shutterGate({ landmarks: goodPose(), rollDeg: 5, overrideActive: false }).factors.tilt).toBe('ok')
    expect(shutterGate({ landmarks: goodPose(), rollDeg: 6, overrideActive: false }).factors.tilt).toBe('blocked')
  })

  it('blocks when the support base is off-center (feet not near screen center)', () => {
    const lm = goodPose()
    lm.left_ankle = p(0.05, 0.95); lm.right_ankle = p(0.15, 0.95) // anchorX = 0.10
    const r = shutterGate({ landmarks: lm, rollDeg: null, overrideActive: false })
    expect(r.factors.centering).toBe('blocked')
    expect(r.allowed).toBe(false)
    expect(r.coach).toBe('Line up with the center line')
  })

  it('disables only centering when the support base is unavailable (profile: one ankle)', () => {
    const lm = goodPose()
    delete lm.left_ankle; delete lm.left_knee; delete lm.left_hip // far side occluded
    const r = shutterGate({ landmarks: lm, rollDeg: 0, overrideActive: false })
    expect(r.factors.centering).toBe('na') // supportAnchorX null → centering off
    expect(r.factors.inFrame).toBe('ok')   // head + near ankle still in frame
    expect(r.allowed).toBe(true)
  })

  it('falls back to tilt-only when there is no live tracking (degraded worker)', () => {
    expect(shutterGate({ landmarks: null, rollDeg: 0, overrideActive: false }))
      .toMatchObject({ allowed: true, factors: { tilt: 'ok', centering: 'na', inFrame: 'na' } })
    // Fewer than 4 visible landmarks also counts as no tracking.
    expect(shutterGate({ landmarks: { nose: p(0.5, 0.1) }, rollDeg: null, overrideActive: false }).factors.inFrame).toBe('na')
  })

  it('blocks framing when a joint is pushed outside the frame (feet still centered)', () => {
    const lm = goodPose()
    lm.right_shoulder = p(1.2, 0.30) // shoulder out of frame; ankles stay at 0.45/0.55 → centered
    const r = shutterGate({ landmarks: lm, rollDeg: null, overrideActive: false })
    expect(r.factors.centering).toBe('ok')
    expect(r.factors.inFrame).toBe('blocked')
    expect(r.coach).toBe('Fit your whole body in the frame')
  })

  it('manual override bypasses every translation-only gate', () => {
    const lm = goodPose()
    lm.left_ankle = p(0.02, 0.95); lm.right_ankle = p(0.05, 0.95); lm.right_hip = p(1.3, 0.55)
    const r = shutterGate({ landmarks: lm, rollDeg: 30, overrideActive: true })
    expect(r.allowed).toBe(true)
    expect(r.coach).toBeNull()
  })

  // Correctness invariant #6: the gate is independent of the posture midline's
  // angle/shape. Hold the support base fixed and deform lean / shoulder-tilt /
  // head-carriage / single-knee-bend — the gate decision must not move.
  it('is invariant to posture deformation while the support base is fixed', () => {
    const baseline = shutterGate({ landmarks: goodPose(), rollDeg: 0, overrideActive: false })

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
      const r = shutterGate({ landmarks: lm, rollDeg: 0, overrideActive: false })
      expect(r.allowed).toBe(baseline.allowed)
      expect(r.factors).toEqual(baseline.factors)
    }
  })
})

import { describe, it, expect } from 'vitest'
import { rollPitchFromOrientation } from './orientation-math'

// Anchors are analytically exact; 2-decimal precision is far tighter than any gate threshold (2°/5°).
describe('rollPitchFromOrientation', () => {
  it('upright portrait, level: β=90 γ=0 → roll 0, pitch 0', () => {
    const { rollDeg, pitchDeg } = rollPitchFromOrientation(90, 0)
    expect(rollDeg).toBeCloseTo(0, 2)
    expect(pitchDeg).toBeCloseTo(0, 2)
  })

  it('pure 10° roll right (device reports β=80 γ=90 in the gimbal-lock regime) → roll +10, pitch 0', () => {
    // Physically rolling an upright phone 10° clockwise (photographer view)
    // makes the W3C Euler angles snap to γ=±90 with β=90−roll.
    const { rollDeg, pitchDeg } = rollPitchFromOrientation(80, 90)
    expect(rollDeg).toBeCloseTo(10, 2)
    expect(pitchDeg).toBeCloseTo(0, 2)
  })

  it('pure 10° roll left (β=80 γ=−90) → roll −10', () => {
    const { rollDeg } = rollPitchFromOrientation(80, -90)
    expect(rollDeg).toBeCloseTo(-10, 2)
  })

  it('pure 5° pitch (β=85 γ=0) → roll 0, pitch 5', () => {
    const { rollDeg, pitchDeg } = rollPitchFromOrientation(85, 0)
    expect(rollDeg).toBeCloseTo(0, 2)
    expect(pitchDeg).toBeCloseTo(5, 2)
  })

  it('phone flat on its back (β=0 γ=0) → pitch 90 (camera aims straight down)', () => {
    const { pitchDeg } = rollPitchFromOrientation(0, 0)
    expect(pitchDeg).toBeCloseTo(90, 2)
  })
})

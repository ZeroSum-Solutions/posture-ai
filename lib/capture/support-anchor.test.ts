import { describe, it, expect } from 'vitest'
import { supportAnchor, supportAnchorX } from './support-anchor'
import type { Landmark } from '@posture-ai/engine/types'

// RELIABILITY_FLOOR is 0.5; "visible" means visibility >= 0.5.
const lm = (x: number, y: number, visibility: number): Landmark => ({ x, y, visibility })

describe('supportAnchor (§11.6 feet midpoint, 2D)', () => {
  it('uses the ankle midpoint when both ankles are visible', () => {
    const a = supportAnchor({
      left_ankle: lm(0.4, 0.9, 0.9),
      right_ankle: lm(0.6, 0.8, 0.8),
      // heels present but ankles win (branch 1 short-circuits)
      left_heel: lm(0.1, 0.95, 0.9),
      right_heel: lm(0.9, 0.95, 0.9),
    })
    expect(a).toEqual({ x: 0.5, y: (0.9 + 0.8) / 2 })
  })

  it('counts visibility exactly at the floor (0.5) as visible', () => {
    const a = supportAnchor({ left_ankle: lm(0.3, 0.9, 0.5), right_ankle: lm(0.5, 0.9, 0.5) })
    expect(a).toEqual({ x: 0.4, y: 0.9 })
  })

  it('falls back to the heel midpoint when an ankle is below the floor', () => {
    const a = supportAnchor({
      left_ankle: lm(0.4, 0.9, 0.49), // below floor → ankle branch fails
      right_ankle: lm(0.6, 0.9, 0.9),
      left_heel: lm(0.42, 0.95, 0.7),
      right_heel: lm(0.58, 0.95, 0.7),
    })
    expect(a).toEqual({ x: 0.5, y: 0.95 })
  })

  it('falls back to heels when ankles are absent entirely', () => {
    const a = supportAnchor({ left_heel: lm(0.4, 1.0, 0.6), right_heel: lm(0.6, 1.0, 0.6) })
    expect(a).toEqual({ x: 0.5, y: 1.0 })
  })

  it('returns null when neither both ankles nor both heels are visible', () => {
    expect(supportAnchor({ left_ankle: lm(0.4, 0.9, 0.9), right_heel: lm(0.6, 0.95, 0.9) })).toBeNull()
    expect(supportAnchor({ left_ankle: lm(0.4, 0.9, 0.4), right_ankle: lm(0.6, 0.9, 0.9) })).toBeNull()
    expect(supportAnchor({})).toBeNull()
  })

  it('treats a missing visibility field as not visible (defaults to 0)', () => {
    expect(supportAnchor({ left_ankle: { x: 0.4, y: 0.9 }, right_ankle: { x: 0.6, y: 0.9 } })).toBeNull()
  })
})

describe('supportAnchorX (horizontal-only convenience for gating)', () => {
  it('is the x of the 2D anchor', () => {
    expect(supportAnchorX({ left_ankle: lm(0.4, 0.9, 0.9), right_ankle: lm(0.6, 0.9, 0.9) })).toBe(0.5)
  })
  it('is null when there is no anchor', () => {
    expect(supportAnchorX({})).toBeNull()
  })
})

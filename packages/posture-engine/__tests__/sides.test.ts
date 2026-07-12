import { describe, it, expect } from 'vitest'
import { compareSide, aggregateSagittal } from '../src/sides'
import type { Finding, SideObservation } from '../src/types'

const obs = (o: Partial<SideObservation>): SideObservation => ({
  profileSide: 'left', deviation: 0, direction: 'Neutral', severityPct: 0,
  zone: 'maintain', confidence: 1, reliable: true, ...o,
})

const finding = (o: Partial<Finding>): Finding => ({
  key: 'forward_head_posture', label: 'FHP', region: 'head_shoulders',
  deviation: 0, standard: 0, unit: 'deg', direction: 'Neutral',
  severityPct: 0, zone: 'maintain', viewUsed: 'side', confidence: 1,
  reliable: true, landmarksUsed: [], ...o,
})

describe('compareSide total order (worse first ⇒ negative)', () => {
  it('reliable outranks unreliable', () => {
    expect(compareSide(obs({ reliable: true, zone: 'maintain' }),
                       obs({ reliable: false, zone: 'unreliable' }))).toBeLessThan(0)
  })
  it('then higher severityPct', () => {
    expect(compareSide(obs({ severityPct: 60 }), obs({ severityPct: 40 }))).toBeLessThan(0)
  })
  it('then higher |deviation|', () => {
    expect(compareSide(obs({ severityPct: 40, deviation: 9 }),
                       obs({ severityPct: 40, deviation: 3 }))).toBeLessThan(0)
  })
  it('stable tiebreak left before right', () => {
    expect(compareSide(obs({ profileSide: 'left' }), obs({ profileSide: 'right' }))).toBeLessThan(0)
  })
  it('both unreliable → left wins despite unequal deviations', () => {
    const a = obs({ profileSide: 'right', reliable: false, zone: 'unreliable', deviation: 9 })
    const b = obs({ profileSide: 'left', reliable: false, zone: 'unreliable', deviation: 1 })
    expect(compareSide(a, b)).toBeGreaterThan(0) // b (left) wins despite a's larger deviation
  })
})

describe('aggregateSagittal', () => {
  it('picks the worst side and attaches both observations', () => {
    const left = finding({ severityPct: 20, deviation: 3 })
    const right = finding({ severityPct: 70, deviation: 9, zone: 'danger' })
    const agg = aggregateSagittal({ finding: left, side: 'left' }, { finding: right, side: 'right' })!
    expect(agg.drivingProfileSide).toBe('right')
    expect(agg.severityPct).toBe(70)
    expect(agg.observations).toHaveLength(2)
  })
  it('single side → uses it', () => {
    const agg = aggregateSagittal({ finding: finding({ severityPct: 10 }), side: 'left' }, null)!
    expect(agg.drivingProfileSide).toBe('left')
    expect(agg.observations).toHaveLength(1)
  })
  it('null both → null', () => {
    expect(aggregateSagittal(null, null)).toBeNull()
  })
})

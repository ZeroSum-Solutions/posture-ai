import { describe, it, expect } from 'vitest'
import { buildFindingRow } from './buildFindingRow'
import { toEngineFinding } from './storedFindingToEngine'
import type { Finding } from '@posture-ai/engine'

const base: Finding = {
  key: 'forward_head_posture', label: 'FHP', region: 'head_shoulders',
  deviation: 5, standard: 0, unit: 'deg', direction: 'Forward',
  severityPct: 40, zone: 'warning', viewUsed: 'side', confidence: 0.9,
  reliable: true, landmarksUsed: [],
}

describe('finding observations round-trip', () => {
  it('serializes observations as { sides, drivingProfileSide }', () => {
    const f: Finding = { ...base, drivingProfileSide: 'right', observations: [
      { profileSide: 'left', deviation: 2, direction: 'Forward', severityPct: 15, zone: 'maintain', confidence: 0.9, reliable: true },
      { profileSide: 'right', deviation: 5, direction: 'Forward', severityPct: 40, zone: 'warning', confidence: 0.9, reliable: true },
    ] }
    const row = buildFindingRow(f, 'a1', 'p1')
    expect(row.observations).toEqual({ sides: f.observations, drivingProfileSide: 'right' })
  })

  it('null observations when the finding has none', () => {
    expect(buildFindingRow(base, 'a1', 'p1').observations).toBeNull()
  })

  it('toEngineFinding rebuilds the aggregate and does not require observations', () => {
    const f = toEngineFinding({
      imbalance_key: 'trunk_lean', label: 'Trunk', region: 'spine',
      deviation: 6, direction: 'Forward', severity_pct: 55, zone: 'warning',
      view_used: 'side', confidence: 0.8,
    })
    expect(f.severityPct).toBe(55)
    expect(f.key).toBe('trunk_lean')
    expect(f.reliable).toBe(true) // derived from zone, unchanged
  })
})

import { describe, it, expect } from 'vitest'
import { toEngineFinding, type StoredFinding } from './storedFindingToEngine'

const row: StoredFinding = {
  imbalance_key: 'forward_head_posture',
  label: 'Forward Head Posture',
  region: 'head_shoulders',
  deviation: 12.4,
  direction: 'Forward',
  severity_pct: 55,
  zone: 'warning',
  view_used: 'side',
  confidence: 0.9,
}

describe('toEngineFinding', () => {
  it('maps a stored row onto the engine Finding shape', () => {
    const f = toEngineFinding(row)
    expect(f.key).toBe('forward_head_posture')
    expect(f.deviation).toBe(12.4)
    expect(f.severityPct).toBe(55)
    expect(f.zone).toBe('warning')
    expect(f.viewUsed).toBe('side')
    expect(f.confidence).toBe(0.9)
    expect(f.reliable).toBe(true)
  })

  it('derives reliable=false only for the unreliable zone', () => {
    expect(toEngineFinding({ ...row, zone: 'unreliable' }).reliable).toBe(false)
    expect(toEngineFinding({ ...row, zone: 'maintain' }).reliable).toBe(true)
    expect(toEngineFinding({ ...row, zone: 'danger' }).reliable).toBe(true)
  })
})

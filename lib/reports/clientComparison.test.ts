import { describe, it, expect } from 'vitest'
import { buildClientComparison } from './clientComparison'

// Engine conventions this logic depends on (locked here so a future engine change
// that flips them trips a test rather than silently rendering progress backwards
// in a client-facing PDF):
//   overallScore 0-100, HIGHER = worse  → a decrease is an improvement
//   severity_pct HIGHER = worse         → a decrease is an improvement
//   grade rank S > A > B > C > D > E

const base = {
  priorDateStr: '03 Jun 2026',
  currentFindings: [] as Array<{ key: string; severityPct: number }>,
  priorFindings: [] as Array<{ key: string; severityPct: number }>,
}

describe('buildClientComparison — overall direction', () => {
  it('reports improvement when the grade goes up (C → B)', () => {
    const c = buildClientComparison({
      ...base,
      current: { grade: 'B', score: 40 },
      prior: { grade: 'C', score: 60 },
    })
    expect(c.overall).toBe('improved')
    expect(c.priorGrade).toBe('C')
    expect(c.currentGrade).toBe('B')
  })

  it('reports a slip when the grade drops (B → C)', () => {
    const c = buildClientComparison({
      ...base,
      current: { grade: 'C', score: 60 },
      prior: { grade: 'B', score: 40 },
    })
    expect(c.overall).toBe('slipped')
  })

  it('within the same grade, a score drop past the deadband reads as improved', () => {
    const c = buildClientComparison({
      ...base,
      current: { grade: 'B', score: 30 },
      prior: { grade: 'B', score: 40 },
    })
    expect(c.overall).toBe('improved')
  })

  it('within the same grade, a tiny score change reads as steady', () => {
    const c = buildClientComparison({
      ...base,
      current: { grade: 'B', score: 40 },
      prior: { grade: 'B', score: 41 },
    })
    expect(c.overall).toBe('steady')
  })

  it('within the same grade, a score rise past the deadband reads as slipped', () => {
    const c = buildClientComparison({
      ...base,
      current: { grade: 'B', score: 45 },
      prior: { grade: 'B', score: 40 },
    })
    expect(c.overall).toBe('slipped')
  })

  it('passes the prior date through verbatim', () => {
    const c = buildClientComparison({
      ...base,
      priorDateStr: '11 Jan 2026',
      current: { grade: 'A', score: 10 },
      prior: { grade: 'A', score: 10 },
    })
    expect(c.priorDateStr).toBe('11 Jan 2026')
  })

  it('suppresses every directional claim when engine versions differ', () => {
    const c = buildClientComparison({
      ...base,
      current: { grade: 'C', score: 30 },
      prior: { grade: 'B', score: 30 },
      currentFindings: [{ key: 'fhp', severityPct: 30 }],
      priorFindings: [{ key: 'fhp', severityPct: 50 }],
    }, { engineVersionMismatch: true })

    expect(c.overall).toBe('not_comparable')
    expect(c.byKey).toEqual({})
  })

  it('still computes improved/slipped when versions match', () => {
    const c = buildClientComparison({
      ...base,
      current: { grade: 'C', score: 30 },
      prior: { grade: 'B', score: 30 },
    }, { engineVersionMismatch: false })

    expect(['improved', 'steady', 'slipped']).toContain(c.overall)
    expect(c.overall).toBe('slipped')
  })
})

describe('buildClientComparison — per-area direction', () => {
  it('marks a focus area improving when its severity drops past the deadband', () => {
    const c = buildClientComparison({
      ...base,
      current: { grade: 'B', score: 40 },
      prior: { grade: 'B', score: 40 },
      currentFindings: [{ key: 'fhp', severityPct: 30 }],
      priorFindings: [{ key: 'fhp', severityPct: 50 }],
    })
    expect(c.byKey.fhp).toBe('improving')
  })

  it('flags a focus area for extra attention when its severity rises past the deadband', () => {
    const c = buildClientComparison({
      ...base,
      current: { grade: 'B', score: 40 },
      prior: { grade: 'B', score: 40 },
      currentFindings: [{ key: 'fhp', severityPct: 70 }],
      priorFindings: [{ key: 'fhp', severityPct: 50 }],
    })
    expect(c.byKey.fhp).toBe('attention')
  })

  it('marks a focus area about the same within the deadband', () => {
    const c = buildClientComparison({
      ...base,
      current: { grade: 'B', score: 40 },
      prior: { grade: 'B', score: 40 },
      currentFindings: [{ key: 'fhp', severityPct: 52 }],
      priorFindings: [{ key: 'fhp', severityPct: 50 }],
    })
    expect(c.byKey.fhp).toBe('steady')
  })

  it('omits an area with no prior reading (nothing to compare against)', () => {
    const c = buildClientComparison({
      ...base,
      current: { grade: 'B', score: 40 },
      prior: { grade: 'B', score: 40 },
      currentFindings: [{ key: 'new_area', severityPct: 60 }],
      priorFindings: [{ key: 'fhp', severityPct: 50 }],
    })
    expect(c.byKey.new_area).toBeUndefined()
    expect(Object.keys(c.byKey)).toHaveLength(0)
  })
})

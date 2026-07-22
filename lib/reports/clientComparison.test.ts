import { describe, expect, it } from 'vitest'
import { buildClientComparison } from './clientComparison'

const VERSION = '2.0.0'
const base = {
  priorDateStr: '03 Jun 2026',
  currentFindings: [] as Array<{ key: string; severityPct: number | null }>,
  priorFindings: [] as Array<{ key: string; severityPct: number | null }>,
}

function score(grade: string, value: unknown, assessedAt: string, scoringEngineVersion: string | null = VERSION) {
  return { grade, score: value, scoringEngineVersion, assessedAt }
}

const current = (grade: string, value: unknown, version: string | null = VERSION) => score(grade, value, '2026-02-01', version)
const prior = (grade: string, value: unknown, version: string | null = VERSION) => score(grade, value, '2026-01-01', version)

describe('buildClientComparison', () => {
  it('uses score tolerance rather than calling a small grade-boundary crossing improvement', () => {
    const comparison = buildClientComparison({
      ...base,
      current: current('B', 20),
      prior: prior('C', 21),
    })

    expect(comparison.priorGrade).toBe('C')
    expect(comparison.currentGrade).toBe('B')
    expect(comparison.overall).toMatchObject({
      status: 'within_tolerance',
      metric: 'overall_score',
      delta: -1,
    })
  })

  it('reports directional score movement at the exact fallback edge in both directions', () => {
    expect(buildClientComparison({
      ...base,
      current: current('B', 17),
      prior: prior('B', 20),
    }).overall.status).toBe('improved')

    expect(buildClientComparison({
      ...base,
      current: current('C', 23),
      prior: prior('B', 20),
    }).overall.status).toBe('regressed')
  })

  it('distinguishes unchanged, within-tolerance, improved, and regressed findings', () => {
    const comparison = buildClientComparison({
      ...base,
      current: current('B', 20),
      prior: prior('B', 20),
      currentFindings: [
        { key: 'same', severityPct: 50 },
        { key: 'noise', severityPct: 54 },
        { key: 'better', severityPct: 45 },
        { key: 'worse', severityPct: 55 },
      ],
      priorFindings: [
        { key: 'same', severityPct: 50 },
        { key: 'noise', severityPct: 50 },
        { key: 'better', severityPct: 50 },
        { key: 'worse', severityPct: 50 },
      ],
    })

    expect(comparison.byKey.same.status).toBe('unchanged')
    expect(comparison.byKey.noise.status).toBe('within_tolerance')
    expect(comparison.byKey.better.status).toBe('improved')
    expect(comparison.byKey.worse.status).toBe('regressed')
  })

  it.each([
    ['different versions', '2.0.0', '1.0.0', 'different_version'],
    ['missing current version', null, '2.0.0', 'missing_version'],
    ['legacy prior with no version', '2.0.0', null, 'missing_version'],
    ['two legacy records', null, null, 'missing_version'],
  ])('fails closed for %s', (_name, currentVersion, priorVersion, reason) => {
    const comparison = buildClientComparison({
      ...base,
      current: current('B', 10, currentVersion),
      prior: prior('D', 90, priorVersion),
      currentFindings: [{ key: 'fhp', severityPct: 10 }],
      priorFindings: [{ key: 'fhp', severityPct: 90 }],
    })

    expect(comparison.overall).toMatchObject({ status: 'not_comparable', reason })
    expect(comparison.byKey.fhp).toMatchObject({ status: 'not_comparable', reason })
  })

  it('marks sparse one-sided findings not comparable', () => {
    const comparison = buildClientComparison({
      ...base,
      current: current('B', 20),
      prior: prior('B', 20),
      currentFindings: [{ key: 'new_area', severityPct: 60 }],
      priorFindings: [{ key: 'fhp', severityPct: 50 }],
    })

    expect(comparison.byKey.new_area).toMatchObject({ status: 'not_comparable', reason: 'missing_value' })
    expect(comparison.byKey.fhp).toMatchObject({ status: 'not_comparable', reason: 'missing_value' })
  })

  it('marks a shared finding with a missing value not comparable', () => {
    const comparison = buildClientComparison({
      ...base,
      current: current('B', 20),
      prior: prior('B', 20),
      currentFindings: [{ key: 'fhp', severityPct: null }],
      priorFindings: [{ key: 'fhp', severityPct: 50 }],
    })

    expect(comparison.byKey.fhp).toMatchObject({
      status: 'not_comparable',
      reason: 'missing_value',
    })
  })

  it.each(['', '   '])('fails closed for blank PostgREST score and severity values: %j', (blank) => {
    const comparison = buildClientComparison({
      ...base,
      current: current('B', blank),
      prior: prior('B', 20),
      currentFindings: [{ key: 'fhp', severityPct: blank }],
      priorFindings: [{ key: 'fhp', severityPct: 50 }],
    })

    expect(comparison.overall).toMatchObject({ status: 'not_comparable', reason: 'missing_value' })
    expect(comparison.byKey.fhp).toMatchObject({ status: 'not_comparable', reason: 'missing_value' })
  })

  it('passes the prior date through verbatim', () => {
    const comparison = buildClientComparison({
      ...base,
      priorDateStr: '11 Jan 2026',
      current: current('A', 10),
      prior: prior('A', 10),
    })
    expect(comparison.priorDateStr).toBe('11 Jan 2026')
  })
})

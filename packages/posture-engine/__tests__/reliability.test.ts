/**
 * Test-retest reliability statistics (reliability-axis accuracy phase,
 * docs/plans/2026-07-17-reliability-baseline.md §2).
 *
 * Input is a repeated-measures matrix: each row is one case (a stable true
 * posture — subject×pose×device under the Tier B protocol), each column one
 * re-positioned capture of it. Output: ICC(2,1) generalized to k repeats
 * (two-way random effects, single measures, absolute agreement), agreement
 * SEM from its ANOVA variance components, and MDC95 (1.96·√2·SEM) — the
 * smallest score change that is signal rather than capture noise.
 *
 * This is REAL test-retest repeatability — the number stabilityScore
 * (within-burst detector jitter, types.ts) explicitly cannot see.
 *
 * Expected values below were computed independently with the textbook
 * two-way-ANOVA formula (Shrout & Fleiss ICC(2,1)) in Python. For KNOWN the
 * reproducible ANOVA components are MSR=115.6666666667, MSC=0.5833333333,
 * and MSE=0.9166666667.
 */
import { describe, it, expect } from 'vitest'
import { testRetestReliability, buildRepeatMatrix } from '../src/reliability'

const KNOWN = [
  [10, 11, 12],
  [20, 19, 21],
  [5, 5, 6],
  [15, 16, 14],
]

describe('testRetestReliability', () => {
  it('reproduces independently computed ICC(2,1)/SEM/MDC95 on a known matrix', () => {
    const stats = testRetestReliability(KNOWN)!
    expect(stats.nCases).toBe(4)
    expect(stats.kRepeats).toBe(3)
    expect(stats.icc21).toBeCloseTo(0.978678038, 8)
    expect(stats.meanSquares.cases).toBeCloseTo(115.6666667, 7)
    expect(stats.meanSquares.occasions).toBeCloseTo(0.5833333, 7)
    expect(stats.meanSquares.error).toBeCloseTo(0.9166667, 7)
    expect(stats.varianceComponents.occasions).toBeCloseTo(-1 / 12, 12)
    expect(stats.nonnegativeVarianceComponents.occasions).toBe(0)
    expect(stats.semConsistency).toBeCloseTo(0.957427108, 8)
    expect(stats.semAgreement).toBeCloseTo(0.957427108, 8)
    expect(stats.sem).toBe(stats.semAgreement)
    expect(stats.mdc95).toBeCloseTo(2.653852546, 8)
    expect(stats.mean).toBeCloseTo(12.8333, 3)
    expect(stats.sd).toBeCloseTo(5.670231, 5)
  })

  it('penalizes a systematic repeat offset under absolute agreement', () => {
    // Each row rises perfectly between repeats, so ICC(3,1) consistency is 1.
    // ICC(2,1) absolute agreement must include that 10-unit column shift and is
    // analytically 1/31 for this matrix (MSR=10/3, MSC=200, MSE=0).
    const stats = testRetestReliability([
      [1, 11],
      [2, 12],
      [3, 13],
      [4, 14],
    ])!
    expect(stats.icc21).toBeCloseTo(1 / 31, 12)
    expect(stats.meanSquares.error).toBeCloseTo(0, 12)
    expect(stats.varianceComponents.occasions).toBeCloseTo(50, 12)
    expect(stats.semConsistency).toBeCloseTo(0, 12)
    expect(stats.semAgreement).toBeCloseTo(Math.sqrt(50), 12)
    expect(stats.mdc95).toBeCloseTo(19.6, 12)
  })

  it('reports near-perfect reliability when repeats are identical', () => {
    const stats = testRetestReliability([
      [10, 10, 10],
      [20, 20, 20],
      [5, 5, 5],
    ])!
    expect(stats.icc21).toBeCloseTo(1, 9)
    expect(stats.semConsistency).toBeCloseTo(0, 9)
    expect(stats.semAgreement).toBeCloseTo(0, 9)
    expect(stats.mdc95).toBeCloseTo(0, 9)
  })

  it('returns null below minimum sample (n<3 cases or k<2 repeats)', () => {
    expect(testRetestReliability([[1, 2], [3, 4]])).toBeNull()
    expect(testRetestReliability([[1], [2], [3]])).toBeNull()
    expect(testRetestReliability([])).toBeNull()
  })

  it('preserves a negative ICC while deriving SEM from the ANOVA error component', () => {
    const stats = testRetestReliability([
      [1, 9],
      [2, 8],
      [9, 1],
    ])!
    expect(stats.icc21).toBeCloseTo(-2.28, 12)
    expect(stats.meanSquares.error).toBeCloseTo(38, 12)
    expect(stats.semConsistency).toBeCloseTo(Math.sqrt(38), 12)
    expect(stats.semAgreement).toBeCloseTo(Math.sqrt(38), 12)
    expect(stats.mdc95).toBeCloseTo(1.96 * Math.SQRT2 * Math.sqrt(38), 12)
  })

  it('returns null for a zero-variance (all-constant) matrix — ICC is undefined there', () => {
    expect(testRetestReliability([[7, 7], [7, 7], [7, 7]])).toBeNull()
  })

  it('throws on a ragged matrix', () => {
    expect(() => testRetestReliability([[1, 2], [3], [4, 5]])).toThrow()
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite measurement %s',
    (nonFinite) => {
      expect(() => testRetestReliability([
        [1, 2],
        [3, nonFinite],
        [4, 5],
      ])).toThrow('finite')
    },
  )

  it('does not mutate its input', () => {
    const input = KNOWN.map((r) => [...r])
    testRetestReliability(input)
    expect(input).toEqual(KNOWN)
  })

  it('is invariant to case-row and repeat-column ordering', () => {
    const baseline = testRetestReliability(KNOWN)!
    const rowPermuted = testRetestReliability([...KNOWN].reverse())!
    const columnPermuted = testRetestReliability(KNOWN.map((row) => [row[2], row[0], row[1]]))!

    for (const candidate of [rowPermuted, columnPermuted]) {
      expect(candidate.icc21).toBeCloseTo(baseline.icc21, 12)
      expect(candidate.mean).toBeCloseTo(baseline.mean, 12)
      expect(candidate.sd).toBeCloseTo(baseline.sd, 12)
      expect(candidate.semConsistency).toBeCloseTo(baseline.semConsistency, 12)
      expect(candidate.semAgreement).toBeCloseTo(baseline.semAgreement, 12)
      expect(candidate.mdc95).toBeCloseTo(baseline.mdc95, 12)
    }
  })

  it('is translation invariant and scales dimensional statistics with the measurements', () => {
    const baseline = testRetestReliability(KNOWN)!
    const translated = testRetestReliability(KNOWN.map((row) => row.map((value) => value + 37)))!
    const scaled = testRetestReliability(KNOWN.map((row) => row.map((value) => value * 3)))!

    expect(translated.icc21).toBeCloseTo(baseline.icc21, 12)
    expect(translated.mean).toBeCloseTo(baseline.mean + 37, 12)
    expect(translated.sd).toBeCloseTo(baseline.sd, 12)
    expect(translated.semConsistency).toBeCloseTo(baseline.semConsistency, 12)
    expect(translated.semAgreement).toBeCloseTo(baseline.semAgreement, 12)
    expect(translated.mdc95).toBeCloseTo(baseline.mdc95, 12)

    expect(scaled.icc21).toBeCloseTo(baseline.icc21, 12)
    expect(scaled.mean).toBeCloseTo(baseline.mean * 3, 12)
    expect(scaled.sd).toBeCloseTo(baseline.sd * 3, 12)
    expect(scaled.semConsistency).toBeCloseTo(baseline.semConsistency * 3, 12)
    expect(scaled.semAgreement).toBeCloseTo(baseline.semAgreement * 3, 12)
    expect(scaled.mdc95).toBeCloseTo(baseline.mdc95 * 3, 12)
  })

  it('stays finite when residual error is at floating-point scale', () => {
    const stats = testRetestReliability([
      [1, 2, 3 + Number.EPSILON],
      [2, 3, 4],
      [3, 4, 5],
      [4, 5, 6],
    ])!
    expect(Number.isFinite(stats.icc21)).toBe(true)
    expect(Number.isFinite(stats.semAgreement)).toBe(true)
    expect(Number.isFinite(stats.mdc95)).toBe(true)
  })
})

describe('buildRepeatMatrix', () => {
  it('aligns columns by repeat label rather than record insertion order', () => {
    const { matrix, droppedCases, kRepeats } = buildRepeatMatrix([
      { caseKey: 'a/neutral/front/iphone', repeatId: '2', value: 2 },
      { caseKey: 'b/neutral/front/iphone', repeatId: '1', value: 10 },
      { caseKey: 'a/neutral/front/iphone', repeatId: '1', value: 1 },
      { caseKey: 'b/neutral/front/iphone', repeatId: '2', value: 20 },
    ])
    expect(kRepeats).toBe(2)
    expect(matrix).toEqual([
      [1, 2],
      [10, 20],
    ])
    expect(droppedCases).toEqual([])
  })

  it('drops a case missing the middle expected repeat instead of shifting columns', () => {
    const { matrix, droppedCases, repeatIds } = buildRepeatMatrix([
      { caseKey: 'a', repeatId: '1', value: 1 },
      { caseKey: 'a', repeatId: '3', value: 3 },
      { caseKey: 'b', repeatId: '1', value: 10 },
      { caseKey: 'b', repeatId: '2', value: 20 },
      { caseKey: 'b', repeatId: '3', value: 30 },
    ], ['1', '2', '3'])
    expect(matrix).toEqual([[10, 20, 30]])
    expect(droppedCases).toEqual(['a'])
    expect(repeatIds).toEqual(['1', '2', '3'])
  })

  it('rejects duplicate values for the same case and repeat label', () => {
    expect(() => buildRepeatMatrix([
      { caseKey: 'a', repeatId: '1', value: 1 },
      { caseKey: 'a', repeatId: '1', value: 2 },
      { caseKey: 'a', repeatId: '2', value: 3 },
    ])).toThrow('duplicate repeat')
  })

  it('rejects unexpected or duplicate expected repeat labels', () => {
    expect(() => buildRepeatMatrix([
      { caseKey: 'a', repeatId: '3', value: 3 },
    ], ['1', '2'])).toThrow('unexpected repeat label')
    expect(() => buildRepeatMatrix([], ['1', '1'])).toThrow('duplicate repeat label')
  })

  it('rejects a non-finite record even when its case would otherwise be dropped as incomplete', () => {
    expect(() => buildRepeatMatrix([
      { caseKey: 'incomplete', repeatId: '1', value: Number.NaN },
    ], ['1', '2', '3'])).toThrow('finite')
  })

  it('sorts inferred numeric repeat labels canonically', () => {
    const { repeatIds, matrix } = buildRepeatMatrix([
      { caseKey: 'a', repeatId: '10', value: 10 },
      { caseKey: 'a', repeatId: '2', value: 2 },
      { caseKey: 'a', repeatId: '1', value: 1 },
    ])
    expect(repeatIds).toEqual(['1', '2', '10'])
    expect(matrix).toEqual([[1, 2, 10]])
  })

  it('returns an empty matrix for no records', () => {
    const { matrix, droppedCases, kRepeats } = buildRepeatMatrix([])
    expect(matrix).toEqual([])
    expect(droppedCases).toEqual([])
    expect(kRepeats).toBe(0)
  })
})

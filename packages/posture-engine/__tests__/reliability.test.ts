/**
 * Test-retest reliability statistics (reliability-axis accuracy phase,
 * docs/plans/2026-07-17-reliability-baseline.md §2).
 *
 * Input is a repeated-measures matrix: each row is one case (a stable true
 * posture — subject×pose×device under the Tier B protocol), each column one
 * re-positioned capture of it. Output: ICC(2,1) generalized to k repeats
 * (two-way random effects, single measures, absolute agreement), SEM
 * (SD·√(1−ICC)) and MDC95 (1.96·√2·SEM) — the smallest score change that is
 * signal rather than capture noise.
 *
 * This is REAL test-retest repeatability — the number stabilityScore
 * (within-burst detector jitter, types.ts) explicitly cannot see.
 *
 * Expected values below were computed independently with the textbook
 * two-way-ANOVA formula (Shrout & Fleiss ICC(2,1)) in Python.
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
    expect(stats.icc21).toBeCloseTo(0.978678, 5)
    expect(stats.sem).toBeCloseTo(0.827969, 5)
    expect(stats.mdc95).toBeCloseTo(2.295014, 5)
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
  })

  it('reports near-perfect reliability when repeats are identical', () => {
    const stats = testRetestReliability([
      [10, 10, 10],
      [20, 20, 20],
      [5, 5, 5],
    ])!
    expect(stats.icc21).toBeCloseTo(1, 9)
    expect(stats.sem).toBeCloseTo(0, 9)
    expect(stats.mdc95).toBeCloseTo(0, 9)
  })

  it('returns null below minimum sample (n<3 cases or k<2 repeats)', () => {
    expect(testRetestReliability([[1, 2], [3, 4]])).toBeNull()
    expect(testRetestReliability([[1], [2], [3]])).toBeNull()
    expect(testRetestReliability([])).toBeNull()
  })

  it('floors SEM at the observed SD when ICC is negative (Weir 2005 convention)', () => {
    // Within-case variance dwarfs between-case variance → ICC < 0. The true
    // (negative) ICC is still reported, but SEM must never exceed the observed
    // SD — a negative ICC is floored at 0 for the SEM step, so SEM = SD.
    const stats = testRetestReliability([
      [1, 9],
      [2, 8],
      [9, 1],
    ])!
    expect(stats.icc21).toBeLessThan(0)
    expect(stats.sem).toBeCloseTo(stats.sd, 9)
    expect(stats.mdc95).toBeCloseTo(1.96 * Math.SQRT2 * stats.sd, 9)
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

  it('returns an empty matrix for no records', () => {
    const { matrix, droppedCases, kRepeats } = buildRepeatMatrix([])
    expect(matrix).toEqual([])
    expect(droppedCases).toEqual([])
    expect(kRepeats).toBe(0)
  })
})

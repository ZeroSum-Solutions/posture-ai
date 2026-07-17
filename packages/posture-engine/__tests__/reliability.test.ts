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

  it('does not mutate its input', () => {
    const input = KNOWN.map((r) => [...r])
    testRetestReliability(input)
    expect(input).toEqual(KNOWN)
  })
})

describe('buildRepeatMatrix', () => {
  it('groups values by case into rows of k=max observed repeats, preserving insertion order', () => {
    const { matrix, droppedCases, kRepeats } = buildRepeatMatrix([
      { caseKey: 'a/neutral/front/iphone', value: 1 },
      { caseKey: 'b/neutral/front/iphone', value: 10 },
      { caseKey: 'a/neutral/front/iphone', value: 2 },
      { caseKey: 'b/neutral/front/iphone', value: 11 },
      { caseKey: 'a/neutral/front/iphone', value: 3 },
      { caseKey: 'b/neutral/front/iphone', value: 12 },
    ])
    expect(kRepeats).toBe(3)
    expect(matrix).toEqual([
      [1, 2, 3],
      [10, 11, 12],
    ])
    expect(droppedCases).toEqual([])
  })

  it('drops cases with fewer than the max repeat count and reports them', () => {
    const { matrix, droppedCases } = buildRepeatMatrix([
      { caseKey: 'a', value: 1 },
      { caseKey: 'a', value: 2 },
      { caseKey: 'b', value: 5 },
    ])
    expect(matrix).toEqual([[1, 2]])
    expect(droppedCases).toEqual(['b'])
  })

  it('returns an empty matrix for no records', () => {
    const { matrix, droppedCases, kRepeats } = buildRepeatMatrix([])
    expect(matrix).toEqual([])
    expect(droppedCases).toEqual([])
    expect(kRepeats).toBe(0)
  })
})

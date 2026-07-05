import { describe, it, expect } from 'vitest'
import { assessPosture, testLandmarksFrames } from '../src'

describe('testLandmarksFrames (slice 1 canonical snapshot)', () => {
  it('produces the fixture-driven assessment tracer values', () => {
    const result = assessPosture(testLandmarksFrames)

    expect(result.overallGrade).toBe('C')
    // 22 after pelvic_obliquity graduated to LITERATURE_CITED (Task 11): its weight
    // doubles from 0.5 to 1.0, diluting the weighted mean because pelvic deviation
    // is near-zero in this fixture. Was 24 (Task 6 validity-weighted), 25 at
    // trunk_lean-merge, 26 before. No overallPercentile emitted.
    expect(result.overallScore).toBe(22)
    expect(result.ranks.front).toBe(18)
    expect(result.ranks.side).toBe(37)
    expect(result.findings).toHaveLength(9)
    expect(result.disclaimer).toContain('SCREENING ONLY')
  })
})

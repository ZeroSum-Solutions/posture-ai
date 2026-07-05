import { describe, it, expect } from 'vitest'
import { assessPosture, testLandmarksFrames } from '../src'

describe('testLandmarksFrames (slice 1 canonical snapshot)', () => {
  it('produces the fixture-driven assessment tracer values', () => {
    const result = assessPosture(testLandmarksFrames)

    expect(result.overallGrade).toBe('C')
    // 24 after the validity-weighted overall score (Task 6): the literature-cited
    // knee_extension metric (weight 1.0) pulls the weighted mean vs the unweighted
    // mean (25 at trunk_lean-merge, 26 before). No overallPercentile emitted.
    expect(result.overallScore).toBe(24)
    expect(result.ranks.front).toBe(18)
    expect(result.ranks.side).toBe(37)
    expect(result.findings).toHaveLength(9)
    expect(result.disclaimer).toContain('SCREENING ONLY')
  })
})

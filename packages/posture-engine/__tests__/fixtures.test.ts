import { describe, it, expect } from 'vitest'
import { assessPosture, testLandmarksFrames } from '../src'

describe('testLandmarksFrames (slice 1 canonical snapshot)', () => {
  it('produces the fixture-driven assessment tracer values', () => {
    const result = assessPosture(testLandmarksFrames)

    expect(result.overallGrade).toBe('B')
    // 25 after the trunk_lean merge (2.0.0): anterior_pelvic_shift was scoring the
    // identical shoulder→hip vector as t1_tilt_backward — removing it lowers the
    // side-view average by one duplicate finding.
    expect(result.overallScore).toBe(25)
    expect(result.overallPercentile).toBe(75)
    expect(result.ranks.front).toBe(18)
    expect(result.ranks.side).toBe(37)
    expect(result.findings).toHaveLength(9)
    expect(result.disclaimer).toContain('SCREENING ONLY')
  })
})

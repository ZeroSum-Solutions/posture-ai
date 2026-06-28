import { describe, it, expect } from 'vitest'
import { assessPosture, testLandmarksFrames } from '../src'

describe('testLandmarksFrames (slice 1 canonical snapshot)', () => {
  it('produces the fixture-driven assessment tracer values', () => {
    const result = assessPosture(testLandmarksFrames)

    expect(result.overallGrade).toBe('B')
    // 26 after the recurvatum fix (STANDARD 175→180 raised this near-straight
    // knee's deviation 2.22°→2.78°, severity 15→18); ranks are front/side splits
    // and the knee is a side finding, so only the side-inclusive aggregate moved.
    expect(result.overallScore).toBe(26)
    expect(result.overallPercentile).toBe(74)
    expect(result.ranks.front).toBe(18)
    expect(result.ranks.side).toBe(35)
    expect(result.findings).toHaveLength(10)
    expect(result.disclaimer).toContain('SCREENING ONLY')
  })
})

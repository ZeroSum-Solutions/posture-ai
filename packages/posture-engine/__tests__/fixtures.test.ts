import { describe, it, expect } from 'vitest'
import { assessPosture, testLandmarksFrames } from '../src'

describe('testLandmarksFrames (slice 1 canonical snapshot)', () => {
  it('produces the fixture-driven assessment tracer values', () => {
    const result = assessPosture(testLandmarksFrames)

    expect(result.overallGrade).toBe('B')
    expect(result.overallScore).toBe(25)
    expect(result.overallPercentile).toBe(75)
    expect(result.ranks.front).toBe(18)
    expect(result.ranks.side).toBe(35)
    expect(result.findings).toHaveLength(10)
    expect(result.disclaimer).toContain('SCREENING ONLY')
  })
})

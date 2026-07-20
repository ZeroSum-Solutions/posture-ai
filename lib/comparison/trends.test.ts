import { describe, expect, it } from 'vitest'
import { segmentTrendHistory, trendValueForSegment } from './trends'

describe('version-segmented trend history', () => {
  it('splits contiguous version runs and isolates unknown legacy rows', () => {
    const history = [
      { assessmentId: 'a', scoringEngineVersion: 'v2' },
      { assessmentId: 'b', scoringEngineVersion: 'v2' },
      { assessmentId: 'c', scoringEngineVersion: 'v3' },
      { assessmentId: 'd', scoringEngineVersion: 'v3' },
      { assessmentId: 'e', scoringEngineVersion: null },
      { assessmentId: 'f', scoringEngineVersion: 'v3' },
    ]

    const result = segmentTrendHistory(history)
    expect(result.segments.map((segment) => ({
      version: segment.scoringEngineVersion,
      indexes: segment.pointIndexes,
    }))).toEqual([
      { version: 'v2', indexes: [0, 1] },
      { version: 'v3', indexes: [2, 3] },
      { version: null, indexes: [4] },
      { version: 'v3', indexes: [5] },
    ])
    expect(result.points.map((point) => point.segmentId)).toEqual([
      'trend-segment-1',
      'trend-segment-1',
      'trend-segment-2',
      'trend-segment-2',
      'trend-segment-3',
      'trend-segment-4',
    ])
  })

  it('isolates consecutive missing-version records from each other', () => {
    const result = segmentTrendHistory([
      { assessmentId: 'legacy-a', scoringEngineVersion: null },
      { assessmentId: 'legacy-b', scoringEngineVersion: null },
    ])
    expect(result.segments).toHaveLength(2)
    expect(result.points[0].segmentId).not.toBe(result.points[1].segmentId)
  })

  it('returns null outside the segment and at sparse or invalid values', () => {
    expect(trendValueForSegment({ segment_id: 'a', severity: 42 }, 'a', 'severity')).toBe(42)
    expect(trendValueForSegment({ segment_id: 'a', severity: 42 }, 'b', 'severity')).toBeNull()
    expect(trendValueForSegment({ segment_id: 'a' }, 'a', 'severity')).toBeNull()
    expect(trendValueForSegment({ segment_id: 'a', severity: Number.NaN }, 'a', 'severity')).toBeNull()
  })
})

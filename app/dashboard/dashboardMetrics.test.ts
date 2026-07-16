import { describe, expect, test } from 'vitest'
import { deriveDashboardMetrics } from './dashboardMetrics'

describe('deriveDashboardMetrics', () => {
  test('uses the same scored-only records for the average and pulse', () => {
    const metrics = deriveDashboardMetrics([
      { overall_score: 80 },
      { overall_score: null },
      { overall_score: 40 },
      { overall_score: Number.NaN },
    ])

    expect(metrics.averageScore).toBe(60)
    expect(metrics.scoredCount).toBe(2)
    expect(metrics.pulse).toHaveLength(2)
    expect(metrics.pulse.map((point) => point.score)).toEqual([40, 80])
  })

  test('preserves an unavailable state rather than inventing a score or chart line', () => {
    expect(deriveDashboardMetrics([
      { overall_score: null },
      { overall_score: Number.NaN },
    ])).toEqual({ averageScore: null, scoredCount: 0, pulse: [], pulseLine: null })
  })
})

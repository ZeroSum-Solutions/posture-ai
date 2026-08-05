import { describe, expect, it } from 'vitest'
import { FIXED_COMPARISON_TOLERANCE } from '@/lib/comparison/policy'
import { SCORE_BAND_STOPS } from '@/components/array/severity'
import { buildTrendChart, CHART_VIEWBOX, type TrendInputPoint } from './trendModel'

const ENGINE = '1.4.0'

function point(overrides: Partial<TrendInputPoint> & { id: string }): TrendInputPoint {
  return {
    assessedAt: '2026-01-01T00:00:00Z',
    score: 40,
    grade: 'C',
    scoringEngineVersion: ENGINE,
    segmentId: 'trend-segment-1',
    ...overrides,
  }
}

describe('buildTrendChart geometry', () => {
  it('places a lower deviation score nearer the bottom of the plot', () => {
    const model = buildTrendChart([
      point({ id: 'a', score: 80, assessedAt: '2026-01-01T00:00:00Z' }),
      point({ id: 'b', score: 20, assessedAt: '2026-02-01T00:00:00Z' }),
    ])
    expect(model.points).toHaveLength(2)
    expect(model.points[1].y).toBeGreaterThan(model.points[0].y)
  })

  it('keeps every point inside the viewBox for the full 0-100 domain', () => {
    const model = buildTrendChart([
      point({ id: 'a', score: 0, assessedAt: '2026-01-01T00:00:00Z' }),
      point({ id: 'b', score: 100, assessedAt: '2026-02-01T00:00:00Z' }),
    ])
    for (const plotted of model.points) {
      expect(plotted.x).toBeGreaterThanOrEqual(0)
      expect(plotted.x).toBeLessThanOrEqual(CHART_VIEWBOX.width)
      expect(plotted.y).toBeGreaterThanOrEqual(0)
      expect(plotted.y).toBeLessThanOrEqual(CHART_VIEWBOX.height)
    }
  })

  it('centres a single reading rather than pinning it to the left edge', () => {
    const model = buildTrendChart([point({ id: 'only' })])
    expect(model.points[0].x).toBeCloseTo(CHART_VIEWBOX.width / 2, 0)
    expect(model.runs).toHaveLength(1)
    // One point cannot describe a direction, so there is no area fill.
    expect(model.areaPath).toBeNull()
  })

  it('draws the maintain band at the engine grade-B ceiling, not a design guess', () => {
    const model = buildTrendChart([point({ id: 'a' })])
    expect(model.maintainBand.label).toContain(String(SCORE_BAND_STOPS.maintain))
    // The band sits at the bottom of the plot, where the best scores are.
    const bottom = model.maintainBand.y + model.maintainBand.height
    expect(bottom).toBeGreaterThan(model.maintainBand.y)
    expect(model.maintainBand.height).toBeGreaterThan(0)
  })

  it('drops readings with no score instead of plotting them as zero', () => {
    const model = buildTrendChart([
      point({ id: 'a', score: 50, assessedAt: '2026-01-01T00:00:00Z' }),
      point({ id: 'missing', score: null, assessedAt: '2026-02-01T00:00:00Z' }),
      point({ id: 'b', score: 40, assessedAt: '2026-03-01T00:00:00Z' }),
    ])
    expect(model.points.map(plotted => plotted.id)).toEqual(['a', 'b'])
  })
})

describe('buildTrendChart scoring-version runs', () => {
  it('never joins two scoring-version runs with one line', () => {
    const model = buildTrendChart([
      point({ id: 'a', segmentId: 'trend-segment-1', assessedAt: '2026-01-01T00:00:00Z' }),
      point({ id: 'b', segmentId: 'trend-segment-1', assessedAt: '2026-02-01T00:00:00Z' }),
      point({ id: 'c', segmentId: 'trend-segment-2', assessedAt: '2026-03-01T00:00:00Z' }),
    ])
    expect(model.runs).toHaveLength(2)
    expect(model.runs[0].polyline.split(' ')).toHaveLength(2)
    expect(model.runs[1].polyline.split(' ')).toHaveLength(1)
  })

  it('fills only the most recent run', () => {
    const model = buildTrendChart([
      point({ id: 'a', segmentId: 'trend-segment-1', assessedAt: '2026-01-01T00:00:00Z' }),
      point({ id: 'b', segmentId: 'trend-segment-2', assessedAt: '2026-02-01T00:00:00Z' }),
      point({ id: 'c', segmentId: 'trend-segment-2', assessedAt: '2026-03-01T00:00:00Z' }),
    ])
    expect(model.areaPath).not.toBeNull()
    // Two vertices plus the two baseline corners and the close command.
    expect(model.areaPath?.startsWith('M')).toBe(true)
    expect(model.areaPath?.endsWith('Z')).toBe(true)
  })
})

describe('buildTrendChart verdict', () => {
  it('reports an improvement that clears the tolerance', () => {
    const model = buildTrendChart([
      point({ id: 'a', score: 62, grade: 'D', assessedAt: '2026-01-01T00:00:00Z' }),
      point({ id: 'b', score: 46, grade: 'C', assessedAt: '2026-03-01T00:00:00Z' }),
    ])
    expect(model.verdict?.decision.status).toBe('improved')
    expect(model.verdict?.magnitude).toBe('−16 pts')
    expect(model.verdict?.band).toBe('maintain')
    expect(model.verdict?.icon).toBe('arrow-down-linear')
  })

  it('reports a regression in the review tone', () => {
    const model = buildTrendChart([
      point({ id: 'a', score: 30, assessedAt: '2026-01-01T00:00:00Z' }),
      point({ id: 'b', score: 44, assessedAt: '2026-03-01T00:00:00Z' }),
    ])
    expect(model.verdict?.decision.status).toBe('regressed')
    expect(model.verdict?.magnitude).toBe('+14 pts')
    expect(model.verdict?.band).toBe('review')
  })

  it('withholds a magnitude when the movement is inside the tolerance', () => {
    const drift = FIXED_COMPARISON_TOLERANCE.overallScorePoints - 1
    const model = buildTrendChart([
      point({ id: 'a', score: 40, assessedAt: '2026-01-01T00:00:00Z' }),
      point({ id: 'b', score: 40 - drift, assessedAt: '2026-03-01T00:00:00Z' }),
    ])
    expect(model.verdict?.decision.status).toBe('within_tolerance')
    // Stating the size of a movement the policy calls meaningless argues
    // against the words next to it.
    expect(model.verdict?.magnitude).toBeNull()
    expect(model.verdict?.band).toBe('neutral')
    expect(model.footnote).toContain('inside it')
  })

  it('refuses a verdict, a whisker and a claim across scoring versions', () => {
    const model = buildTrendChart([
      point({ id: 'a', score: 62, scoringEngineVersion: '1.3.0', segmentId: 'trend-segment-1', assessedAt: '2026-01-01T00:00:00Z' }),
      point({ id: 'b', score: 46, scoringEngineVersion: '1.4.0', segmentId: 'trend-segment-2', assessedAt: '2026-03-01T00:00:00Z' }),
    ])
    expect(model.verdict?.decision.status).toBe('not_comparable')
    expect(model.verdict?.text).toBe('Not comparable')
    expect(model.verdict?.magnitude).toBeNull()
    expect(model.tolerance).toBeNull()
    expect(model.footnote).toContain('different or missing scoring versions')
  })

  it('has no verdict on a first scan but still explains the tolerance', () => {
    const model = buildTrendChart([point({ id: 'only' })])
    expect(model.verdict).toBeNull()
    expect(model.tolerance).toBeNull()
    expect(model.footnote).toContain('A second scan starts the trend')
  })

  it('scales the whisker to the policy tolerance in score points', () => {
    const model = buildTrendChart([
      point({ id: 'a', score: 62, assessedAt: '2026-01-01T00:00:00Z' }),
      point({ id: 'b', score: 46, assessedAt: '2026-03-01T00:00:00Z' }),
    ])
    expect(model.tolerance?.points).toBe(FIXED_COMPARISON_TOLERANCE.overallScorePoints)
    const upper = buildTrendChart([
      point({ id: 'a', score: 62, assessedAt: '2026-01-01T00:00:00Z' }),
      point({ id: 'b', score: 46 + FIXED_COMPARISON_TOLERANCE.overallScorePoints, assessedAt: '2026-03-01T00:00:00Z' }),
    ])
    // The whisker's height is the same regardless of where the point sits.
    const span = (model.tolerance!.y2 - model.tolerance!.y1)
    expect(upper.tolerance!.y2 - upper.tolerance!.y1).toBeCloseTo(span, 5)
  })
})

describe('buildTrendChart labelling', () => {
  it('labels every point in a short history', () => {
    const model = buildTrendChart([
      point({ id: 'a', assessedAt: '2026-01-01T00:00:00Z' }),
      point({ id: 'b', assessedAt: '2026-02-01T00:00:00Z' }),
      point({ id: 'c', assessedAt: '2026-03-01T00:00:00Z' }),
    ])
    expect(model.points.every(plotted => plotted.showValueLabel)).toBe(true)
  })

  it('thins labels on a long history but keeps the baseline and the latest', () => {
    const history = Array.from({ length: 14 }, (_, index) => point({
      id: `scan-${index}`,
      score: 60 - index,
      assessedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
    }))
    const model = buildTrendChart(history)
    const labelled = model.points.filter(plotted => plotted.showValueLabel)
    expect(labelled.length).toBeLessThanOrEqual(5)
    expect(model.points[0].showValueLabel).toBe(true)
    expect(model.points[model.points.length - 1].showValueLabel).toBe(true)
    const dated = model.points.filter(plotted => plotted.showDateLabel)
    expect(dated.length).toBeLessThanOrEqual(3)
  })

  it('omits the grade from a value label when the grade is missing', () => {
    const model = buildTrendChart([point({ id: 'a', score: 41.4, grade: null })])
    expect(model.points[0].valueLabel).toBe('41')
  })

  it('describes the chart in words for assistive technology', () => {
    const model = buildTrendChart([
      point({ id: 'a', score: 62, grade: 'D', assessedAt: '2026-01-01T00:00:00Z' }),
      point({ id: 'b', score: 46, grade: 'C', assessedAt: '2026-03-01T00:00:00Z' }),
    ])
    expect(model.description).toContain('62 · D')
    expect(model.description).toContain('46 · C')
    expect(model.description).toContain('lower is better')
    expect(model.description).toContain('Improved')
  })
})

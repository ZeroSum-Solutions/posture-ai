import { describe, expect, it } from 'vitest'
import { buildFindingsTrend, type FindingsTrendAssessment } from './findingsModel'

const ENGINE = '1.4.0'

function scan(
  id: string,
  assessedAt: string,
  findings: FindingsTrendAssessment['findings'],
  overrides: Partial<FindingsTrendAssessment> = {},
): FindingsTrendAssessment {
  return {
    id,
    assessedAt,
    scoringEngineVersion: ENGINE,
    segmentId: 'trend-segment-1',
    findings,
    ...overrides,
  }
}

function finding(key: string, severityPct: number | string | null, zone: string | null = 'warning') {
  return { key, label: `${key} label`, severityPct, zone, unit: 'deg' }
}

describe('buildFindingsTrend', () => {
  it('orders findings by latest severity, worst first', () => {
    const series = buildFindingsTrend([
      scan('a', '2026-01-01T00:00:00Z', [finding('mild', 10), finding('severe', 70)]),
    ])
    expect(series.map(entry => entry.key)).toEqual(['severe', 'mild'])
  })

  it('sorts a finding with no usable reading last', () => {
    const series = buildFindingsTrend([
      scan('a', '2026-01-01T00:00:00Z', [
        finding('unreliable-one', 90, 'unreliable'),
        finding('scored', 5),
      ]),
    ])
    expect(series.map(entry => entry.key)).toEqual(['scored', 'unreliable-one'])
    expect(series[1].latest).toBeNull()
    expect(series[1].verdict).toBeNull()
  })

  it('treats an unreliable reading as absent, not as a value', () => {
    const series = buildFindingsTrend([
      scan('a', '2026-01-01T00:00:00Z', [finding('k', 40)]),
      scan('b', '2026-02-01T00:00:00Z', [finding('k', 90, 'unreliable')]),
    ])
    expect(series[0].points).toHaveLength(1)
    expect(series[0].latest?.severity).toBe(40)
  })

  it('breaks the line across a gap in the readings', () => {
    const series = buildFindingsTrend([
      scan('a', '2026-01-01T00:00:00Z', [finding('k', 40)]),
      scan('b', '2026-02-01T00:00:00Z', []),
      scan('c', '2026-03-01T00:00:00Z', [finding('k', 30)]),
    ])
    expect(series[0].points).toHaveLength(2)
    expect(series[0].runs).toHaveLength(2)
  })

  it('breaks the line across a scoring-version boundary', () => {
    const series = buildFindingsTrend([
      scan('a', '2026-01-01T00:00:00Z', [finding('k', 40)]),
      scan('b', '2026-02-01T00:00:00Z', [finding('k', 30)], {
        scoringEngineVersion: '2.0.0',
        segmentId: 'trend-segment-2',
      }),
    ])
    expect(series[0].runs).toHaveLength(2)
  })

  it('refuses a verdict across a scoring-version boundary', () => {
    const series = buildFindingsTrend([
      scan('a', '2026-01-01T00:00:00Z', [finding('k', 40)]),
      scan('b', '2026-02-01T00:00:00Z', [finding('k', 20)], {
        scoringEngineVersion: '2.0.0',
        segmentId: 'trend-segment-2',
      }),
    ])
    expect(series[0].verdict?.decision.status).toBe('not_comparable')
    expect(series[0].verdict?.magnitude).toBeNull()
  })

  it('refuses a verdict when the recorded unit changed', () => {
    const series = buildFindingsTrend([
      scan('a', '2026-01-01T00:00:00Z', [{ key: 'k', label: 'K', severityPct: 40, zone: 'warning', unit: 'deg' }]),
      scan('b', '2026-02-01T00:00:00Z', [{ key: 'k', label: 'K', severityPct: 20, zone: 'warning', unit: 'cm' }]),
    ])
    expect(series[0].verdict?.decision.status).toBe('not_comparable')
  })

  it('reports a neutral signed difference while retaining the stored decision enum', () => {
    const series = buildFindingsTrend([
      scan('a', '2026-01-01T00:00:00Z', [finding('k', 40)]),
      scan('b', '2026-02-01T00:00:00Z', [finding('k', 25)]),
    ])
    expect(series[0].verdict?.decision.status).toBe('improved')
    expect(series[0].verdict?.magnitude).toBe('−15.0 pts')
    expect(series[0].verdict?.band).toBe('neutral')
    expect(series[0].verdict?.text).toBe('Recorded severity decreased')
  })

  it('parses a severity that arrives as a numeric string', () => {
    const series = buildFindingsTrend([
      scan('a', '2026-01-01T00:00:00Z', [finding('k', '33.5')]),
    ])
    expect(series[0].latest?.severity).toBeCloseTo(33.5, 5)
  })

  it('bands the latest reading from its zone, not its number', () => {
    const series = buildFindingsTrend([
      scan('a', '2026-01-01T00:00:00Z', [finding('k', 12, 'danger')]),
    ])
    expect(series[0].latest?.band).toBe('review')
  })

  it('describes each series in words for assistive technology', () => {
    const series = buildFindingsTrend([
      scan('a', '2026-01-01T00:00:00Z', [finding('k', 40)]),
      scan('b', '2026-02-01T00:00:00Z', [finding('k', 25)]),
    ])
    expect(series[0].description).toContain('latest severity 25.0 percent')
    expect(series[0].description).toContain('Recorded severity decreased')
    expect(series[0].description).not.toMatch(/improv|regress|better|worse/i)
  })

  it('prefers a real label over the raw key when one arrives later', () => {
    const series = buildFindingsTrend([
      scan('a', '2026-01-01T00:00:00Z', [{ key: 'k', label: null, severityPct: 40, zone: 'warning', unit: null }]),
      scan('b', '2026-02-01T00:00:00Z', [{ key: 'k', label: 'Forward head', severityPct: 39, zone: 'warning', unit: null }]),
    ])
    expect(series[0].label).toBe('Forward head')
  })
})

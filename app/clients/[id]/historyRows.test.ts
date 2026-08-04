import { describe, expect, it } from 'vitest'
import { buildHistoryRows, type HistoryRowInput } from './historyRows'

const ENGINE = '1.4.0'

function scan(overrides: Partial<HistoryRowInput> & { id: string }): HistoryRowInput {
  return {
    assessedAt: '2026-01-01T00:00:00Z',
    overallGrade: 'C',
    overallScore: 40,
    scoringEngineVersion: ENGINE,
    ...overrides,
  }
}

describe('buildHistoryRows', () => {
  it('returns rows newest first from a chronological history', () => {
    const rows = buildHistoryRows([
      scan({ id: 'old', assessedAt: '2026-01-01T00:00:00Z' }),
      scan({ id: 'new', assessedAt: '2026-03-01T00:00:00Z' }),
    ])
    expect(rows.map(row => row.id)).toEqual(['new', 'old'])
  })

  it('calls the oldest scan a baseline rather than a zero change', () => {
    const rows = buildHistoryRows([scan({ id: 'first' })])
    expect(rows[0].delta).toBeNull()
    expect(rows[0].deltaWord).toBe('baseline')
    expect(rows[0].deltaBand).toBe('neutral')
    expect(rows[0].deltaIcon).toBeNull()
  })

  it('signs a directional movement and tones it by direction', () => {
    const rows = buildHistoryRows([
      scan({ id: 'old', overallScore: 60, assessedAt: '2026-01-01T00:00:00Z' }),
      scan({ id: 'new', overallScore: 44, assessedAt: '2026-03-01T00:00:00Z' }),
    ])
    expect(rows[0].delta).toBe('−16')
    expect(rows[0].deltaBand).toBe('maintain')
    expect(rows[0].deltaIcon).toBe('arrow-down-linear')
    expect(rows[0].deltaWord).toBeNull()
  })

  it('tones a rising deviation score as review', () => {
    const rows = buildHistoryRows([
      scan({ id: 'old', overallScore: 30, assessedAt: '2026-01-01T00:00:00Z' }),
      scan({ id: 'new', overallScore: 48, assessedAt: '2026-03-01T00:00:00Z' }),
    ])
    expect(rows[0].delta).toBe('+18')
    expect(rows[0].deltaBand).toBe('review')
  })

  it('reads a movement inside the tolerance as flat with no number', () => {
    const rows = buildHistoryRows([
      scan({ id: 'old', overallScore: 40, assessedAt: '2026-01-01T00:00:00Z' }),
      scan({ id: 'new', overallScore: 39, assessedAt: '2026-03-01T00:00:00Z' }),
    ])
    expect(rows[0].delta).toBeNull()
    expect(rows[0].deltaWord).toBe('flat')
    expect(rows[0].deltaBand).toBe('neutral')
  })

  it('names a scoring-engine change instead of implying a comparison', () => {
    const rows = buildHistoryRows([
      scan({ id: 'old', overallScore: 60, scoringEngineVersion: '1.3.0', assessedAt: '2026-01-01T00:00:00Z' }),
      scan({ id: 'new', overallScore: 40, scoringEngineVersion: '2.0.0', assessedAt: '2026-03-01T00:00:00Z' }),
    ])
    expect(rows[0].delta).toBeNull()
    expect(rows[0].deltaWord).toBe('new engine')
  })

  it('says so when a scan carries no screening score', () => {
    const rows = buildHistoryRows([scan({ id: 'a', overallScore: null })])
    expect(rows[0].meta).toBe('No screening score recorded')
  })

  it('projects the scan date in UTC so server and browser agree', () => {
    const rows = buildHistoryRows([scan({ id: 'a', assessedAt: '2026-03-01T23:30:00Z' })])
    expect(rows[0].dateLabel).toBe('1 Mar 2026')
  })

  it('adds the time only when two scans share a day', () => {
    const rows = buildHistoryRows([
      scan({ id: 'solo', assessedAt: '2026-06-01T09:00:00Z' }),
      scan({ id: 'am', assessedAt: '2026-07-19T09:15:00Z' }),
      scan({ id: 'pm', assessedAt: '2026-07-19T16:40:00Z' }),
    ])
    const byId = new Map(rows.map(row => [row.id, row.dateLabel]))
    expect(byId.get('solo')).toBe('1 Jun 2026')
    expect(byId.get('am')).toBe('19 Jul 2026 · 09:15')
    expect(byId.get('pm')).toBe('19 Jul 2026 · 16:40')
  })

  it('survives an unparseable timestamp without throwing', () => {
    const rows = buildHistoryRows([scan({ id: 'a', assessedAt: 'not-a-date' })])
    expect(rows[0].dateLabel).toBe('Date unavailable')
  })
})

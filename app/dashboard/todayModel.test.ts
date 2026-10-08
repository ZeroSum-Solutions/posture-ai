import { describe, expect, it } from 'vitest'
import { buildTodayModel, type AwaitingRow } from './todayModel'

const NOW = Date.parse('2026-10-07T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()

function awaiting(id: string, days: number): AwaitingRow {
  return { id, client_id: `c-${id}`, first_name: id, last_name: 'Smith', created_at: ago(days), scan_index: null, finding_count: 9 }
}

const counts = {
  activeClients: 28, clientsAddedThisWeek: 0, scansThisWeek: 2, scansPriorWeek: 1,
  averageScoreThisWeek: 22, averageScorePriorWeek: null,
}

describe('buildTodayModel queue (dataviz F)', () => {
  it('lists the three oldest reports with an exact wait and received date', () => {
    const model = buildTodayModel({
      awaiting: [awaiting('Uma', 70), awaiting('Diana', 3), awaiting('Bob', 0.5), awaiting('Extra', 0.1)],
      awaitingTotal: 11,
      recent: [],
      rescan: null,
      counts,
      now: NOW,
    })
    expect(model.queue.map(item => item.name)).toEqual(['Uma Smith', 'Diana Smith', 'Bob Smith'])
    expect(model.queue[0]).toMatchObject({ wait: '10 wk', waitSpoken: '10 weeks', received: '29 Jul', href: '/assessments/Uma' })
    expect(model.queue[1]).toMatchObject({ wait: '3 d', waitSpoken: '3 days' })
    expect(model.queue[2]).toMatchObject({ wait: '12 h', waitSpoken: '12 hours' })
    expect(model.hero?.action.label).toBe('Review Uma first')
  })

  it('names the longest-unscanned client as a re-scan row', () => {
    const model = buildTodayModel({
      awaiting: [],
      awaitingTotal: 0,
      recent: [],
      rescan: { id: 'c9', first_name: 'Tara', last_name: 'Smith', last_scan_at: '2026-05-03T12:00:00.000Z' },
      counts,
      now: NOW,
    })
    expect(model.queue).toEqual([])
    expect(model.rescan).toMatchObject({ name: 'Tara Smith', href: '/clients/c9', lastScan: '3 May' })
    expect(model.hero?.action.label).toBe('Start scan')
  })
})

describe('buildTodayModel week strip', () => {
  it('keeps only this-week figures in the strip and carries the all-time active count separately', () => {
    const model = buildTodayModel({
      awaiting: [],
      awaitingTotal: 0,
      recent: [],
      rescan: null,
      counts: { ...counts, clientsAddedThisWeek: 3 },
      now: NOW,
    })
    expect(model.metrics.map(metric => [metric.key, metric.label, metric.value])).toEqual([
      ['scans', 'Scans', '2'],
      ['score', 'Avg score', '22'],
      ['added', 'New clients', '3'],
    ])
    expect(model.activeClients).toBe(28)
  })
})

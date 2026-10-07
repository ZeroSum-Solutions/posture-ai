import { describe, expect, it } from 'vitest'
import { isOverdue, toDirectoryRow, type DirectoryClient } from './clientRow'

const NOW = Date.parse('2026-08-03T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()

function client(overrides: Partial<DirectoryClient> = {}): DirectoryClient {
  return {
    id: 'c1',
    first_name: 'Marcus',
    last_name: 'Ellery',
    date_of_birth: null,
    created_at: ago(200),
    last_scan_at: ago(2),
    last_assessment_id: 'a1',
    last_grade: 'C',
    last_score: 46,
    previous_score: 54,
    awaiting_review: false,
    ...overrides,
  }
}

describe('toDirectoryRow trend', () => {
  it('reads a falling deviation score as a neutral signed difference', () => {
    const row = toDirectoryRow(client(), NOW)
    expect(row.trend).toBe('−8')
    expect(row.trendIcon).toBe('arrow-down-linear')
    expect(row.trendBand).toBe('neutral')
    expect(row.trendLabel).toContain('score decreased 8 points')
    expect(row.trendLabel).toContain('meaningful change is not established')
  })

  it('reads a rising deviation score as a neutral signed difference', () => {
    const row = toDirectoryRow(client({ last_score: 60, previous_score: 46 }), NOW)
    expect(row.trend).toBe('+14')
    expect(row.trendIcon).toBe('arrow-up-linear')
    expect(row.trendBand).toBe('neutral')
    expect(row.trendLabel).toContain('score increased 14 points')
  })

  it('says "first scan" rather than drawing a single scan as flat', () => {
    const row = toDirectoryRow(client({ previous_score: null }), NOW)
    expect(row.trend).toBe('first scan')
    expect(row.trendBand).toBe('neutral')
    expect(row.trendLabel).toContain('no trend yet')
  })

  it('reports an unchanged score as flat and uncoloured', () => {
    const row = toDirectoryRow(client({ last_score: 46, previous_score: 46 }), NOW)
    expect(row.trend).toBe('flat')
    expect(row.trendBand).toBe('neutral')
  })

  it('marks a never-scanned client as new', () => {
    const row = toDirectoryRow(client({ last_scan_at: null, last_grade: null, last_score: null, previous_score: null }), NOW)
    expect(row.trend).toBe('new')
    expect(row.trendIcon).toBe('user-plus-linear')
    expect(row.meta).toBe('No scan yet')
    expect(row.grade).toBeNull()
  })
})

describe('toDirectoryRow meta', () => {
  // v3: meta is one fact only ("Scanned N days ago") — review/overdue status
  // moved to the row's trailing chip (`awaitingReview`/`overdue`) instead of
  // being folded into the subtitle line (DESIGN.md › Clients).
  it('states when the scan happened, and flags review separately', () => {
    const row = toDirectoryRow(client({ awaiting_review: true }), NOW)
    expect(row.meta).toBe('Scanned 2 days ago')
    expect(row.awaitingReview).toBe(true)
  })

  it('flags an overdue client separately from the scan date', () => {
    const row = toDirectoryRow(client({ last_scan_at: ago(60) }), NOW)
    expect(row.meta).not.toContain('overdue')
    expect(row.overdue).toBe(true)
  })

  it('links to the client record', () => {
    expect(toDirectoryRow(client(), NOW).href).toBe('/clients/c1')
  })
})

describe('isOverdue', () => {
  it('treats six weeks without a scan as overdue', () => {
    expect(isOverdue(ago(43), NOW)).toBe(true)
    expect(isOverdue(ago(41), NOW)).toBe(false)
  })

  it('treats a client who has never been scanned as overdue', () => {
    expect(isOverdue(null, NOW)).toBe(true)
  })

  it('does not call an unparseable timestamp overdue', () => {
    expect(isOverdue('nonsense', NOW)).toBe(false)
  })
})

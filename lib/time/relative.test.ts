import { describe, expect, it } from 'vitest'
import { axisDate, daysSince, relativeDay, shortDate, waitedFor } from './relative'

const NOW = Date.parse('2026-08-03T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('waitedFor', () => {
  it('reports minutes under an hour, never zero', () => {
    expect(waitedFor(ago(42 * MINUTE), NOW)).toBe('42 m')
    expect(waitedFor(ago(10_000), NOW)).toBe('1 m')
  })

  it('steps up through hours, days and weeks', () => {
    expect(waitedFor(ago(18 * HOUR), NOW)).toBe('18 h')
    expect(waitedFor(ago(2 * DAY), NOW)).toBe('2 d')
    expect(waitedFor(ago(15 * DAY), NOW)).toBe('2 w')
  })

  it('clamps a future timestamp instead of reporting negative time', () => {
    expect(waitedFor(new Date(NOW + 5 * HOUR).toISOString(), NOW)).toBe('1 m')
  })

  it('returns null rather than guessing at unusable input', () => {
    expect(waitedFor(null, NOW)).toBeNull()
    expect(waitedFor('not-a-date', NOW)).toBeNull()
  })
})

describe('relativeDay', () => {
  it.each([
    [0, 'Today'],
    [1, 'Yesterday'],
    [3, '3 days ago'],
    [8, 'Last week'],
    [42, '6 weeks ago'],
  ])('renders %i days ago as "%s"', (days, expected) => {
    expect(relativeDay(ago(days * DAY), NOW)).toBe(expected)
  })

  it('falls back to months past the eight-week mark', () => {
    expect(relativeDay(ago(120 * DAY), NOW)).toBe('4 months ago')
  })

  it('treats a future timestamp as today', () => {
    expect(relativeDay(new Date(NOW + DAY).toISOString(), NOW)).toBe('Today')
  })

  it('returns null for unusable input', () => {
    expect(relativeDay(undefined, NOW)).toBeNull()
  })
})

describe('daysSince', () => {
  it('counts whole days', () => {
    expect(daysSince(ago(3 * DAY + HOUR), NOW)).toBe(3)
    expect(daysSince(ago(HOUR), NOW)).toBe(0)
  })

  it('returns null for unusable input', () => {
    expect(daysSince('', NOW)).toBeNull()
  })
})

describe('absolute formats', () => {
  it('renders a scan date with its year', () => {
    expect(shortDate('2026-07-12T09:30:00.000Z')).toBe('12 Jul 2026')
  })

  it('drops the year for axis labels', () => {
    expect(axisDate('2026-07-12T09:30:00.000Z')).toBe('12 Jul')
  })

  it('uses the UTC calendar day and a fixed month spelling', () => {
    // 03:21 UTC on 7 Sep is 6 Sep in Los Angeles; every screen must say 7 Sep.
    expect(axisDate('2026-09-07T03:21:43.000Z')).toBe('7 Sep')
  })

  it('returns null for unusable input', () => {
    expect(shortDate(null)).toBeNull()
    expect(axisDate('nope')).toBeNull()
  })
})

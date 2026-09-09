import { describe, expect, it } from 'vitest'
import { formatClientDate, formatClientTime } from './clientDate'

describe('formatClientDate', () => {
  it('uses a fixed September abbreviation instead of runtime-dependent Intl data', () => {
    expect(formatClientDate('2026-09-09T12:00:00.000Z', 'day-month-short')).toBe('9 Sep 2026')
    expect(formatClientDate('2026-09-09T12:00:00.000Z', 'day-month-short-no-year')).toBe('9 Sep')
    expect(formatClientDate('1990-09-09', 'day-month-long')).toBe('9 September 1990')
    expect(formatClientDate('2026-09-09T12:00:00.000Z', 'month-day-short')).toBe('Sep 9, 2026')
  })

  it('projects the stored instant in UTC and fails closed for invalid dates', () => {
    expect(formatClientDate('2026-09-09T23:30:00-07:00', 'day-month-short')).toBe('10 Sep 2026')
    expect(formatClientDate('not-a-date', 'day-month-short')).toBe('Date unavailable')
  })

  it('uses deterministic UTC 24-hour time for repeated-day history rows', () => {
    expect(formatClientTime('2026-09-09T23:30:00-07:00')).toBe('06:30')
    expect(formatClientTime('not-a-date')).toBeNull()
  })
})

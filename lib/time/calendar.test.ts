import { describe, expect, it } from 'vitest'
import { utcCalendarLabel } from './calendar'

describe('UTC calendar labels', () => {
  it('uses a stable September abbreviation across ICU versions', () => {
    expect(utcCalendarLabel('2026-09-08T12:00:00Z', 'short')).toBe('8 Sep')
  })
  it('uses the same UTC day for display and comparison despite a source offset', () => {
    const value = '2026-09-08T23:30:00-07:00'
    expect(utcCalendarLabel(value, 'short')).toBe('9 Sep')
    expect(utcCalendarLabel(value, 'long')).toBe('September 9, 2026')
    expect(utcCalendarLabel(value, 'numeric')).toBe('9/9/2026')
  })
  it('does not invent a date for invalid input', () => {
    expect(utcCalendarLabel('unavailable', 'short')).toBe('date unavailable')
  })
})

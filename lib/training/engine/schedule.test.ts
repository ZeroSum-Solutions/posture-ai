import { describe, expect, it } from 'vitest'
import { expandLocalDates, resolveStrengthSchedule } from './schedule'

describe('resolveStrengthSchedule', () => {
  it('keeps valid nonconsecutive 2-day and 3-day full-body schedules', () => {
    expect(resolveStrengthSchedule(['monday', 'thursday'])).toEqual({
      kind: 'accepted',
      scheduleKind: 'full_body',
      days: [{ weekday: 'monday', sessionType: 'full_body' }, { weekday: 'thursday', sessionType: 'full_body' }],
    })
    expect(resolveStrengthSchedule(['monday', 'wednesday', 'friday']).kind).toBe('accepted')
  })

  it('returns ranked alternatives without silently moving consecutive requested days', () => {
    const result = resolveStrengthSchedule(['monday', 'tuesday'])
    expect(result.kind).toBe('adjustment_required')
    if (result.kind !== 'adjustment_required') return
    expect(result.requestedDays).toEqual(['monday', 'tuesday'])
    expect(result.alternatives[0]).toEqual({
      preservedRequestedDays: 1,
      movedSessions: 1,
      days: [{ weekday: 'monday', sessionType: 'full_body' }, { weekday: 'wednesday', sessionType: 'full_body' }],
    })
  })

  it('treats sunday and monday as consecutive across the weekly boundary', () => {
    const result = resolveStrengthSchedule(['sunday', 'monday'])
    expect(result.kind).toBe('adjustment_required')
  })

  it('alternates four upper/lower sessions and leaves an intervening day before repeated slots', () => {
    expect(resolveStrengthSchedule(['monday', 'tuesday', 'thursday', 'friday'])).toEqual({
      kind: 'accepted',
      scheduleKind: 'upper_lower',
      days: [
        { weekday: 'monday', sessionType: 'upper' },
        { weekday: 'tuesday', sessionType: 'lower' },
        { weekday: 'thursday', sessionType: 'upper' },
        { weekday: 'friday', sessionType: 'lower' },
      ],
    })
  })
})

describe('expandLocalDates', () => {
  it('keeps local calendar dates stable across DST without creating timestamps', () => {
    expect(expandLocalDates('2026-03-02', 'sunday', 3)).toEqual([
      '2026-03-08',
      '2026-03-15',
      '2026-03-22',
    ])
  })

  it('rejects impossible calendar dates', () => {
    expect(() => expandLocalDates('2026-02-30', 'monday', 8)).toThrow('Invalid local date')
  })

  it('treats a non-Monday anchor as the start of its own seven-day local window', () => {
    expect(expandLocalDates('2026-03-04', 'monday', 2)).toEqual(['2026-03-09', '2026-03-16'])
    expect(expandLocalDates('2026-03-04', 'wednesday', 2)).toEqual(['2026-03-04', '2026-03-11'])
  })

  it('validates runtime weekday input at the public boundary', () => {
    expect(() => expandLocalDates('2026-03-04', 'funday' as never, 2)).toThrow('Invalid weekday')
  })
})

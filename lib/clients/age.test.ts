// Pin a negative-UTC-offset timezone so this regression test deterministically
// exercises the boundary bug (a UTC-parsed DOB read as a day early). Set before
// any Date is constructed.
process.env.TZ = 'America/New_York'

import { describe, it, expect } from 'vitest'
import { ageFromDob, ageBand } from './age'

describe('ageFromDob / ageBand timezone safety (regression)', () => {
  it('treats a date-only DOB as a local calendar date — 13 exactly on the 13th birthday', () => {
    const now = new Date(2026, 5, 29, 9, 0, 0) // local 2026-06-29
    expect(ageFromDob('2013-06-29', now)).toBe(13)
    expect(ageBand('2013-06-29', now)).toBe('minor_13_17')
  })

  it('is still under 13 the day before the 13th birthday (no UTC off-by-one)', () => {
    // The bug: new Date('2013-06-29') is UTC midnight; in an Eastern zone its local
    // calendar date is 2013-06-28, so the child would read as 13 a day early here.
    const now = new Date(2026, 5, 28, 9, 0, 0) // local 2026-06-28
    expect(ageFromDob('2013-06-29', now)).toBe(12)
    expect(ageBand('2013-06-29', now)).toBe('under_13')
  })

  it('crosses to adult exactly on the 18th birthday, not the day before', () => {
    expect(ageBand('2008-06-29', new Date(2026, 5, 28, 9, 0, 0))).toBe('minor_13_17')
    expect(ageBand('2008-06-29', new Date(2026, 5, 29, 9, 0, 0))).toBe('adult')
  })

  it('returns null for missing, unparseable, or impossible-calendar input', () => {
    expect(ageFromDob(null)).toBe(null)
    expect(ageFromDob('not-a-date')).toBe(null)
    expect(ageFromDob('2013-99-99')).toBe(null)
    expect(ageFromDob('2013-13-01')).toBe(null)
    // Impossible date in a timestamp-shaped string must NOT normalize to Mar 1.
    expect(ageFromDob('2013-02-29T00:00:00Z')).toBe(null)
  })

  it('accepts a valid date prefix even with a time component', () => {
    expect(ageFromDob('2013-06-29T12:00:00Z', new Date(2026, 5, 29, 9, 0, 0))).toBe(13)
  })
})

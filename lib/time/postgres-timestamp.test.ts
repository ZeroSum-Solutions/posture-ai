import { describe, expect, it } from 'vitest'
import {
  canonicalizePostgresTimestamp,
  comparePostgresTimestamps,
} from './postgres-timestamp'

describe('PostgreSQL timestamp precision', () => {
  it('preserves all meaningful microseconds while canonicalizing UTC', () => {
    expect(canonicalizePostgresTimestamp('2026-07-22T12:00:00.123456+00:00'))
      .toBe('2026-07-22T12:00:00.123456Z')
    expect(canonicalizePostgresTimestamp('2026-07-22T12:00:00Z'))
      .toBe('2026-07-22T12:00:00.000Z')
  })

  it('orders timestamps that differ only below JavaScript millisecond precision', () => {
    expect(comparePostgresTimestamps(
      '2026-07-22T12:00:00.123456Z',
      '2026-07-22T12:00:00.123789Z',
    )).toBe(-1)
    expect(comparePostgresTimestamps(
      '2026-07-22T12:00:00.123789Z',
      '2026-07-22T12:00:00.123456Z',
    )).toBe(1)
  })

  it('fails closed for malformed or non-UTC values', () => {
    expect(canonicalizePostgresTimestamp('not-a-date')).toBeNull()
    expect(comparePostgresTimestamps('not-a-date', '2026-07-23')).toBeNull()
  })

  it('preserves the legacy date-only comparison contract', () => {
    expect(comparePostgresTimestamps('2026-07-22', '2026-07-23')).toBe(-1)
  })

  it('normalizes offsets without discarding sub-millisecond precision', () => {
    expect(canonicalizePostgresTimestamp('2026-07-22T05:00:00.123456-07:00'))
      .toBe('2026-07-22T12:00:00.123456Z')
    expect(comparePostgresTimestamps(
      '2026-07-22T05:00:00.123456-07:00',
      '2026-07-22T12:00:00.123789Z',
    )).toBe(-1)
  })
})

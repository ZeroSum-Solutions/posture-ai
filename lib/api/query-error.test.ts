import { describe, it, expect } from 'vitest'
import { isNoRows, NO_ROWS_CODE } from './query-error'

describe('isNoRows', () => {
  it('is true for the PostgREST no-rows code (PGRST116)', () => {
    expect(isNoRows({ code: NO_ROWS_CODE })).toBe(true)
    expect(isNoRows({ code: 'PGRST116' })).toBe(true)
  })

  it('is false for real error codes (missing column, connection, RLS)', () => {
    expect(isNoRows({ code: '42703' })).toBe(false) // undefined_column
    expect(isNoRows({ code: '42P01' })).toBe(false) // undefined_table
    expect(isNoRows({ code: 'PGRST301' })).toBe(false)
  })

  it('is false for null/undefined/codeless errors', () => {
    expect(isNoRows(null)).toBe(false)
    expect(isNoRows(undefined)).toBe(false)
    expect(isNoRows({})).toBe(false)
    expect(isNoRows({ message: 'boom' })).toBe(false)
  })
})

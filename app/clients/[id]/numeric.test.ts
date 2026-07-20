import { describe, test, expect } from 'vitest'
import { toNum } from './numeric'

describe('toNum (PostgREST NUMERIC coercion)', () => {
  test('coerces a NUMERIC-as-string into a real number usable with toFixed', () => {
    const r = toNum('42.5')
    expect(r).toBe(42.5)
    expect(typeof r).toBe('number')
    expect(r!.toFixed(1)).toBe('42.5') // the exact call site that crashed on a string
  })

  test('passes null/undefined through as null', () => {
    expect(toNum(null)).toBeNull()
    expect(toNum(undefined)).toBeNull()
  })

  test.each(['', '   ', 'not-a-number', Number.NaN, Number.POSITIVE_INFINITY])(
    'fails closed for a blank, malformed, or non-finite value: %s',
    (value) => {
      expect(toNum(value)).toBeNull()
    },
  )

  test('leaves a genuine number unchanged and orders numerically', () => {
    expect(toNum(42)).toBe(42)
    // string ordering would make 9 < 80 false; numeric ordering is correct
    expect((toNum('9') as number) < (toNum('80') as number)).toBe(true)
  })
})

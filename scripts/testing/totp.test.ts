import { describe, expect, it } from 'vitest'
import { totpCode } from './totp'

// RFC 6238 SHA-1 test secret (ASCII "12345678901234567890" in base32).
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('totpCode', () => {
  it.each([
    [59_000, '94287082'],
    [1_111_111_109_000, '07081804'],
    [1_234_567_890_000, '89005924'],
    [2_000_000_000_000, '69279037'],
  ])('matches RFC 6238 at %i ms', (nowMs, expected) => {
    expect(totpCode(RFC_SECRET, nowMs, { digits: 8 })).toBe(expected)
  })

  it('normalizes spaces, case, and base32 padding', () => {
    expect(totpCode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq====', 59_000, { digits: 8 }))
      .toBe('94287082')
  })

  it('rejects malformed secrets', () => {
    expect(() => totpCode('not-a-secret!')).toThrow('Invalid base32 TOTP secret')
  })
})

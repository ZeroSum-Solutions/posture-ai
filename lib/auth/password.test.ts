import { describe, it, expect } from 'vitest'
import { validatePasswordReset, MIN_PASSWORD_LENGTH } from './password'

describe('validatePasswordReset', () => {
  it('rejects passwords shorter than the minimum length', () => {
    const tooShort = 'a'.repeat(MIN_PASSWORD_LENGTH - 1)
    expect(validatePasswordReset(tooShort, tooShort)).toMatch(/at least/i)
  })

  it('rejects when the confirmation does not match', () => {
    expect(validatePasswordReset('abcdef', 'abcdeX')).toMatch(/do not match/i)
  })

  it('accepts a matching password at the minimum length', () => {
    const ok = 'a'.repeat(MIN_PASSWORD_LENGTH)
    expect(validatePasswordReset(ok, ok)).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import { hashConsentToken, generateConsentToken } from './token'

describe('consent token', () => {
  it('generates a 256-bit base64url raw token + its sha256 hex hash', () => {
    const { token, tokenHash } = generateConsentToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43,}$/)
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/)
    expect(tokenHash).not.toContain(token)
  })
  it('hashConsentToken is deterministic and matches generate', () => {
    const { token, tokenHash } = generateConsentToken()
    expect(hashConsentToken(token)).toBe(tokenHash)
  })
  it('mints unique tokens', () => {
    expect(generateConsentToken().token).not.toBe(generateConsentToken().token)
  })
})

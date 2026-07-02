import { describe, it, expect } from 'vitest'
import { generateShareToken, hashShareToken } from './token'

// The workout share link is a PHI-access surface (plan §5): the raw token is
// high-entropy and NEVER stored — only its hash lives in session_token_hash, so
// a DB read can't reconstruct a working link. Lookups hash the presented token
// and compare, which is IDOR-safe by construction.

describe('workout share token', () => {
  it('mints a URL-safe token and its hash', () => {
    const { token, tokenHash } = generateShareToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/) // base64url, no padding
    expect(token.length).toBeGreaterThanOrEqual(43) // 32 bytes → 43 base64url chars
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/) // sha-256 hex
  })

  it('hashes the minted token consistently (lookup path)', () => {
    const { token, tokenHash } = generateShareToken()
    expect(hashShareToken(token)).toBe(tokenHash)
  })

  it('is deterministic for a given token but unique per mint', () => {
    expect(hashShareToken('abc')).toBe(hashShareToken('abc'))
    const a = generateShareToken()
    const b = generateShareToken()
    expect(a.token).not.toBe(b.token)
    expect(a.tokenHash).not.toBe(b.tokenHash)
  })

  it('never returns the raw token in the hash', () => {
    const { token, tokenHash } = generateShareToken()
    expect(tokenHash).not.toContain(token)
  })
})

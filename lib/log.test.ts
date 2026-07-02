import { describe, test, expect } from 'vitest'
import { hashIp } from './log'

describe('hashIp', () => {
  test('returns null when the header is absent', () => {
    expect(hashIp(null)).toBeNull()
    expect(hashIp('')).toBeNull()
  })

  test('hashes a single-IP header (no raw IP in the output)', () => {
    const h = hashIp('203.0.113.7')
    expect(h).toMatch(/^[a-f0-9]{64}$/)
    expect(h).not.toContain('203.0.113.7')
  })

  test('keys on the RIGHTMOST hop — a client-prepended fake IP must not change the key', () => {
    // CDNs/proxies APPEND the connecting IP, so the rightmost hop is the only
    // one the caller cannot forge. If the leftmost hop were used, rotating a
    // fake X-Forwarded-For prefix would reset the rate-limit window at will.
    const real = hashIp('198.51.100.9')
    expect(hashIp('6.6.6.6, 198.51.100.9')).toBe(real)
    expect(hashIp('1.1.1.1, 2.2.2.2, 198.51.100.9')).toBe(real)
    expect(hashIp('6.6.6.6, 198.51.100.9')).not.toBe(hashIp('6.6.6.6'))
  })

  test('trims whitespace around the hop', () => {
    expect(hashIp('6.6.6.6,   198.51.100.9  ')).toBe(hashIp('198.51.100.9'))
  })
})

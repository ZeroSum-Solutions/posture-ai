import { describe, test, expect, vi } from 'vitest'
import { hashIp, hashResource, logEvent } from './log'

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

describe('logEvent privacy boundary', () => {
  test('never emits a raw resource identifier or provider/application detail', () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const resourceId = 'client-identifier-that-must-not-be-logged'
    const providerDetail = 'provider error containing Jane Doe'

    logEvent({
      route: 'POST /api/test',
      outcome: 'server_error',
      status: 500,
      assessmentId: resourceId,
      detail: providerDetail,
      detailCode: 'controlled_failure',
    })

    const line = String(output.mock.calls[0]?.[0])
    expect(line).toContain(hashResource(resourceId))
    expect(line).toContain('controlled_failure')
    expect(line).not.toContain(resourceId)
    expect(line).not.toContain(providerDetail)
    expect(JSON.parse(line)).toMatchObject({
      resourceHash: hashResource(resourceId),
      detailCode: 'controlled_failure',
    })
    output.mockRestore()
  })
})

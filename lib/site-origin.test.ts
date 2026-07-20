import { describe, expect, it } from 'vitest'

import { resolveSiteOrigin } from './site-origin'

describe('canonical site origin', () => {
  it('defaults to the documented production host', () => {
    expect(resolveSiteOrigin('')).toBe('https://posture-ai-ivory.vercel.app')
  })

  it('normalizes an explicit origin and permits loopback HTTP', () => {
    expect(resolveSiteOrigin('https://example.com/')).toBe('https://example.com')
    expect(resolveSiteOrigin('http://127.0.0.1:3100')).toBe('http://127.0.0.1:3100')
  })

  it('rejects unsafe or path-bearing origins', () => {
    expect(() => resolveSiteOrigin('http://example.com')).toThrow(/HTTPS/)
    expect(() => resolveSiteOrigin('https://example.com/base')).toThrow(/only an origin/)
  })
})

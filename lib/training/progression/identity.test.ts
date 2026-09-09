import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hashCanonicalDecisionIdentity } from './identity'

describe('hashCanonicalDecisionIdentity', () => {
  it('uses canonical key order and a complete SHA-256 digest', () => {
    const expected = createHash('sha256').update('{"a":1,"b":2}').digest('hex')
    expect(hashCanonicalDecisionIdentity({ b: 2, a: 1 })).toBe(expected)
    expect(hashCanonicalDecisionIdentity({ a: 1, b: 2 })).toBe(expected)
  })
})

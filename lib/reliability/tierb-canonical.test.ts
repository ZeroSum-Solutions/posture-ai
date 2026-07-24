import { describe, expect, it } from 'vitest'
import {
  canonicalizeTierB,
  parseCanonicalTierBJson,
  sha256TierB,
} from './tierb-canonical'

describe('Tier B canonical JSON', () => {
  it('sorts object keys recursively while preserving array order', () => {
    expect(canonicalizeTierB({
      z: [{ b: 2, a: 1 }, 3],
      a: 'first',
    })).toBe('{"a":"first","z":[{"a":1,"b":2},3]}')
  })

  it('matches an independently computed SHA-256 reference', () => {
    expect(sha256TierB({ b: 2, a: 1 })).toBe(
      'sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
    )
  })

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    undefined,
  ])('rejects values JSON cannot represent exactly: %s', (value) => {
    expect(() => canonicalizeTierB({ value })).toThrow()
  })

  it('accepts canonical bytes and rejects alternate or duplicate-key encodings', () => {
    expect(parseCanonicalTierBJson('{"a":1,"b":2}')).toEqual({ a: 1, b: 2 })
    expect(() => parseCanonicalTierBJson('{"b":2,"a":1}')).toThrow('canonical')
    expect(() => parseCanonicalTierBJson('{\n  "a": 1,\n  "b": 2\n}\n')).toThrow('canonical')
    expect(() => parseCanonicalTierBJson('{"a":1,"a":2}')).toThrow('canonical')
  })
})

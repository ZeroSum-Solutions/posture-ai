import { describe, test, expect, vi, afterEach } from 'vitest'
import { saveOverridePatch } from './saveOverride'

afterEach(() => vi.restoreAllMocks())

describe('saveOverridePatch', () => {
  test('returns true when the PATCH persists (2xx)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })))
    expect(await saveOverridePatch('a1', { capability: 'standard' })).toBe(true)
  })

  test('returns false on a non-2xx response — fetch resolves (does not reject) on 4xx/5xx', async () => {
    // This is the core of the silent-failure bug: a 429/500 must be reported as a
    // failed save, not swallowed as success.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 })))
    expect(await saveOverridePatch('a1', { priority_keys: ['forward_head_posture'] })).toBe(false)
  })

  test('returns false when fetch throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await saveOverridePatch('a1', { exercise_swaps: {} })).toBe(false)
  })
})

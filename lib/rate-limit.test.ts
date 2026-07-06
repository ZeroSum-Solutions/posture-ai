import { describe, it, expect, vi } from 'vitest'
import { enforceRateLimit, enforceRateLimitStrict } from './rate-limit'

const svc = (rpc: () => Promise<{ data: unknown; error: unknown }>) =>
  ({ rpc: vi.fn(rpc) }) as unknown as import('@supabase/supabase-js').SupabaseClient
const opts = { route: 'test', userId: 'u1', limit: 5, windowSeconds: 60 }

describe('enforceRateLimit (fail-open)', () => {
  it('allows when under limit (rpc true)', async () => {
    expect(await enforceRateLimit(svc(async () => ({ data: true, error: null })), opts)).toBe(true)
  })
  it('denies when over limit (rpc false)', async () => {
    expect(await enforceRateLimit(svc(async () => ({ data: false, error: null })), opts)).toBe(false)
  })
  it('FAILS OPEN on rpc error (documented availability posture)', async () => {
    expect(await enforceRateLimit(svc(async () => ({ data: null, error: { message: 'db down' } })), opts)).toBe(true)
  })
})

describe('enforceRateLimitStrict (fail-closed)', () => {
  it('allows/denies identically under normal operation', async () => {
    expect(await enforceRateLimitStrict(svc(async () => ({ data: true, error: null })), opts)).toBe(true)
    expect(await enforceRateLimitStrict(svc(async () => ({ data: false, error: null })), opts)).toBe(false)
  })
  it('FAILS CLOSED on rpc error', async () => {
    expect(await enforceRateLimitStrict(svc(async () => ({ data: null, error: { message: 'db down' } })), opts)).toBe(false)
  })
})

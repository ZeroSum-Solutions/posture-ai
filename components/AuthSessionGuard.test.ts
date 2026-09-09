import { describe, expect, it, vi } from 'vitest'
import { shouldClearForAccountChange, shouldClearForAuthEvent, synchronizeTrainingOfflineForAuthEvent } from './AuthSessionGuard'

describe('AuthSessionGuard policy', () => {
  it('clears a protected page when the next authenticated account differs', () => {
    expect(shouldClearForAccountChange('/train', 'athlete-a', 'athlete-b')).toBe(true)
    expect(shouldClearForAccountChange('/clients/123', 'coach-a', 'coach-b')).toBe(true)
    expect(shouldClearForAccountChange('/train', 'athlete-a', 'athlete-a')).toBe(false)
    expect(shouldClearForAccountChange('/train', 'athlete-a', null)).toBe(false)
    expect(shouldClearForAccountChange('/train', null, 'athlete-a')).toBe(false)
    expect(shouldClearForAccountChange('/auth/sign-in', 'athlete-a', 'athlete-b')).toBe(false)
  })
  it('clears protected content after a cross-tab signout', () => {
    expect(shouldClearForAuthEvent('SIGNED_OUT', '/clients/123')).toBe(true)
    expect(shouldClearForAuthEvent('SIGNED_OUT', '/auth/mfa')).toBe(true)
  })

  it('does not replace public token or sign-in surfaces', () => {
    expect(shouldClearForAuthEvent('SIGNED_OUT', '/auth/sign-in')).toBe(false)
    expect(shouldClearForAuthEvent('SIGNED_OUT', '/consent/token')).toBe(false)
    expect(shouldClearForAuthEvent('TOKEN_REFRESHED', '/clients')).toBe(false)
  })

  it('clears only an explicit signout and preserves unknown transient auth state', async () => {
    const synchronize = vi.fn(async () => {})

    await synchronizeTrainingOfflineForAuthEvent('SIGNED_OUT', null, synchronize)
    await synchronizeTrainingOfflineForAuthEvent('TOKEN_REFRESHED', null, synchronize)
    await synchronizeTrainingOfflineForAuthEvent(
      'SIGNED_IN',
      '71000000-0000-4000-8000-000000000001',
      synchronize,
    )

    expect(synchronize.mock.calls).toEqual([
      [{ kind: 'signed_out' }],
      [{ kind: 'unknown' }],
      [{ kind: 'authenticated', userId: '71000000-0000-4000-8000-000000000001' }],
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { shouldClearForAuthEvent } from './AuthSessionGuard'

describe('AuthSessionGuard policy', () => {
  it('clears protected content after a cross-tab signout', () => {
    expect(shouldClearForAuthEvent('SIGNED_OUT', '/clients/123')).toBe(true)
    expect(shouldClearForAuthEvent('SIGNED_OUT', '/auth/mfa')).toBe(true)
  })

  it('does not replace public token or sign-in surfaces', () => {
    expect(shouldClearForAuthEvent('SIGNED_OUT', '/auth/sign-in')).toBe(false)
    expect(shouldClearForAuthEvent('SIGNED_OUT', '/consent/token')).toBe(false)
    expect(shouldClearForAuthEvent('TOKEN_REFRESHED', '/clients')).toBe(false)
  })
})

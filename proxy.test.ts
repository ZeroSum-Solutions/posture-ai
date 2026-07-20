import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getUser = vi.fn()
const getAuthenticatorAssuranceLevel = vi.fn()
const signOut = vi.fn()
const maybeSingle = vi.fn()
const rpc = vi.fn()
let cookieAdapter: { setAll: (cookies: unknown[]) => void }

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn((_url, _key, options) => {
    cookieAdapter = options.cookies
    return {
      auth: { getUser, signOut, mfa: { getAuthenticatorAssuranceLevel } },
      rpc,
    }
  }),
}))

import { proxy } from './proxy'

describe('proxy PR-04 admission boundary', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    getUser.mockReset().mockImplementation(async () => {
      cookieAdapter.setAll([
        { name: 'sb-session', value: 'rotated', options: { httpOnly: true, path: '/' } },
      ])
      return { data: { user: { id: 'u1' } }, error: null }
    })
    getAuthenticatorAssuranceLevel.mockReset().mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    })
    signOut.mockReset().mockResolvedValue({ error: null })
    rpc.mockReset().mockReturnValue({ maybeSingle })
    maybeSingle.mockReset().mockResolvedValue({
      data: { access_status: 'active', role: 'practitioner', session_is_current: true, non_diagnostic_ack_at: '2026-07-19T00:00:00Z' },
      error: null,
    })
  })

  test('preserves refreshed cookies when redirecting an unauthenticated page request', async () => {
    getUser.mockImplementationOnce(async () => {
      cookieAdapter.setAll([
        { name: 'sb-session', value: 'rotated', options: { httpOnly: true, path: '/' } },
      ])
      return { data: { user: null }, error: null }
    })

    const response = await proxy(new NextRequest('http://localhost/clients?view=recent'))

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/auth/sign-in?next=%2Fclients%3Fview%3Drecent')
    expect(response.cookies.get('sb-session')?.value).toBe('rotated')
  })

  test('allows only authenticated users into the AAL1 setup corridor', async () => {
    const response = await proxy(new NextRequest('http://localhost/auth/mfa?next=/dashboard'))

    expect(response.status).toBe(200)
    expect(getAuthenticatorAssuranceLevel).not.toHaveBeenCalled()
    expect(maybeSingle).not.toHaveBeenCalled()
  })

  test('returns a JSON denial for AAL1 API requests', async () => {
    getAuthenticatorAssuranceLevel.mockResolvedValueOnce({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
      error: null,
    })

    const response = await proxy(new NextRequest('http://localhost/api/clients'))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'mfa_required' })
    expect(response.cookies.get('sb-session')?.value).toBe('rotated')
  })

  test('requires active practitioner role after AAL2', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { access_status: 'revoked', role: 'practitioner', session_is_current: true, non_diagnostic_ack_at: null },
      error: null,
    })

    const response = await proxy(new NextRequest('http://localhost/dashboard'))

    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(response.headers.get('location')).toContain('/auth/sign-in?reason=access_revoked')
  })

  test('does not loop a non-invited AAL2 account back through MFA', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null })

    const response = await proxy(new NextRequest('http://localhost/dashboard'))

    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(response.headers.get('location')).toContain('/auth/sign-in?reason=access_denied')
  })

  test('allows invited and recovery-pending AAL2 sessions to finish atomically', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { access_status: 'recovery_pending', role: 'practitioner', session_is_current: false, non_diagnostic_ack_at: null },
      error: null,
    })

    const response = await proxy(new NextRequest('http://localhost/dashboard'))

    expect(response.headers.get('location')).toContain('/auth/mfa?next=%2Fdashboard')
    expect(signOut).not.toHaveBeenCalled()
  })

  test('rejects an active account when the JWT predates its recovery cutoff', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { access_status: 'active', role: 'practitioner', session_is_current: false, non_diagnostic_ack_at: null },
      error: null,
    })

    const response = await proxy(new NextRequest('http://localhost/dashboard'))

    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(response.headers.get('location')).toContain('/auth/sign-in?reason=session_stale')
  })

  test('preserves the disclaimer corridor only after active AAL2 admission', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { access_status: 'active', role: 'practitioner', session_is_current: true, non_diagnostic_ack_at: null },
      error: null,
    })

    const response = await proxy(new NextRequest('http://localhost/dashboard'))

    expect(response.headers.get('location')).toBe('http://localhost/onboarding')
    expect(response.cookies.get('sb-session')?.value).toBe('rotated')
  })
})

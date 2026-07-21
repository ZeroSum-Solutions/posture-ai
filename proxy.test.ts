import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getUser = vi.fn()
const getAuthenticatorAssuranceLevel = vi.fn()
const signOut = vi.fn()
const maybeSingle = vi.fn()
const rpc = vi.fn()
const legalOrder = vi.fn()
const from = vi.fn()
let cookieAdapter: { setAll: (cookies: unknown[]) => void }

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn((_url, _key, options) => {
    cookieAdapter = options.cookies
    return {
      auth: { getUser, signOut, mfa: { getAuthenticatorAssuranceLevel } },
      rpc,
      from,
    }
  }),
}))

import { proxy } from './proxy'

describe('proxy PR-04 admission boundary', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    process.env.POSTURE_TEST_MODE_ENABLED = '1'
    process.env.VERCEL_ENV = 'preview'
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
    legalOrder.mockReset().mockResolvedValue({
      data: [
        {
          legal_document_id: 'terms-test-fixture-v1',
          legal_document_version: 'test-1',
          legal_document_body_sha256: '57a4cdb692b60cde1662346c292a6213ac1351dee20ed55ec23339ecf6a733b2',
          legal_document_effective_at: '2026-07-20T00:00:00+00:00',
          legal_jurisdiction: 'US',
          legal_product_scope: 'us_fitness_wellness_assessment_beta_v1',
          accepted_at: '2026-07-20T01:00:00.000Z',
        },
        {
          legal_document_id: 'privacy-test-fixture-v1',
          legal_document_version: 'test-1',
          legal_document_body_sha256: '0b15b685fd1032bff1547563c6ce44dffb573485f6aef46d16e3f472597cea3b',
          legal_document_effective_at: '2026-07-20T00:00:00+00:00',
          legal_jurisdiction: 'US',
          legal_product_scope: 'us_fitness_wellness_assessment_beta_v1',
          accepted_at: '2026-07-20T01:00:00.000Z',
        },
        {
          legal_document_id: 'screening-notice-test-fixture-v1',
          legal_document_version: 'test-1',
          legal_document_body_sha256: 'ce14bfa5b311aeed4c47267068730ef35b5daf6944a3fcf0d776c3a0868fac8f',
          legal_document_effective_at: '2026-07-20T00:00:00+00:00',
          legal_jurisdiction: 'US',
          legal_product_scope: 'us_fitness_wellness_assessment_beta_v1',
          accepted_at: '2026-07-20T01:00:00.000Z',
        },
      ],
      error: null,
    })
    from.mockReset().mockReturnValue({
      select: () => ({ eq: () => ({ order: legalOrder }) }),
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

  test('lets the secret-authenticated privacy cron reach its own auth boundary without a user session', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null })

    const response = await proxy(new NextRequest('http://localhost/api/internal/privacy-maintenance'))

    expect(response.status).toBe(200)
    expect(getAuthenticatorAssuranceLevel).not.toHaveBeenCalled()
    expect(maybeSingle).not.toHaveBeenCalled()
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

  test.each(['/onboarding', '/api/legal/accept'])(
    'preserves the legal-acceptance corridor at %s after active AAL2 admission',
    async (path) => {
      legalOrder.mockResolvedValueOnce({ data: [], error: null })
      const response = await proxy(new NextRequest(`http://localhost${path}`))

      expect(response.status).toBe(200)
      expect(response.cookies.get('sb-session')?.value).toBe('rotated')
      expect(legalOrder).not.toHaveBeenCalled()
    },
  )

  test('rejects a legacy timestamp when governed acceptance evidence is absent', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { access_status: 'active', role: 'practitioner', session_is_current: true, non_diagnostic_ack_at: '2026-07-19T00:00:00Z' },
      error: null,
    })
    legalOrder.mockResolvedValueOnce({ data: [], error: null })

    const response = await proxy(new NextRequest('http://localhost/dashboard'))

    expect(response.headers.get('location')).toBe('http://localhost/onboarding')
    expect(response.cookies.get('sb-session')?.value).toBe('rotated')
  })

  test('returns a legal acceptance denial for protected APIs', async () => {
    legalOrder.mockResolvedValueOnce({ data: [], error: null })

    const response = await proxy(new NextRequest('http://localhost/api/clients'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: 'legal_acceptance_required' })
  })

  test('fails closed when production legal documents are unavailable', async () => {
    delete process.env.POSTURE_TEST_MODE_ENABLED
    process.env.VERCEL_ENV = 'production'

    const response = await proxy(new NextRequest('http://localhost/api/clients'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: 'legal_unavailable' })
  })
})

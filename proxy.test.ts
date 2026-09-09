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

import { config, proxy } from './proxy'

describe('proxy PR-04 admission boundary', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    process.env.POSTURE_TEST_MODE_ENABLED = '1'
    delete process.env.NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT
    process.env.VERCEL_ENV = 'preview'
    delete process.env.POSTURE_OPERATION_MODE
    delete process.env.POSTURE_PROTOTYPE_PRACTITIONER_IDS
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
      data: { actor_kind: 'practitioner', subject_id: null, access_status: 'active', role: 'practitioner', session_is_current: true, invitation_mode: null },
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

  function configurePrototypeOperator() {
    const id = '11111111-1111-4111-8111-111111111111'
    process.env.POSTURE_OPERATION_MODE = 'prototype'
    process.env.POSTURE_PROTOTYPE_PRACTITIONER_IDS = id
    process.env.VERCEL_ENV = 'production'
    getUser.mockResolvedValue({ data: { user: { id } }, error: null })
  }

  test('lets an admitted prototype operator open the original app without document acceptance', async () => {
    configurePrototypeOperator()
    const response = await proxy(new NextRequest('http://localhost/dashboard'))
    expect(response.status).toBe(200)
    expect(legalOrder).not.toHaveBeenCalled()
  })

  test('still requires MFA in prototype operation', async () => {
    configurePrototypeOperator()
    getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1' }, error: null })
    const response = await proxy(new NextRequest('http://localhost/dashboard'))
    expect(response.headers.get('location')).toContain('/auth/mfa')
  })

  test('does not grant prototype access to a different practitioner', async () => {
    configurePrototypeOperator()
    getUser.mockResolvedValue({ data: { user: { id: '22222222-2222-4222-8222-222222222222' } }, error: null })
    const response = await proxy(new NextRequest('http://localhost/dashboard'))
    expect(response.headers.get('location')).toContain('/onboarding')
  })

  test('serves original anatomy assets only after prototype operator admission', async () => {
    configurePrototypeOperator()
    const allowed = await proxy(new NextRequest('http://localhost/muscle-viewer/model.glb'))
    expect(allowed.status).toBe(200)
    expect(maybeSingle).toHaveBeenCalled()
    maybeSingle.mockResolvedValue({ data: { actor_kind: 'practitioner', subject_id: null, access_status: 'revoked', role: 'practitioner', session_is_current: true, invitation_mode: null }, error: null })
    const denied = await proxy(new NextRequest('http://localhost/muscle-viewer/model.glb'))
    expect(denied.status).not.toBe(200)
  })

  test.each([
    '/muscle-viewer/index.html',
    '/muscle-viewer/favicon.svg',
    '/muscle-viewer/model.glb',
    '/audio/workout-coach-river/a635741e.mp3',
    '/demos/dead-bug.jpg',
    '/demos/dead-bug.mp4',
  ])('denies the direct clinical static path %s before authentication', async (path) => {
    const response = await proxy(new NextRequest(`http://localhost${path}`))

    expect(response.status).toBe(404)
    expect(getUser).not.toHaveBeenCalled()
  })

  test('the matcher cannot bypass clinical gates because of a static-file extension', () => {
    expect(config.matcher).toContain('/muscle-viewer/:path*')
    expect(config.matcher).toContain('/audio/workout-coach-river/:path*')
    expect(config.matcher).toContain('/demos/:path*')
  })

  test('allows clinical static assets only in the explicit two-flag test fixture', async () => {
    process.env.NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT = '1'

    const response = await proxy(new NextRequest('http://localhost/muscle-viewer/model.glb'))

    expect(response.status).toBe(200)
    expect(getUser).toHaveBeenCalled()
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

  test('adds a unique nonce policy to application responses', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })

    const first = await proxy(new NextRequest('http://localhost/auth/sign-in'))
    const second = await proxy(new NextRequest('http://localhost/auth/sign-in'))
    const firstPolicy = first.headers.get('content-security-policy') ?? ''
    const secondPolicy = second.headers.get('content-security-policy') ?? ''

    expect(firstPolicy).toContain("script-src 'self' 'nonce-")
    expect(firstPolicy).toContain("'strict-dynamic' 'wasm-unsafe-eval'")
    expect(firstPolicy).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(firstPolicy).toContain("object-src 'none'")
    expect(secondPolicy).not.toBe(firstPolicy)
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

  test('lets an anonymous invitation fragment reach only the exact athlete callback page', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null })

    const callback = await proxy(new NextRequest('http://localhost/train/accept-invite'))
    expect(callback.status).toBe(200)
    expect(getAuthenticatorAssuranceLevel).not.toHaveBeenCalled()
    expect(maybeSingle).not.toHaveBeenCalled()

    getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const neighbor = await proxy(new NextRequest('http://localhost/train/accept-invite/export'))
    expect(neighbor.status).toBe(307)
    expect(neighbor.headers.get('location')).toContain('/auth/sign-in')
  })

  test('lets only the exact authenticated erasure retry reach its route after subject deletion', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })

    const retry = await proxy(new NextRequest('http://localhost/api/training/privacy/erase'))
    expect(retry.status).toBe(200)
    expect(getUser).toHaveBeenCalled()
    expect(getAuthenticatorAssuranceLevel).not.toHaveBeenCalled()
    expect(maybeSingle).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()

    const neighboring = await proxy(new NextRequest('http://localhost/api/training/privacy/erase/export'))
    expect(neighboring.status).toBe(403)
    await expect(neighboring.json()).resolves.toMatchObject({ code: 'practitioner_access_required' })
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
      data: { actor_kind: 'practitioner', subject_id: null, access_status: 'revoked', role: 'practitioner', session_is_current: true, invitation_mode: null },
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
      data: { actor_kind: 'practitioner', subject_id: null, access_status: 'recovery_pending', role: 'practitioner', session_is_current: false, invitation_mode: null },
      error: null,
    })

    const response = await proxy(new NextRequest('http://localhost/dashboard'))

    expect(response.headers.get('location')).toContain('/auth/mfa?next=%2Fdashboard')
    expect(signOut).not.toHaveBeenCalled()
  })

  test('rejects an active account when the JWT predates its recovery cutoff', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { actor_kind: 'practitioner', subject_id: null, access_status: 'active', role: 'practitioner', session_is_current: false, invitation_mode: null },
      error: null,
    })

    const response = await proxy(new NextRequest('http://localhost/dashboard'))

    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(response.headers.get('location')).toContain('/auth/sign-in?reason=session_stale')
  })

  test('allows an active current athlete only into the athlete workspace', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        actor_kind: 'athlete',
        subject_id: '11111111-1111-4111-8111-111111111111',
        access_status: 'active',
        role: 'athlete',
        session_is_current: true,
        invitation_mode: 'coach_invited',
      },
      error: null,
    })

    expect((await proxy(new NextRequest('http://localhost/train'))).status).toBe(200)
    expect((await proxy(new NextRequest('http://localhost/api/training/profile?subjectId=1'))).status).toBe(200)
    for (const path of ['/exercises', '/workouts/manual', '/workouts/manual/new', '/workouts/manual/11111111-1111-4111-8111-111111111111']) {
      expect((await proxy(new NextRequest(`http://localhost${path}`))).status).toBe(200)
    }
    for (const path of ['/workouts', '/workouts/manual-other', '/exercises/private']) {
      expect((await proxy(new NextRequest(`http://localhost${path}`))).headers.get('location')).toBe('http://localhost/train?reason=scope_denied')
    }
    const pageDenied = await proxy(new NextRequest('http://localhost/dashboard'))
    expect(pageDenied.headers.get('location')).toBe('http://localhost/train?reason=scope_denied')
    const apiDenied = await proxy(new NextRequest('http://localhost/api/clients'))
    expect(apiDenied.status).toBe(403)
    await expect(apiDenied.json()).resolves.toMatchObject({ code: 'athlete_scope_denied' })
    expect(legalOrder).not.toHaveBeenCalled()
  })

  test('routes an invited athlete through its own completion mode and fails stale sessions closed', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: {
        actor_kind: 'athlete', subject_id: '11111111-1111-4111-8111-111111111111',
        access_status: 'invited', role: 'athlete', session_is_current: true,
        invitation_mode: 'self_directed',
      },
      error: null,
    })
    const invited = await proxy(new NextRequest('http://localhost/train'))
    expect(invited.headers.get('location')).toContain('/auth/mfa?mode=athlete-invite&next=%2Ftrain')
    expect(signOut).not.toHaveBeenCalled()

    maybeSingle.mockResolvedValueOnce({
      data: {
        actor_kind: 'athlete', subject_id: '11111111-1111-4111-8111-111111111111',
        access_status: 'active', role: 'athlete', session_is_current: false,
        invitation_mode: 'self_directed',
      },
      error: null,
    })
    const stale = await proxy(new NextRequest('http://localhost/train'))
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(stale.headers.get('location')).toContain('/auth/sign-in?reason=session_stale')
  })

  test('fails a same-UID dual identity closed', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: {
        actor_kind: 'ambiguous', subject_id: null, access_status: 'denied',
        role: null, session_is_current: false, invitation_mode: null,
      },
      error: null,
    })
    const response = await proxy(new NextRequest('http://localhost/train'))
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(response.headers.get('location')).toContain('/auth/sign-in?reason=access_denied')
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
      data: { actor_kind: 'practitioner', subject_id: null, access_status: 'active', role: 'practitioner', session_is_current: true, invitation_mode: null },
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

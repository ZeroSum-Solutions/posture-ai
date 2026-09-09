import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  rateLimit: vi.fn(),
  prepare: vi.fn(),
  dependencies: vi.fn(),
  server: { auth: 'session' },
  service: { auth: { admin: true } },
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => mocks.server),
  createSupabaseServiceClient: vi.fn(() => mocks.service),
}))
vi.mock('@/lib/training/access/server-actor', () => ({ requireTrainingServerActor: mocks.actor }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimitStrict: mocks.rateLimit }))
vi.mock('@/lib/site-origin', () => ({ resolveSiteOrigin: () => 'https://app.example.invalid' }))
vi.mock('@/lib/training/invitations/prepare', async (original) => {
  const actual = await original<typeof import('@/lib/training/invitations/prepare')>()
  return {
    ...actual,
    createSupabaseInvitationPrepareDependencies: mocks.dependencies,
    prepareCoachAthleteInvitation: mocks.prepare,
  }
})

import { POST } from './route'

const requestId = '12000000-0000-4000-8000-000000000001'
const clientId = '13000000-0000-4000-8000-000000000001'
const invitationId = '14000000-0000-4000-8000-000000000001'
const validBody = {
  requestId,
  clientId,
  email: 'athlete@example.invalid',
  permissions: ['profile:read', 'program:coach_publish'],
}

function request(body: unknown = validBody) {
  return new Request('https://app.example.invalid/api/training/coaching/invitations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.actor.mockResolvedValue({
    ok: true, actorKind: 'practitioner', userId: '11000000-0000-4000-8000-000000000001', subjectId: null,
  })
  mocks.rateLimit.mockResolvedValue(true)
  mocks.dependencies.mockReturnValue({ generated: true })
  mocks.prepare.mockResolvedValue({
    status: 'prepared', invitationId,
    invitationUrl: 'https://auth.example.invalid/auth/v1/verify?token=secret',
    expiresAt: '2026-09-16T18:00:00.000Z',
  })
})

describe('POST /api/training/coaching/invitations', () => {
  it('prepares a private link for an active AAL2 practitioner without email delivery', async () => {
    const response = await POST(request())
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({
      status: 'prepared', invitationId,
      invitationUrl: 'https://auth.example.invalid/auth/v1/verify?token=secret',
      expiresAt: '2026-09-16T18:00:00.000Z',
    })
    expect(mocks.rateLimit).toHaveBeenCalledWith(mocks.service, expect.objectContaining({
      route: 'training_coach_invitation_prepare', userId: '11000000-0000-4000-8000-000000000001',
    }))
    expect(mocks.prepare).toHaveBeenCalledWith(
      validBody,
      '11000000-0000-4000-8000-000000000001',
      'https://app.example.invalid',
      { generated: true },
    )
  })

  it('rejects malformed and duplicate permission input before auth or link generation', async () => {
    for (const body of [
      { ...validBody, unexpected: true },
      { ...validBody, email: 'not-email' },
      { ...validBody, permissions: ['profile:read', 'profile:read'] },
      { ...validBody, permissions: ['admin'] },
    ]) {
      expect((await POST(request(body))).status).toBe(422)
    }
    expect(mocks.actor).not.toHaveBeenCalled()
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('preserves actor and AAL2 denials and rejects an athlete actor', async () => {
    mocks.actor.mockResolvedValueOnce({ ok: false, status: 403, code: 'mfa_required' })
    expect((await POST(request())).status).toBe(403)
    mocks.actor.mockResolvedValueOnce({
      ok: true, actorKind: 'athlete', userId: '15000000-0000-4000-8000-000000000001',
      subjectId: '16000000-0000-4000-8000-000000000001',
    })
    const athleteResponse = await POST(request())
    expect(athleteResponse.status).toBe(403)
    await expect(athleteResponse.json()).resolves.toEqual({ error: 'practitioner_required' })
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('fails closed when durable rate-limit storage is unavailable', async () => {
    mocks.rateLimit.mockResolvedValueOnce(false)
    const response = await POST(request())
    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({ error: 'invitation_prepare_rate_limited' })
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it.each([
    ['PT409', 409, 'invitation_request_conflict'],
    ['23505', 409, 'invitation_request_conflict'],
    ['22023', 422, 'invalid_invitation_request'],
    ['42501', 403, 'invitation_prepare_forbidden'],
    ['P0001', 403, 'invitation_prepare_forbidden'],
    ['XX000', 503, 'invitation_prepare_unavailable'],
  ])('maps database code %s without exposing internal detail', async (code, status, expected) => {
    mocks.prepare.mockRejectedValueOnce({ code, message: 'sensitive detail' })
    const response = await POST(request())
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toMatchObject({ error: expected })
  })

  it('does not return a generated link when the post-generation binding fails', async () => {
    mocks.prepare.mockRejectedValueOnce(new (await import('@/lib/training/invitations/prepare')).InvitationPrepareError(
      'invitation_prepare_binding_failed',
    ))
    const response = await POST(request())
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'invitation_prepare_binding_failed' })
  })
})

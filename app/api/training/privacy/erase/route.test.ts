import { beforeEach, describe, expect, test, vi } from 'vitest'

const { getUser, getAuthenticatorAssuranceLevel, rpc, rateLimit } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAuthenticatorAssuranceLevel: vi.fn(),
  rpc: vi.fn(),
  rateLimit: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser, mfa: { getAuthenticatorAssuranceLevel } }, rpc,
  })),
  createSupabaseServiceClient: vi.fn(() => ({})),
}))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimitStrict: rateLimit }))

import { POST } from './route'

const requestId = '77000000-0000-4000-8000-000000000001'
const subjectId = '72000000-0000-4000-8000-000000000001'

function request(body: unknown = { requestId }) {
  return new Request('http://localhost/api/training/privacy/erase', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}

describe('POST /api/training/privacy/erase', () => {
  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({ data: { user: { id: 'owner-user' } }, error: null })
    getAuthenticatorAssuranceLevel.mockReset().mockResolvedValue({ data: { currentLevel: 'aal2' }, error: null })
    rateLimit.mockReset().mockResolvedValue(true)
    rpc.mockReset().mockResolvedValue({ data: { schemaVersion: 'training-subject-erasure.v1', status: 'erased', subjectId, requestId }, error: null })
  })

  test('invokes the actor-derived erasure with only an idempotency key', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({
      schemaVersion: 'training-subject-erasure.v1', status: 'erased', subjectId, requestId,
    })
    expect(rpc).toHaveBeenCalledWith('erase_training_subject_transactional', { p_request_id: requestId })
  })

  test('requires an authenticated AAL2 user and rejects malformed input', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    expect((await POST(request())).status).toBe(401)

    getAuthenticatorAssuranceLevel.mockResolvedValueOnce({ data: { currentLevel: 'aal1' }, error: null })
    expect((await POST(request())).status).toBe(403)

    expect((await POST(request({ requestId: 'not-a-uuid' }))).status).toBe(422)
  })

  test('fails closed for practitioners, other owners and unavailable storage', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
    expect((await POST(request())).status).toBe(403)

    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001' } })
    expect((await POST(request())).status).toBe(404)

    rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000' } })
    expect((await POST(request())).status).toBe(503)
  })

  test('returns an idempotent already-erased receipt after an ambiguous response', async () => {
    rpc.mockResolvedValueOnce({ data: { schemaVersion: 'training-subject-erasure.v1', status: 'already_erased', subjectId, requestId }, error: null })
    const response = await POST(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'already_erased', subjectId, requestId })
  })
})

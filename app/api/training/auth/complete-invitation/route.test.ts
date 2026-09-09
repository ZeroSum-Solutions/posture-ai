import { beforeEach, describe, expect, test, vi } from 'vitest'

const getUser = vi.fn()
const getAuthenticatorAssuranceLevel = vi.fn()
const rpc = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser, mfa: { getAuthenticatorAssuranceLevel } },
    rpc,
  })),
}))

import { POST } from './route'

describe('POST /api/training/auth/complete-invitation', () => {
  beforeEach(() => {
    getUser.mockReset().mockResolvedValue({
      data: { user: { id: 'athlete-user', email: 'athlete@example.test' } },
      error: null,
    })
    getAuthenticatorAssuranceLevel.mockReset().mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    })
    rpc.mockReset().mockResolvedValue({ data: 'activated', error: null })
  })

  test('requires an authenticated AAL2 session before calling the actor-bound RPC', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    expect((await POST()).status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()

    getUser.mockResolvedValueOnce({ data: { user: { id: 'athlete-user' } }, error: null })
    getAuthenticatorAssuranceLevel.mockResolvedValueOnce({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
      error: null,
    })
    expect((await POST()).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  test.each(['activated', 'already_active'])('accepts %s from the no-argument RPC', async (status) => {
    rpc.mockResolvedValueOnce({ data: status, error: null })
    const response = await POST()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status })
    expect(rpc).toHaveBeenCalledWith('complete_athlete_invitation')
  })

  test('maps expired and fail-closed actor results', async () => {
    rpc.mockResolvedValueOnce({ data: 'expired', error: null })
    expect((await POST()).status).toBe(410)

    for (const code of ['revoked', 'not_invited', 'email_mismatch', 'mfa_required', 'ambiguous_actor']) {
      rpc.mockResolvedValueOnce({ data: code, error: null })
      const response = await POST()
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code })
    }
  })

  test('does not turn database errors or unknown results into admission', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
    expect((await POST()).status).toBe(500)
    rpc.mockResolvedValueOnce({ data: 'unexpected', error: null })
    expect((await POST()).status).toBe(500)
  })
})

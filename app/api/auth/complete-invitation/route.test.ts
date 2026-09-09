import { beforeEach, describe, expect, test, vi } from 'vitest'

const getUser = vi.fn()
const getAuthenticatorAssuranceLevel = vi.fn()
const rpc = vi.fn()
const actorRead = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser, mfa: { getAuthenticatorAssuranceLevel } },
    rpc: (name: string) => name === 'current_application_actor' ? { maybeSingle: actorRead } : rpc(name),
  })),
}))

import { POST } from './route'

describe('POST /api/auth/complete-invitation', () => {
  beforeEach(() => {
    getUser.mockReset()
    getAuthenticatorAssuranceLevel.mockReset()
    rpc.mockReset()
    actorRead.mockReset().mockResolvedValue({ data: { actor_kind: 'practitioner' }, error: null })
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'invited@example.test' } }, error: null })
    getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
      error: null,
    })
    rpc.mockResolvedValue({ data: 'activated', error: null })
  })

  test('rejects a missing authenticated user before calling the RPC', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null })

    const response = await POST()

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'unauthorized' })
    expect(rpc).not.toHaveBeenCalled()
  })

  test('routes an authenticated athlete through athlete admission during normal sign-in', async () => {
    actorRead.mockResolvedValue({ data: { actor_kind: 'athlete' }, error: null })
    expect((await POST()).status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('complete_athlete_invitation')
    expect(rpc).not.toHaveBeenCalledWith('complete_practitioner_invitation')
  })

  test('does not guess admission authority when actor resolution fails', async () => {
    actorRead.mockResolvedValue({ data: null, error: { code: 'XX000' } })
    expect((await POST()).status).toBe(503)
    expect(rpc).not.toHaveBeenCalled()
  })

  test('rejects a dual-identity actor without activating either identity', async () => {
    actorRead.mockResolvedValue({ data: { actor_kind: 'ambiguous' }, error: null })
    expect((await POST()).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  test('rejects AAL1 before calling the RPC', async () => {
    getAuthenticatorAssuranceLevel.mockResolvedValueOnce({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
      error: null,
    })

    const response = await POST()

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'mfa_required' })
    expect(rpc).not.toHaveBeenCalled()
  })

  test.each(['activated', 'already_active'])('accepts atomic success result %s', async (result) => {
    rpc.mockResolvedValueOnce({ data: result, error: null })

    const response = await POST()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, status: result })
    expect(rpc).toHaveBeenCalledWith('complete_practitioner_invitation')
  })

  test('maps expired invitations to 410', async () => {
    rpc.mockResolvedValueOnce({ data: 'expired', error: null })

    const response = await POST()

    expect(response.status).toBe(410)
    expect(await response.json()).toMatchObject({ code: 'expired' })
  })

  test.each([
    'revoked',
    'not_invited',
    'email_mismatch',
    'mfa_required',
    'recovery_not_authorized',
  ])('fails closed for %s', async (result) => {
    rpc.mockResolvedValueOnce({ data: result, error: null })

    const response = await POST()

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: result })
  })

  test('fails closed for database errors or unknown results', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
    expect((await POST()).status).toBe(500)

    rpc.mockResolvedValueOnce({ data: 'unexpected_state', error: null })
    expect((await POST()).status).toBe(500)
  })
})

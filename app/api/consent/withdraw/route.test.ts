import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  user: { id: '10000000-0000-4000-8000-000000000001' } as { id: string } | null,
  rpc: vi.fn(),
  logEvent: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
  createSupabaseServiceClient: () => ({ rpc: state.rpc }),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimitStrict: async () => true }))
vi.mock('@/lib/log', () => ({
  hashUser: () => 'practitioner-hash',
  hashResource: () => 'client-hash',
  logEvent: state.logEvent,
}))

import { POST } from './route'

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/consent/withdraw', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/consent/withdraw', () => {
  beforeEach(() => {
    state.user = { id: '10000000-0000-4000-8000-000000000001' }
    state.rpc.mockReset().mockResolvedValue({ data: { status: 'withdrawn', shares_revoked: 2 }, error: null })
    state.logEvent.mockReset()
  })

  test('records a controlled withdrawal and atomically revokes active shares', async () => {
    const response = await POST(request({
      client_id: '20000000-0000-4000-8000-000000000001',
      signer_name: 'Morgan Example',
      signer_relationship: 'self',
      reason_code: 'subject_request',
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'withdrawn', shares_revoked: 2 })
    expect(state.rpc).toHaveBeenCalledWith('withdraw_client_consent', expect.objectContaining({
      p_client_id: '20000000-0000-4000-8000-000000000001',
      p_practitioner_id: '10000000-0000-4000-8000-000000000001',
      p_reason_code: 'subject_request',
      p_signer_name: 'Morgan Example',
      p_signer_relationship: 'self',
      p_event_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(state.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      userHash: 'practitioner-hash',
      resourceHash: 'client-hash',
    }))
    expect(JSON.stringify(state.logEvent.mock.calls)).not.toContain('Morgan Example')
  })

  test('rejects arbitrary reason text before calling the database', async () => {
    const response = await POST(request({
      client_id: '20000000-0000-4000-8000-000000000001',
      signer_name: 'Morgan Example',
      signer_relationship: 'self',
      reason_code: 'because the client told me a long story',
    }))

    expect(response.status).toBe(422)
    expect(state.rpc).not.toHaveBeenCalled()
  })

  test('is idempotent when consent was already withdrawn', async () => {
    state.rpc.mockResolvedValueOnce({ data: { status: 'already_withdrawn', shares_revoked: 0 }, error: null })

    const response = await POST(request({
      client_id: '20000000-0000-4000-8000-000000000001',
      signer_name: 'Morgan Example',
      signer_relationship: 'self',
      reason_code: 'subject_request',
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'already_withdrawn', shares_revoked: 0 })
  })

  test('denies an unauthenticated caller before lifecycle mutation', async () => {
    state.user = null

    const response = await POST(request({
      client_id: '20000000-0000-4000-8000-000000000001',
      signer_name: 'Morgan Example',
      signer_relationship: 'self',
      reason_code: 'subject_request',
    }))

    expect(response.status).toBe(401)
    expect(state.rpc).not.toHaveBeenCalled()
  })
})

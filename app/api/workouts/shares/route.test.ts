import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  user: { id: '10000000-0000-4000-8000-000000000001' } as { id: string } | null,
  rpc: vi.fn(),
  rows: [] as Record<string, unknown>[],
  token: { token: 'raw-token', tokenHash: 'a'.repeat(64) },
}))

function query() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    or: () => chain,
    order: () => chain,
    range: async () => ({ data: state.rows, error: null }),
  }
  return chain
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
  createSupabaseServiceClient: () => ({ from: query, rpc: state.rpc }),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimitStrict: async () => true }))
vi.mock('@/lib/workout/token', () => ({ generateShareToken: () => state.token }))
vi.mock('@/lib/log', () => ({ hashUser: () => 'user-hash', hashResource: () => 'resource-hash', logEvent: vi.fn() }))

import { DELETE, GET, POST } from './route'

const sessionId = '30000000-0000-4000-8000-000000000001'
const clientId = '20000000-0000-4000-8000-000000000001'

function mutationRequest(method: 'POST' | 'DELETE', body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/workouts/shares', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('/api/workouts/shares', () => {
  beforeEach(() => {
    state.user = { id: '10000000-0000-4000-8000-000000000001' }
    state.rows = []
    state.rpc.mockReset()
  })

  test('lists scoped share metadata without returning token hashes', async () => {
    state.rows = [{
      id: sessionId,
      assessment_id: '40000000-0000-4000-8000-000000000001',
      created_at: '2026-07-20T00:00:00Z',
      expires_at: '2026-07-27T00:00:00Z',
      revoked_at: null,
      status: 'active',
      session_token_hash: 'secret-hash',
    }]

    const response = await GET(new NextRequest(`http://localhost/api/workouts/shares?client_id=${clientId}`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.shares[0]).toMatchObject({ session_id: sessionId, state: 'active' })
    expect(JSON.stringify(body)).not.toContain('secret-hash')
    expect(JSON.stringify(body)).not.toContain('session_token_hash')
  })

  test('labels a session that was never shared as inactive, not revoked', async () => {
    state.rows = [{
      id: sessionId,
      assessment_id: '40000000-0000-4000-8000-000000000001',
      created_at: '2026-07-20T00:00:00Z',
      expires_at: null,
      revoked_at: null,
      status: 'active',
      session_token_hash: null,
      share_generation: 1,
    }]

    const response = await GET(new NextRequest(`http://localhost/api/workouts/shares?client_id=${clientId}`))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ shares: [{ state: 'inactive' }] })
  })

  test('paginates the full share inventory so no older active credential is hidden', async () => {
    state.rows = Array.from({ length: 51 }, (_, index) => ({
      id: index === 50 ? '30000000-0000-4000-8000-000000000099' : sessionId,
      assessment_id: '40000000-0000-4000-8000-000000000001',
      created_at: '2026-07-20T00:00:00Z', expires_at: '2026-07-27T00:00:00Z',
      revoked_at: null, status: 'active', session_token_hash: 'secret-hash', share_generation: 1,
    }))

    const response = await GET(new NextRequest(`http://localhost/api/workouts/shares?client_id=${clientId}`))

    await expect(response.json()).resolves.toMatchObject({ shares: expect.any(Array), next_cursor: 50 })
  })

  test('rotates atomically and returns the new raw link once', async () => {
    state.rpc.mockResolvedValueOnce({ data: { status: 'rotated', share_generation: 2 }, error: null })

    const response = await POST(mutationRequest('POST', { session_id: sessionId }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ status: 'rotated', share_link: 'http://localhost/s/raw-token', share_generation: 2 })
    expect(state.rpc).toHaveBeenCalledWith('rotate_workout_share', expect.objectContaining({
      p_session_id: sessionId,
      p_new_token_hash: 'a'.repeat(64),
    }))
  })

  test('revokes immediately through the transactional RPC', async () => {
    state.rpc.mockResolvedValueOnce({ data: { status: 'revoked' }, error: null })

    const response = await DELETE(mutationRequest('DELETE', { session_id: sessionId }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'revoked' })
    expect(state.rpc).toHaveBeenCalledWith('revoke_workout_share', expect.objectContaining({ p_session_id: sessionId }))
  })

  test('denies lifecycle mutation without authentication', async () => {
    state.user = null

    const response = await DELETE(mutationRequest('DELETE', { session_id: sessionId }))

    expect(response.status).toBe(401)
    expect(state.rpc).not.toHaveBeenCalled()
  })

  test('fails closed when consent withdrawal makes rotation unavailable', async () => {
    state.rpc.mockResolvedValueOnce({ data: { status: 'consent_unavailable' }, error: null })

    const response = await POST(mutationRequest('POST', { session_id: sessionId }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Subject consent is no longer active.' })
  })

  test('does not reactivate a revoked or expired share through rotation', async () => {
    state.rpc.mockResolvedValueOnce({ data: { status: 'not_rotatable' }, error: null })

    const response = await POST(mutationRequest('POST', { session_id: sessionId }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Only an active share link can be rotated.' })
  })
})

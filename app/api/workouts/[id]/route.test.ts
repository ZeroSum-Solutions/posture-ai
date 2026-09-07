import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: '33333333-3333-4333-8333-333333333333' } } }) },
  }),
  createSupabaseServiceClient: () => ({ rpc: state.rpc }),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimitStrict: async () => true }))

import { PATCH } from './route'

const sessionId = '11111111-1111-4111-8111-111111111111'

function request(body: unknown) {
  return new NextRequest(`http://localhost/api/workouts/${sessionId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/workouts/[id]', () => {
  beforeEach(() => {
    state.rpc.mockReset().mockResolvedValue({ data: { status: 'archived' }, error: null })
  })

  test('archives the owned session through the transactional RPC', async () => {
    const response = await PATCH(request({ archived: true }), { params: Promise.resolve({ id: sessionId }) })

    expect(response.status).toBe(200)
    expect(state.rpc).toHaveBeenCalledWith('archive_workout_session', expect.objectContaining({
      p_session_id: sessionId,
      p_practitioner_id: '33333333-3333-4333-8333-333333333333',
    }))
  })

  test('rejects unsupported mutations before calling the database', async () => {
    const response = await PATCH(request({ archived: false }), { params: Promise.resolve({ id: sessionId }) })

    expect(response.status).toBe(422)
    expect(state.rpc).not.toHaveBeenCalled()
  })

  test('returns not found without exposing cross-practitioner sessions', async () => {
    state.rpc.mockResolvedValue({ data: { status: 'not_found' }, error: null })

    const response = await PATCH(request({ archived: true }), { params: Promise.resolve({ id: sessionId }) })

    expect(response.status).toBe(404)
  })
})

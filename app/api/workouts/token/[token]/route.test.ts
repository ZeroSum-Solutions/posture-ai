import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: () => ({
    rpc: state.rpc,
    from: () => ({ insert: state.insert }),
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => true }))
vi.mock('@/lib/log', () => ({ hashIp: () => 'f'.repeat(64), logEvent: vi.fn() }))
vi.mock('@/lib/workout/token', () => ({ hashShareToken: () => 'a'.repeat(64) }))
vi.mock('@/lib/workout/tokenProjection', () => ({
  redactSessionForPublic: () => ({ snapshot: { version: 2 }, clientFirstName: 'Client' }),
}))

import { GET } from './route'

const resolved = {
  workout_session_id: 'session-1',
  practitioner_id: 'practitioner-1',
  share_generation: 3,
}

function invoke() {
  return GET(new NextRequest('http://localhost/api/workouts/token/a-long-enough-public-token'), {
    params: Promise.resolve({ token: 'a-long-enough-public-token' }),
  })
}

describe('GET /api/workouts/token/[token]', () => {
  beforeEach(() => {
    state.rpc.mockReset().mockResolvedValue({ data: [resolved], error: null })
    state.insert.mockReset().mockResolvedValue({ error: null })
  })

  test('binds the durable access event to the active share generation', async () => {
    const response = await invoke()

    expect(response.status).toBe(200)
    expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({
      workout_session_id: 'session-1',
      event: 'accessed',
      actor: null,
      actor_code: 'client',
      reason_code: null,
      operation_id: expect.any(String),
      share_generation: 3,
    }))
  })

  test('fails closed instead of releasing content without its audit event', async () => {
    state.insert.mockResolvedValueOnce({ error: { message: 'audit unavailable' } })

    const response = await invoke()

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Something went wrong.' })
  })

  test('keeps a revoked or expired token response uniform', async () => {
    state.rpc.mockResolvedValueOnce({ data: [], error: null })

    const response = await invoke()

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'This session link is not available.' })
    expect(state.insert).not.toHaveBeenCalled()
  })
})

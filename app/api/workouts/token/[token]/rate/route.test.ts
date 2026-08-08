import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const token = 'a-long-enough-public-workout-token'
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: () => ({
    rpc: state.rpc,
    from: () => ({ upsert: state.upsert }),
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => true }))
vi.mock('@/lib/log', () => ({ hashIp: () => 'ip-hash', logEvent: vi.fn() }))
vi.mock('@/lib/workout/token', () => ({ hashShareToken: () => 'token-hash' }))
vi.mock('@/lib/clinical-content/runtime', () => ({
  clinicalContentAccess: () => ({ surfaces: { workouts: true } }),
}))

import { POST } from './route'

function invoke(body: unknown) {
  return POST(new NextRequest(`http://localhost/api/workouts/token/${token}/rate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ token }) })
}

describe('POST /api/workouts/token/[token]/rate', () => {
  beforeEach(() => {
    state.rpc.mockReset().mockResolvedValue({
      data: [{
        session_run_id: 'run-1',
        workout_session_id: 'session-1',
        client_id: 'client-1',
        practitioner_id: 'practitioner-1',
      }],
      error: null,
    })
    state.upsert.mockReset().mockResolvedValue({ error: null })
  })

  test('keeps an unavailable token response uniform and does not write', async () => {
    state.rpc.mockResolvedValueOnce({ data: [], error: null })
    const response = await invoke({ clarity: 4, feedback_tags: [] })
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'This session link is not available.' })
    expect(state.upsert).not.toHaveBeenCalled()
  })

  test('drops public free-text notes before persistence', async () => {
    const response = await invoke({ clarity: 4, feedback_tags: [], notes: 'private text' })
    expect(response.status).toBe(200)
    expect(state.upsert).toHaveBeenCalledWith(expect.objectContaining({ notes: null }), { onConflict: 'session_run_id' })
  })

  test('writes only the token-resolved identifiers and structured rating', async () => {
    const response = await invoke({ clarity: 4, pace: 'just_right', feedback_tags: ['clear'] })
    expect(response.status).toBe(200)
    expect(state.upsert).toHaveBeenCalledWith({
      session_run_id: 'run-1',
      workout_session_id: 'session-1',
      client_id: 'client-1',
      practitioner_id: 'practitioner-1',
      clarity: 4,
      pace: 'just_right',
      difficulty: null,
      feedback_tags: ['clear'],
      notes: null,
    }, { onConflict: 'session_run_id' })
  })
})

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const sessionId = '11111111-1111-4111-8111-111111111111'
const state = vi.hoisted(() => ({
  user: { id: 'practitioner-1' } as { id: string } | null,
  session: { id: 'session-1', client_id: 'client-1' } as { id: string; client_id: string } | null,
  run: { id: 'run-1' } as { id: string } | null,
  upsert: vi.fn(),
}))

function queryFor(table: string) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({
      data: table === 'workout_sessions' ? state.session : state.run,
      error: null,
    })),
    upsert: state.upsert,
  }
  return query
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
  createSupabaseServiceClient: () => ({ from: queryFor }),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => true }))
vi.mock('@/lib/log', () => ({ logEvent: vi.fn(), hashUser: () => 'user-hash' }))
vi.mock('@/lib/clinical-content/database', () => ({
  serverClinicalContentAccessForPractitioner: async () => ({ surfaces: { workouts: true } }),
}))

import { POST } from './route'

function invoke(body: unknown = { clarity: 4, feedback_tags: ['clear'] }) {
  return POST(new NextRequest(`http://localhost/api/workouts/${sessionId}/rate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: sessionId }) })
}

describe('POST /api/workouts/[id]/rate', () => {
  beforeEach(() => {
    state.user = { id: 'practitioner-1' }
    state.session = { id: 'session-1', client_id: 'client-1' }
    state.run = { id: 'run-1' }
    state.upsert.mockReset().mockResolvedValue({ error: null })
  })

  test('requires authentication before resolving a session', async () => {
    state.user = null
    expect((await invoke()).status).toBe(401)
    expect(state.upsert).not.toHaveBeenCalled()
  })

  test('does not write a rating for a session outside the owner scope', async () => {
    state.session = null
    expect((await invoke()).status).toBe(404)
    expect(state.upsert).not.toHaveBeenCalled()
  })

  test('upserts one practitioner-scoped rating per run', async () => {
    const response = await invoke({ clarity: 4, pace: 'just_right', feedback_tags: ['clear'], notes: 'Useful pacing.' })
    expect(response.status).toBe(200)
    expect(state.upsert).toHaveBeenCalledWith(expect.objectContaining({
      session_run_id: 'run-1',
      workout_session_id: sessionId,
      client_id: 'client-1',
      practitioner_id: 'practitioner-1',
      notes: 'Useful pacing.',
    }), { onConflict: 'session_run_id' })
  })
})

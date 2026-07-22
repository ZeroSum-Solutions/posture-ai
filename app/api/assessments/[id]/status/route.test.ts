import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  result: { data: null, error: null } as { data: unknown; error: unknown },
  logEvent: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = {}
    for (const method of ['select', 'eq']) query[method] = () => query
    query.single = async () => state.result
    return {
      auth: { getUser: async () => ({ data: { user: state.user } }) },
      from: () => query,
    }
  },
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/log', () => ({
  hashUser: () => 'user-hash',
  hashResource: () => 'assessment-hash',
  logEvent: state.logEvent,
}))

import { GET } from './route'

function invoke() {
  return GET(new NextRequest('http://localhost/api/assessments/a1/status'), {
    params: Promise.resolve({ id: 'a1' }),
  })
}

describe('GET /api/assessments/[id]/status', () => {
  beforeEach(() => {
    state.user = { id: 'u1' }
    state.result = { data: null, error: null }
    state.logEvent.mockReset()
  })

  it('returns the authoritative terminal status projection', async () => {
    state.result = {
      data: {
        id: 'a1',
        status: 'complete',
        overall_score: '12.5',
        overall_grade: 'B',
        assessed_at: '2026-07-22T00:00:00.000Z',
      },
      error: null,
    }
    const response = await invoke()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      id: 'a1',
      status: 'complete',
      overallScore: '12.5',
      overallGrade: 'B',
      assessedAt: '2026-07-22T00:00:00.000Z',
    })
  })

  it('returns 404 only for a genuine no-row result', async () => {
    state.result = { data: null, error: { code: 'PGRST116' } }
    expect((await invoke()).status).toBe(404)
  })

  it('surfaces database failures instead of reporting a missing assessment', async () => {
    state.result = { data: null, error: { code: '08006', message: 'connection failure' } }
    expect((await invoke()).status).toBe(500)
    expect(JSON.stringify(state.logEvent.mock.calls)).not.toContain('connection failure')
  })
})

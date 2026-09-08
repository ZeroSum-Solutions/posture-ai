import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({
  user: { id: 'practitioner-1' } as { id: string } | null,
  allowed: true,
  updateResult: { data: [{ id: 'assessment-1' }], error: null } as {
    data: { id: string }[] | null
    error: { message: string } | null
  },
  update: vi.fn(),
  eq: vi.fn(),
}))

function assessmentQuery() {
  const query = {
    update: vi.fn((value: unknown) => {
      state.update(value)
      return query
    }),
    eq: vi.fn((column: string, value: unknown) => {
      state.eq(column, value)
      return query
    }),
    select: vi.fn(async () => state.updateResult),
  }
  return query
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
  createSupabaseServiceClient: () => ({ from: () => assessmentQuery() }),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimitStrict: async () => state.allowed }))
vi.mock('@/lib/log', () => ({
  logEvent: vi.fn(),
  hashResource: () => 'assessment-hash',
  hashUser: () => 'user-hash',
}))

import { PATCH } from './route'

function invoke(body: unknown = { approved: true }) {
  return PATCH(new NextRequest('http://localhost/api/assessments/assessment-1/approve', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: 'assessment-1' }) })
}

describe('PATCH /api/assessments/[id]/approve', () => {
  beforeEach(() => {
    state.user = { id: 'practitioner-1' }
    state.allowed = true
    state.updateResult = { data: [{ id: 'assessment-1' }], error: null }
    state.update.mockReset()
    state.eq.mockReset()
  })

  test('requires authentication before the service-role write', async () => {
    state.user = null
    expect((await invoke()).status).toBe(401)
    expect(state.update).not.toHaveBeenCalled()
  })

  test('does not report success when the owner-scoped update changes no rows', async () => {
    state.updateResult = { data: [], error: null }
    const response = await invoke()
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Assessment not found' })
  })

  test('only approves an assessment whose persisted status is complete', async () => {
    state.updateResult = { data: [], error: null }

    const response = await invoke({ approved: true })

    expect(response.status).toBe(404)
    expect(state.eq).toHaveBeenCalledWith('status', 'complete')
  })

  test('approves an owned complete assessment', async () => {
    const response = await invoke({ approved: true })

    expect(response.status).toBe(200)
    expect(state.eq).toHaveBeenCalledWith('practitioner_id', 'practitioner-1')
    expect(state.eq).toHaveBeenCalledWith('status', 'complete')
    await expect(response.json()).resolves.toEqual({ ok: true, practitioner_approved: true })
  })

  test('records explicit revocation of approval', async () => {
    const response = await invoke({ approved: false })
    expect(response.status).toBe(200)
    expect(state.update).toHaveBeenCalledWith({
      practitioner_approved: false,
      practitioner_approved_at: null,
    })
    expect(state.eq).not.toHaveBeenCalledWith('status', 'complete')
    await expect(response.json()).resolves.toEqual({ ok: true, practitioner_approved: false })
  })
})

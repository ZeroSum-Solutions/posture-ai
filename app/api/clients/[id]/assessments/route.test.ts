import { describe, test, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Per-table query result, set per test. Mirrors the supabase-js contract:
// a query resolves to { data, error } (it does NOT throw on DB errors).
const tableResult: Record<string, { data: unknown; error: unknown }> = {}

function makeQuery(table: string) {
  const result = () => tableResult[table] ?? { data: null, error: null }
  // Chainable + awaitable: eq/neq/order/select return the builder; awaiting it
  // (or calling single/maybeSingle) resolves the per-table result.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {
    select: () => q,
    eq: () => q,
    neq: () => q,
    order: () => q,
    in: () => q,
    single: async () => result(),
    maybeSingle: async () => result(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then: (onF: any, onR: any) => Promise.resolve(result()).then(onF, onR),
  }
  return q
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => makeQuery(t),
  }),
}))

vi.mock('@/lib/auth/requirePractitioner', () => ({
  practitionerGate: async () => null,
}))

import { GET } from './route'

const params = () => Promise.resolve({ id: 'c1' })
const req = () => new NextRequest('http://localhost/api/clients/c1/assessments')

describe('GET /api/clients/[id]/assessments', () => {
  beforeEach(() => {
    tableResult.clients = { data: { id: 'c1' }, error: null }
    tableResult.assessments = { data: [], error: null }
  })

  test('returns 500 when the assessments query errors — a DB failure must NOT be masked as an empty history', async () => {
    tableResult.assessments = { data: null, error: { message: 'connection reset' } }
    const res = await GET(req(), { params: params() })
    expect(res.status).toBe(500)
  })

  test('returns 200 with the assessments on success', async () => {
    tableResult.assessments = { data: [{ id: 'a1', scoring_engine_version: '2.0.0' }], error: null }
    const res = await GET(req(), { params: params() })
    expect(res.status).toBe(200)
    expect((await res.json()).assessments).toEqual([{ id: 'a1', scoring_engine_version: '2.0.0' }])
  })
})

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Per-table query result, set per test. Mirrors the supabase-js contract:
// a query resolves to { data, error } (it does NOT throw on DB errors).
const tableResult: Record<string, { data: unknown; error: unknown }> = {}
const queryCalls: Record<string, Array<{ method: string; args: unknown[] }>> = {}
const rpcSpy = vi.fn()

function makeQuery(table: string) {
  const result = () => tableResult[table] ?? { data: null, error: null }
  // Chainable + awaitable: eq/neq/order/select return the builder; awaiting it
  // (or calling single/maybeSingle) resolves the per-table result.
  const call = (method: string, args: unknown[]) => {
    ;(queryCalls[table] ??= []).push({ method, args })
    return q
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = {
    select: (...args: unknown[]) => call('select', args),
    eq: (...args: unknown[]) => call('eq', args),
    neq: (...args: unknown[]) => call('neq', args),
    order: (...args: unknown[]) => call('order', args),
    in: (...args: unknown[]) => call('in', args),
    lte: (...args: unknown[]) => call('lte', args),
    lt: (...args: unknown[]) => call('lt', args),
    or: (...args: unknown[]) => call('or', args),
    limit: (...args: unknown[]) => call('limit', args),
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
    rpc: rpcSpy,
  }),
}))

vi.mock('@/lib/auth/requirePractitioner', () => ({
  practitionerGate: async () => null,
}))

import { GET } from './route'
import { encodeKeysetCursor } from '@/lib/pagination/keyset'

const params = () => Promise.resolve({ id: 'c1' })
const req = (search = '') => new NextRequest(`http://localhost/api/clients/c1/assessments${search}`)
const assessmentId = (index: number) => `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`

describe('GET /api/clients/[id]/assessments', () => {
  beforeEach(() => {
    for (const key of Object.keys(queryCalls)) delete queryCalls[key]
    rpcSpy.mockReset()
    rpcSpy.mockResolvedValue({ data: '2026-07-22T12:00:00.123789+00:00', error: null })
    tableResult.clients = { data: { id: 'c1' }, error: null }
    tableResult.assessments = { data: [], error: null }
  })

  test('returns 500 when the assessments query errors — a DB failure must NOT be masked as an empty history', async () => {
    tableResult.assessments = { data: null, error: { message: 'connection reset' } }
    const res = await GET(req(), { params: params() })
    expect(res.status).toBe(500)
  })

  test('returns 500 when the ownership check fails instead of masking it as a 404', async () => {
    tableResult.clients = { data: null, error: { message: 'connection reset' } }
    const res = await GET(req(), { params: params() })
    expect(res.status).toBe(500)
    expect(queryCalls.assessments).toBeUndefined()
  })

  test('returns 200 with the assessments on success', async () => {
    tableResult.assessments = { data: [{ id: 'a1', scoring_engine_version: '2.0.0' }], error: null }
    const res = await GET(req(), { params: params() })
    expect(res.status).toBe(200)
    expect((await res.json()).assessments).toEqual([{ id: 'a1', scoring_engine_version: '2.0.0' }])
  })

  test('keeps the one-version no-limit compatibility response complete and ascending', async () => {
    tableResult.assessments = {
      data: Array.from({ length: 75 }, (_, index) => ({
        id: assessmentId(index),
        assessed_at: new Date(Date.UTC(2026, 6, 20, 12, 0, 0) + index * 1000).toISOString(),
      })),
      error: null,
    }
    const res = await GET(req(), { params: params() })
    const body = await res.json()

    expect(body.assessments).toHaveLength(75)
    expect(body.pagination).toBeUndefined()
    expect(queryCalls.assessments.filter((call) => call.method === 'order')).toEqual([
      { method: 'order', args: ['assessed_at', { ascending: true }] },
      { method: 'order', args: ['id', { ascending: true }] },
    ])
    expect(queryCalls.assessments.some((call) => call.method === 'limit')).toBe(false)
  })

  test('uses a descending keyset while preserving the prior ascending response order', async () => {
    tableResult.assessments = {
      data: Array.from({ length: 51 }, (_, index) => ({
        id: assessmentId(index),
        assessed_at: new Date(Date.UTC(2026, 6, 22, 12, 0, 0) - index * 1000).toISOString(),
      })),
      error: null,
    }
    const res = await GET(req('?limit=50'), { params: params() })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(body.assessments).toHaveLength(50)
    expect(body.assessments[0].id).toBe(assessmentId(49))
    expect(body.assessments[49].id).toBe(assessmentId(0))
    expect(body.pagination).toMatchObject({
      limit: 50,
      returned: 50,
      has_more: true,
      next_cursor: expect.any(String),
    })
    expect(queryCalls.assessments.filter((call) => call.method === 'order')).toEqual([
      { method: 'order', args: ['assessed_at', { ascending: false }] },
      { method: 'order', args: ['id', { ascending: false }] },
    ])
    expect(queryCalls.assessments).toContainEqual({ method: 'limit', args: [51] })
  })

  test('uses a database-precision first-page snapshot so microsecond rows are not omitted', async () => {
    tableResult.assessments = {
      data: [{
        id: assessmentId(0),
        assessed_at: '2026-07-22T12:00:00.123456+00:00',
      }],
      error: null,
    }

    const res = await GET(req('?limit=50'), { params: params() })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(rpcSpy).toHaveBeenCalledWith('current_keyset_snapshot')
    expect(queryCalls.assessments).toContainEqual({
      method: 'lte',
      args: ['assessed_at', '2026-07-22T12:00:00.123789Z'],
    })
    expect(body.pagination.snapshot_at).toBe('2026-07-22T12:00:00.123789Z')
    expect(body.assessments).toHaveLength(1)
  })

  test('fails closed when the database snapshot cannot be read', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { message: 'clock unavailable' } })

    const res = await GET(req('?limit=50'), { params: params() })

    expect(res.status).toBe(500)
    expect(queryCalls.assessments).toBeUndefined()
  })

  test('preserves PostgREST microseconds in the next-page assessment boundary', async () => {
    tableResult.assessments = {
      data: Array.from({ length: 51 }, (_, index) => ({
        id: assessmentId(index),
        assessed_at: index === 49
          ? '2026-07-22T11:00:00.123456+00:00'
          : new Date(Date.UTC(2026, 6, 22, 12, 0, 0) - index * 1000).toISOString(),
      })),
      error: null,
    }
    const body = await (await GET(req('?limit=50'), { params: params() })).json()
    expect(body.pagination.next_cursor).toEqual(expect.any(String))

    queryCalls.assessments = []
    tableResult.assessments = { data: [], error: null }
    const next = await GET(
      req(`?limit=50&cursor=${encodeURIComponent(body.pagination.next_cursor)}`),
      { params: params() },
    )

    expect(next.status).toBe(200)
    expect(queryCalls.assessments).toContainEqual({
      method: 'or',
      args: [
        `assessed_at.lt.2026-07-22T11:00:00.123456Z,and(assessed_at.eq.2026-07-22T11:00:00.123456Z,id.lt.${assessmentId(49)})`,
      ],
    })
  })

  test('keeps snapshot/filter bindings across assessment pages', async () => {
    tableResult.assessments = {
      data: Array.from({ length: 11 }, (_, index) => ({
        id: assessmentId(index),
        assessed_at: new Date(Date.UTC(2026, 6, 22, 12, 0, 0) - index * 1000).toISOString(),
      })),
      error: null,
    }
    const first = await (await GET(req('?limit=10&approved_only=true'), { params: params() })).json()

    queryCalls.assessments = []
    tableResult.assessments = { data: [], error: null }
    const second = await GET(
      req(`?limit=10&approved_only=true&cursor=${encodeURIComponent(first.pagination.next_cursor)}`),
      { params: params() },
    )
    expect(second.status).toBe(200)
    expect(queryCalls.assessments).toContainEqual({ method: 'lte', args: ['assessed_at', first.pagination.snapshot_at] })
    expect(String(queryCalls.assessments.find((call) => call.method === 'or')?.args[0])).toContain('id.lt.')

    const changedFilter = await GET(
      req(`?limit=10&cursor=${encodeURIComponent(first.pagination.next_cursor)}`),
      { params: params() },
    )
    expect(changedFilter.status).toBe(400)
  })

  test('queries strictly before the current assessment timestamp for prior-report choices', async () => {
    const beforeAt = '2026-07-20T12:00:00.000Z'
    const res = await GET(req(`?limit=20&approved_only=true&before_at=${encodeURIComponent(beforeAt)}`), { params: params() })
    expect(res.status).toBe(200)
    expect(queryCalls.assessments).toContainEqual({ method: 'lt', args: ['assessed_at', beforeAt] })
  })

  test.each([
    '?limit=51',
    '?limit=0',
    '?cursor=garbage',
    '?limit=10&limit=20',
    '?before_at=not-a-date',
    '?before_at=2026-07-20T12%3A00%3A00.000Z&before_at=2026-07-19T12%3A00%3A00.000Z',
  ])('rejects invalid pagination: %s', async (search) => {
    const res = await GET(req(search), { params: params() })
    expect(res.status).toBe(400)
    expect(queryCalls.assessments).toBeUndefined()
  })

  test('rejects a cursor with a non-UUID id before querying assessment history', async () => {
    const cursor = encodeKeysetCursor({
      scope: 'client-assessments',
      filterKey: 'client=c1&exclude=&findings=false&approved=false&before=',
      snapshotAt: '2026-07-22T12:00:00.000Z',
      after: { at: '2026-07-22T11:00:00.000Z', id: 'x),status.eq.complete' },
    })
    const res = await GET(req(`?limit=10&cursor=${encodeURIComponent(cursor)}`), { params: params() })
    expect(res.status).toBe(400)
    expect(queryCalls.assessments).toBeUndefined()
  })
})

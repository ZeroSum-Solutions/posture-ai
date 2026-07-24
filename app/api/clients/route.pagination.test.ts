import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

let queryResult: { data: unknown; error: unknown } = { data: [], error: null }
let legacyQueryResult: { data: unknown; error: unknown } = { data: [], error: null }
const fromSpy = vi.fn()
const rpcSpy = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: fromSpy,
    rpc: rpcSpy,
  }),
  createSupabaseServiceClient: () => ({ from: vi.fn() }),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => true }))

import { GET } from './route'
import { encodeKeysetCursor } from '@/lib/pagination/keyset'

function request(search = '') {
  return new NextRequest(`http://localhost/api/clients${search}`)
}

async function get(search = '') {
  return (GET as unknown as (req: NextRequest) => Promise<Response>)(request(search))
}

function client(index: number, createdAt = new Date(Date.UTC(2026, 6, 22, 12, 0, 0) - index * 1_000).toISOString()) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    first_name: `Client${index}`,
    last_name: 'Example',
    date_of_birth: null,
    created_at: createdAt,
  }
}

describe('GET /api/clients pagination', () => {
  beforeEach(() => {
    queryResult = { data: [], error: null }
    legacyQueryResult = { data: [], error: null }
    fromSpy.mockReset()
    rpcSpy.mockReset()
    rpcSpy.mockImplementation(async () => queryResult)
    const legacyQuery = {
      select: vi.fn(),
      is: vi.fn(),
      order: vi.fn(),
      then: (onFulfilled: (value: typeof legacyQueryResult) => unknown, onRejected: (reason: unknown) => unknown) => (
        Promise.resolve(legacyQueryResult).then(onFulfilled, onRejected)
      ),
    }
    legacyQuery.select.mockReturnValue(legacyQuery)
    legacyQuery.is.mockReturnValue(legacyQuery)
    legacyQuery.order.mockReturnValue(legacyQuery)
    fromSpy.mockReturnValue(legacyQuery)
  })

  it('keeps parameterless legacy requests complete with the prior response shape for one version', async () => {
    legacyQueryResult = {
      data: Array.from({ length: 75 }, (_, index) => ({
        ...client(index),
        sex_at_birth: 'other',
        height_cm: 170,
        weight_kg: 70,
        notes: `Legacy note ${index}`,
      })),
      error: null,
    }
    const response = await get()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.clients).toHaveLength(75)
    expect(body.pagination).toBeUndefined()
    expect(body.clients[0]).toMatchObject({ sex_at_birth: 'other', notes: 'Legacy note 0' })
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('returns at most 50 rows and an opaque continuation cursor', async () => {
    queryResult = { data: Array.from({ length: 51 }, (_, index) => client(index)), error: null }

    const response = await get('?limit=50')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(body.clients).toHaveLength(50)
    expect(body.count).toBe(50)
    expect(body.pagination).toMatchObject({
      limit: 50,
      returned: 50,
      has_more: true,
      next_cursor: expect.any(String),
    })
    expect(rpcSpy).toHaveBeenCalledWith('list_owned_clients_page', expect.objectContaining({
      p_search: '',
      p_after_at: null,
      p_after_id: null,
      p_limit: 51,
    }))
    expect(body.clients[0]).toEqual({
      id: expect.any(String),
      first_name: 'Client0',
      last_name: 'Example',
      date_of_birth: null,
      created_at: expect.any(String),
    })
  })

  it('preserves PostgREST microseconds in the next-page client boundary', async () => {
    queryResult = {
      data: Array.from({ length: 51 }, (_, index) => ({
        ...client(index),
        created_at: index === 49
          ? '2026-07-22T11:00:00.123456+00:00'
          : client(index).created_at,
      })),
      error: null,
    }
    const body = await (await get('?limit=50')).json()
    expect(body.pagination.next_cursor).toEqual(expect.any(String))

    rpcSpy.mockClear()
    queryResult = { data: [], error: null }
    const next = await get(`?limit=50&cursor=${encodeURIComponent(body.pagination.next_cursor)}`)

    expect(next.status).toBe(200)
    expect(rpcSpy).toHaveBeenCalledWith('list_owned_clients_page', expect.objectContaining({
      p_after_at: '2026-07-22T11:00:00.123456Z',
      p_after_id: client(49).id,
    }))
  })

  it('binds the cursor to its snapshot and uses a composite created_at/id boundary', async () => {
    queryResult = { data: Array.from({ length: 11 }, (_, index) => client(index)), error: null }
    const first = await (await get('?limit=10')).json()

    rpcSpy.mockClear()
    queryResult = { data: [client(10)], error: null }
    const secondResponse = await get(`?limit=10&cursor=${encodeURIComponent(first.pagination.next_cursor)}`)
    const second = await secondResponse.json()

    expect(secondResponse.status).toBe(200)
    expect(second.pagination.snapshot_at).toBe(first.pagination.snapshot_at)
    expect(rpcSpy).toHaveBeenCalledWith('list_owned_clients_page', {
      p_search: '',
      p_snapshot_at: first.pagination.snapshot_at,
      p_after_at: client(9).created_at,
      p_after_id: client(9).id,
      p_limit: 11,
    })
  })

  it.each([
    ['Alice Smith', 'Alice Smith'],
    ['Smith Alice', 'Smith Alice'],
    ['Mary Ann Smith', 'Mary Ann Smith'],
    ["D'Arcy-Jones", "D'Arcy-Jones"],
    ['St. John', 'St. John'],
    ['Élodie Brontë', 'Élodie Brontë'],
    ['Smith, John', 'Smith John'],
    ['Alice (Smith)', 'Alice Smith'],
    ['Alice%', 'Alice'],
  ])('passes a normalized legitimate name to bounded typed server search: %s', async (search, normalized) => {
    const response = await get(`?search=${encodeURIComponent(search)}&limit=20`)
    expect(response.status).toBe(200)
    expect(rpcSpy).toHaveBeenCalledWith('list_owned_clients_page', expect.objectContaining({
      p_search: normalized,
      p_limit: 21,
    }))
  })

  it.each([
    '?limit=51',
    '?limit=1.5',
    '?cursor=garbage',
    '?search=' + 'a'.repeat(101),
    '?search=Alice%5BSmith%5D',
    '?search=Alice&search=Smith',
  ])('rejects invalid pagination/search before querying clients: %s', async (search) => {
    const response = await get(search)
    expect(response.status).toBe(400)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('rejects a cursor with an injected non-UUID id before querying', async () => {
    const cursor = encodeKeysetCursor({
      scope: 'clients',
      filterKey: 'search=',
      snapshotAt: '2026-07-22T12:00:00.000Z',
      after: { at: '2026-07-22T11:00:00.000Z', id: 'x),archived_at.is.null' },
    })
    const response = await get(`?cursor=${encodeURIComponent(cursor)}`)
    expect(response.status).toBe(400)
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('surfaces query failures instead of returning an empty page', async () => {
    queryResult = { data: null, error: { message: 'connection reset' } }
    const response = await get('?limit=50')
    expect(response.status).toBe(500)
  })
})

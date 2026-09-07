import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'

type StoredRun = {
  id: string
  status: 'in_progress'
  current_item_index: number
  items: { slug: string; completed: boolean; skipped: boolean }[]
  total_duration_ms: number
  last_paused_at: null
  completed_at: null
  revision: number
  red_flag_acknowledged: boolean
}

type Deferred = {
  promise: Promise<void>
  resolve: () => void
}

function deferred(): Deferred {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const state = vi.hoisted(() => ({
  row: null as StoredRun | null,
  firstRead: null as Deferred | null,
  releaseRevisionTwo: null as Deferred | null,
  readCount: 0,
}))

function selectRunQuery() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      const snapshot = state.row ? structuredClone(state.row) : null
      state.readCount += 1
      if (state.readCount === 1) state.firstRead?.resolve()
      return { data: snapshot, error: null }
    },
  }
  return chain
}

function updateRunQuery(update: Partial<StoredRun>) {
  const filters = new Map<string, unknown>()
  let result: Promise<{ data: StoredRun | null; error: null }> | null = null

  const execute = () => {
    result ??= (async () => {
      if (update.revision === 2) await state.releaseRevisionTwo?.promise
      const expectedRevision = filters.get('revision')
      if (expectedRevision !== undefined && state.row?.revision !== expectedRevision) {
        return { data: null, error: null }
      }
      if (!state.row) return { data: null, error: null }
      state.row = { ...state.row, ...update }
      return { data: structuredClone(state.row), error: null }
    })()
    return result
  }

  const chain = {
    eq: (column: string, value: unknown) => {
      filters.set(column, value)
      return chain
    },
    select: () => chain,
    maybeSingle: execute,
    then: <TResult1 = { data: StoredRun | null; error: null }, TResult2 = never>(
      onfulfilled?: ((value: { data: StoredRun | null; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => execute().then(onfulfilled, onrejected),
  }
  return chain
}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: '10000000-0000-4000-8000-000000000001' } } }) },
  }),
  createSupabaseServiceClient: () => ({
    from: () => ({
      select: () => selectRunQuery(),
      update: (update: Partial<StoredRun>) => updateRunQuery(update),
    }),
  }),
}))
vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerGate: async () => null }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => true }))
vi.mock('@/lib/log', () => ({ hashUser: () => 'user-hash', logEvent: vi.fn() }))
vi.mock('@/lib/clinical-content/database', () => ({
  serverClinicalContentAccessForPractitioner: async () => ({ surfaces: { workouts: true } }),
}))
vi.mock('@/lib/clinical-content/http', () => ({ clinicalContentUnavailableResponse: vi.fn() }))

import { PATCH } from './route'

const sessionId = '30000000-0000-4000-8000-000000000001'

function request(revision: number, currentItemIndex: number) {
  return new NextRequest(`http://localhost/api/workouts/${sessionId}/run`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      status: 'in_progress',
      current_item_index: currentItemIndex,
      items: [{ slug: 'wall-slide', completed: currentItemIndex > 0, skipped: false }],
      total_duration_ms: currentItemIndex * 1_000,
      revision,
      red_flag_acknowledged: true,
    }),
  })
}

describe('PATCH /api/workouts/[id]/run', () => {
  beforeEach(() => {
    state.row = {
      id: '40000000-0000-4000-8000-000000000001',
      status: 'in_progress',
      current_item_index: 0,
      items: [{ slug: 'wall-slide', completed: false, skipped: false }],
      total_duration_ms: 0,
      last_paused_at: null,
      completed_at: null,
      revision: 1,
      red_flag_acknowledged: true,
    }
    state.firstRead = deferred()
    state.releaseRevisionTwo = deferred()
    state.readCount = 0
  })

  test('an older concurrent patch cannot overwrite a newer revision', async () => {
    const older = PATCH(request(2, 1), { params: Promise.resolve({ id: sessionId }) })
    await state.firstRead!.promise

    const newer = await PATCH(request(3, 2), { params: Promise.resolve({ id: sessionId }) })
    state.releaseRevisionTwo!.resolve()
    const olderResponse = await older

    expect(newer.status).toBe(200)
    expect(olderResponse.status).toBe(409)
    await expect(olderResponse.json()).resolves.toMatchObject({ current_revision: 3 })
    expect(state.row).toMatchObject({ revision: 3, current_item_index: 2 })
  })
})

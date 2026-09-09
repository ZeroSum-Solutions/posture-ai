import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  context: vi.fn(), create: vi.fn(), list: vi.fn(), read: vi.fn(), update: vi.fn(), archive: vi.fn(),
}))
vi.mock('@/lib/training/persistence/request-context', () => ({ trainingRequestContext: mocks.context }))
vi.mock('@/lib/training/persistence/manual-reference-routine', async (original) => ({
  ...await original<typeof import('@/lib/training/persistence/manual-reference-routine')>(),
  createManualReferenceRoutine: mocks.create,
  listManualReferenceRoutines: mocks.list,
  readManualReferenceRoutine: mocks.read,
  updateManualReferenceRoutine: mocks.update,
  archiveManualReferenceRoutine: mocks.archive,
}))

import { ManualReferenceRoutineError } from '@/lib/training/persistence/manual-reference-routine'
import { GET as list, POST as create } from './route'
import { DELETE as archive, GET as read, PATCH as update } from './[routineId]/route'

const subjectId = '54000000-0000-4000-8000-000000000003'
const routineId = '54000000-0000-4000-8000-000000000004'
const requestId = '54000000-0000-4000-8000-000000000006'
const item = {
  itemId: '54000000-0000-4000-8000-000000000001',
  referenceExerciseId: 'wger:d561c00c-436d-47d9-b647-222e7b637abd',
  kind: 'strength', sets: 3, reps: 8, load: { value: '12.5', unit: 'kg' },
}
const request = (url: string, method = 'GET', body?: unknown) => new Request(url, {
  method, body: body === undefined ? undefined : JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue({ ok: true, supabase: { authenticated: true }, actor: { ok: true } })
})

describe('manual reference routine routes', () => {
  it('creates a server-pinned routine and lists an exact subject', async () => {
    const projection = { schemaVersion: 'manual-reference-routine-projection.v1', routine: { routineId } }
    mocks.create.mockResolvedValue(projection)
    const created = await create(request('http://localhost/api/training/manual-routines', 'POST', {
      requestId, subjectId, title: 'Tuesday', items: [item],
    }))
    expect(created.status).toBe(201)
    expect(await created.json()).toEqual(projection)

    const listed = {
      schemaVersion: 'manual-reference-routine-list.v1', subjectId, routines: [], hasMore: false, nextCursor: null,
    }
    mocks.list.mockResolvedValue(listed)
    expect(await (await list(request(`http://localhost/api/training/manual-routines?subjectId=${subjectId}`))).json()).toEqual(listed)
    expect(mocks.list).toHaveBeenCalledWith({ authenticated: true }, subjectId, { limit: 100, cursor: null })
  })

  it('rejects browser provenance and ambiguous list selectors', async () => {
    expect((await create(request('http://localhost/api/training/manual-routines', 'POST', {
      requestId, subjectId, title: 'Forged', items: [{ ...item, provenance: { recordSha256: 'a'.repeat(64) } }],
    }))).status).toBe(422)
    expect((await list(request(`http://localhost/api/training/manual-routines?subjectId=${subjectId}&subjectId=${subjectId}`))).status).toBe(400)
    expect((await list(request(`http://localhost/api/training/manual-routines?subjectId=${subjectId}&limit=101`))).status).toBe(400)
    expect((await list(request(`http://localhost/api/training/manual-routines?subjectId=${subjectId}&other=true`))).status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('passes an opaque bounded page cursor to persistence', async () => {
    const cursor = Buffer.from(JSON.stringify({
      updatedAt: '2026-09-08T12:00:00.000Z', routineId,
    }), 'utf8').toString('base64url')
    mocks.list.mockResolvedValue({
      schemaVersion: 'manual-reference-routine-list.v1', subjectId, routines: [], hasMore: false, nextCursor: null,
    })
    const response = await list(request(
      `http://localhost/api/training/manual-routines?subjectId=${subjectId}&limit=25&cursor=${cursor}`,
    ))
    expect(response.status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith(
      { authenticated: true }, subjectId, { limit: 25, cursor },
    )
  })

  it('maps a structurally invalid opaque cursor to a query error', async () => {
    mocks.list.mockRejectedValue(new ManualReferenceRoutineError('manual_routine_invalid_cursor'))
    const response = await list(request(
      `http://localhost/api/training/manual-routines?subjectId=${subjectId}&cursor=e30`,
    ))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_training_query' })
  })

  it('accepts a bounded routine body larger than the session-mutation limit', async () => {
    const items = Array.from({ length: 80 }, (_, index) => ({
      itemId: `54000000-0000-4000-8000-${String(index + 1000).padStart(12, '0')}`,
      referenceExerciseId: `wger:55000000-0000-4000-8000-${String(index + 1000).padStart(12, '0')}`,
      kind: 'conditioning', durationSeconds: 60,
    }))
    const payload = { requestId, subjectId, title: 'Large routine', items }
    expect(JSON.stringify(payload).length).toBeGreaterThan(8_192)
    mocks.create.mockResolvedValue({ schemaVersion: 'manual-reference-routine-projection.v1', routine: { routineId } })
    expect((await create(request('http://localhost', 'POST', payload))).status).toBe(201)
  })

  it('rejects an oversized actual body even when content length is absent', async () => {
    const response = await create(new Request('http://localhost', {
      method: 'POST', body: JSON.stringify({ oversized: 'x'.repeat(132_000) }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(response.status).toBe(413)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('reads, updates, and archives one bounded routine ID', async () => {
    mocks.read.mockResolvedValue({ schemaVersion: 'manual-reference-routine-projection.v1', routine: { routineId } })
    expect((await read(request('http://localhost'), { params: Promise.resolve({ routineId }) })).status).toBe(200)
    mocks.update.mockResolvedValue({ schemaVersion: 'manual-reference-routine-projection.v1', routine: { routineId, revision: 2 } })
    expect((await update(request('http://localhost', 'PATCH', { expectedRevision: 1, title: 'Edited', items: [item] }), {
      params: Promise.resolve({ routineId }),
    })).status).toBe(200)
    mocks.archive.mockResolvedValue({ schemaVersion: 'manual-reference-routine-archive.v1', routineId, revision: 3, status: 'archived' })
    expect((await archive(request('http://localhost', 'DELETE', { expectedRevision: 2 }), {
      params: Promise.resolve({ routineId }),
    })).status).toBe(200)
  })

  it('returns the current routine on an optimistic conflict', async () => {
    mocks.update.mockRejectedValue(new ManualReferenceRoutineError('manual_routine_conflict', { routineId, revision: 2 } as never))
    const response = await update(request('http://localhost', 'PATCH', {
      expectedRevision: 1, title: 'Edited', items: [item],
    }), { params: Promise.resolve({ routineId }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'manual_routine_conflict', current: { routineId, revision: 2 } })
  })

  it('maps a changed-payload create retry to a stable conflict', async () => {
    mocks.create.mockRejectedValue(new ManualReferenceRoutineError('manual_routine_request_conflict'))
    const response = await create(request('http://localhost', 'POST', {
      requestId, subjectId, title: 'Changed', items: [item],
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'manual_routine_request_conflict' })
  })

  it('stops before persistence when actor resolution fails', async () => {
    mocks.context.mockResolvedValue({ ok: false, response: new NextResponse(null, { status: 403 }) })
    expect((await create(request('http://localhost', 'POST', { requestId, subjectId, title: 'Tuesday', items: [item] }))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

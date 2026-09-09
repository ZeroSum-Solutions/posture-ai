import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  context: vi.fn(), service: vi.fn(), readDependencies: vi.fn(), dependencies: vi.fn(),
  read: vi.fn(), create: vi.fn(), accept: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceClient: mocks.service }))
vi.mock('@/lib/training/persistence/request-context', () => ({ trainingRequestContext: mocks.context }))
vi.mock('@/lib/training/persistence/conditioning-revisions', async (original) => {
  const actual = await original<typeof import('@/lib/training/persistence/conditioning-revisions')>()
  return {
    ...actual,
    createSupabaseConditioningRevisionReadDependencies: mocks.readDependencies,
    createSupabaseConditioningRevisionDependencies: mocks.dependencies,
    readConditioningRevisionOptions: mocks.read,
    createStoredConditioningRevisionProposal: mocks.create,
    acceptStoredConditioningRevisionProposal: mocks.accept,
  }
})

import { ConditioningRevisionError } from '@/lib/training/persistence/conditioning-revisions'
import { GET as options } from './route'
import { POST as create } from './proposals/route'
import { POST as accept } from './proposals/[proposalId]/accept/route'

const actor = { ok: true, actorKind: 'athlete', userId: '11111111-1111-4111-8111-111111111111', subjectId: '22222222-2222-4222-8222-222222222222' } as const
const proposalId = '33333333-3333-4333-8333-333333333333'
const requestId = '44444444-4444-4444-8444-444444444444'
const selection = {
  replacementModalityId: 'synthetic-walk.v1',
  futureBouts: [{
    sourceBoutId: 'bout-1', scheduledLocalDate: '2026-09-10',
    acceptedDurationSeconds: 600, arrangement: 'separate',
  }],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue({ ok: true, actor, supabase: { authenticated: true } })
  mocks.service.mockReturnValue({ service: true })
  mocks.readDependencies.mockReturnValue({ readDependencies: true })
  mocks.dependencies.mockReturnValue({ dependencies: true })
})

describe('conditioning revision routes', () => {
  it('reads options by one bounded assignment identity', async () => {
    const projection = { schemaVersion: 'conditioning-revision-options.v1', result: { kind: 'unavailable', reason: 'no_changeable_bouts' } }
    mocks.read.mockResolvedValue(projection)
    const response = await options(new Request('http://localhost/api/training/conditioning/revisions?assignmentId=assignment-1'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(projection)
    expect(mocks.read).toHaveBeenCalledWith('assignment-1', actor, { readDependencies: true })
    expect((await options(new Request('http://localhost/api/training/conditioning/revisions?assignmentId=a&subjectId=b'))).status).toBe(400)
  })

  it('previews only a server-bound assignment and explicit selection', async () => {
    mocks.create.mockResolvedValue({ schemaVersion: 'conditioning-revision-projection.v1', proposalId: null, revision: { schemaVersion: 'conditioning-revision.v1', result: { kind: 'unavailable', reason: 'no_effective_change' } } })
    const response = await create(new Request('http://localhost/api/training/conditioning/revisions/proposals', {
      method: 'POST', body: JSON.stringify({ assignmentId: 'assignment-1', selection }),
    }))
    expect(response.status).toBe(200)
    expect(mocks.create).toHaveBeenCalledWith(
      { assignmentId: 'assignment-1', selection }, actor, { dependencies: true },
    )
    const forged = await create(new Request('http://localhost/api/training/conditioning/revisions/proposals', {
      method: 'POST', body: JSON.stringify({ assignmentId: 'assignment-1', selection, catalog: {} }),
    }))
    expect(forged.status).toBe(422)
  })

  it('accepts only a request ID and preserves retry versus stale outcomes', async () => {
    mocks.accept.mockResolvedValue({
      schemaVersion: 'conditioning-revision-acceptance.v1', proposalId,
      assignmentId: 'assignment-1', programRevisionNumber: 2,
      affectedBoutIds: ['bout-1'], evidenceBoundary: 'preserved',
    })
    const request = (body: unknown) => new Request('http://localhost/accept', { method: 'POST', body: JSON.stringify(body) })
    expect((await accept(request({ requestId }), { params: Promise.resolve({ proposalId }) })).status).toBe(200)
    expect((await accept(request({ requestId, result: {} }), { params: Promise.resolve({ proposalId }) })).status).toBe(422)

    mocks.accept.mockRejectedValueOnce(new ConditioningRevisionError('conditioning_revision_request_id_conflict'))
    const retry = await accept(request({ requestId }), { params: Promise.resolve({ proposalId }) })
    expect(retry.status).toBe(409)
    expect(await retry.json()).toEqual({ error: 'conditioning_revision_request_id_conflict', action: 'retry_with_new_request' })
    mocks.accept.mockRejectedValueOnce(new ConditioningRevisionError('conditioning_revision_source_stale'))
    const stale = await accept(request({ requestId }), { params: Promise.resolve({ proposalId }) })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({ error: 'conditioning_revision_source_stale', action: 'refresh_conditioning_revision' })
  })

  it('does not enter persistence when the actor gate fails', async () => {
    mocks.context.mockResolvedValue({ ok: false, response: new NextResponse(null, { status: 403 }) })
    expect((await options(new Request('http://localhost/api/training/conditioning/revisions?assignmentId=assignment-1'))).status).toBe(403)
    expect(mocks.read).not.toHaveBeenCalled()
  })
})

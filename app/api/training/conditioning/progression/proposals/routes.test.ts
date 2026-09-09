import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  context: vi.fn(), service: vi.fn(), dependencies: vi.fn(), create: vi.fn(), accept: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceClient: mocks.service }))
vi.mock('@/lib/training/persistence/request-context', () => ({ trainingRequestContext: mocks.context }))
vi.mock('@/lib/training/persistence/conditioning-progression', async (original) => {
  const actual = await original<typeof import('@/lib/training/persistence/conditioning-progression')>()
  return {
    ...actual,
    createSupabaseConditioningProgressionDependencies: mocks.dependencies,
    createStoredConditioningProgressionProposal: mocks.create,
    acceptStoredConditioningProgressionProposal: mocks.accept,
  }
})

import { ConditioningProgressionError } from '@/lib/training/persistence/conditioning-progression'
import { POST as create } from './route'
import { POST as accept } from './[proposalId]/accept/route'

const actor = {
  ok: true, actorKind: 'athlete', userId: '11111111-1111-4111-8111-111111111111',
  subjectId: '22222222-2222-4222-8222-222222222222',
} as const
const proposalId = '33333333-3333-4333-8333-333333333333'
const requestId = '44444444-4444-4444-8444-444444444444'
const request = (body: unknown) => new Request('http://localhost/api/training/conditioning/progression/proposals', {
  method: 'POST', body: JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue({ ok: true, actor, supabase: { authenticated: true } })
  mocks.service.mockReturnValue({ service: true })
  mocks.dependencies.mockReturnValue({ dependencies: true })
})

describe('conditioning progression proposal routes', () => {
  it('accepts only the completed conditioning session identity for proposal creation', async () => {
    const normalHold = {
      schemaVersion: 'conditioning-progression-projection.v1',
      result: { kind: 'insufficient_history', proposalId: null },
    }
    mocks.create.mockResolvedValue(normalHold)
    const normalResponse = await create(request({ sessionId: 'conditioning-bout-2' }))
    expect(normalResponse.status).toBe(200)
    expect(await normalResponse.json()).toEqual(normalHold)
    expect(mocks.create).toHaveBeenCalledWith(
      { sessionId: 'conditioning-bout-2' }, actor, { dependencies: true },
    )
    for (const extra of [{ effortTarget: 4 }, { targetBoutIds: ['future-1'] }, { actorUserId: actor.userId }]) {
      expect((await create(request({ sessionId: 'conditioning-bout-2', ...extra }))).status).toBe(422)
    }
  })

  it('accepts only a request ID and maps a stale source to an explicit refresh conflict', async () => {
    mocks.accept.mockRejectedValueOnce(new ConditioningProgressionError('conditioning_progression_source_stale'))
    const response = await accept(request({ requestId }), { params: Promise.resolve({ proposalId }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'conditioning_progression_source_stale', action: 'refresh_conditioning_progression',
    })
    expect(mocks.accept).toHaveBeenCalledWith(proposalId, { requestId }, { dependencies: true })
    expect((await accept(request({ requestId, expectedRevision: 2 }), {
      params: Promise.resolve({ proposalId }),
    })).status).toBe(422)
  })

  it('does not call persistence when the current AAL2 actor gate fails', async () => {
    mocks.context.mockResolvedValue({ ok: false, response: new NextResponse(null, { status: 403 }) })
    expect((await create(request({ sessionId: 'conditioning-bout-2' }))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('keeps missing trusted numeric policy distinct from invalid client input', async () => {
    mocks.create.mockRejectedValueOnce(
      new ConditioningProgressionError('conditioning_progression_policy_unavailable'),
    )
    const response = await create(request({ sessionId: 'conditioning-bout-2' }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'conditioning_progression_policy_unavailable' })
  })
})

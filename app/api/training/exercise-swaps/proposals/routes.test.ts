import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  context: vi.fn(), service: vi.fn(), dependencies: vi.fn(), create: vi.fn(), accept: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceClient: mocks.service }))
vi.mock('@/lib/training/persistence/request-context', () => ({ trainingRequestContext: mocks.context }))
vi.mock('@/lib/training/persistence/exercise-swaps', async (original) => {
  const actual = await original<typeof import('@/lib/training/persistence/exercise-swaps')>()
  return {
    ...actual,
    createSupabaseExerciseSwapDependencies: mocks.dependencies,
    createStoredExerciseSwapProposals: mocks.create,
    acceptStoredExerciseSwapProposal: mocks.accept,
  }
})

import { ExerciseSwapError } from '@/lib/training/persistence/exercise-swaps'
import { POST as create } from './route'
import { POST as accept } from './[proposalId]/accept/route'

const actor = { ok: true, actorKind: 'athlete', userId: '11111111-1111-4111-8111-111111111111', subjectId: '22222222-2222-4222-8222-222222222222' } as const
const proposalId = '33333333-3333-4333-8333-333333333333'
const requestId = '44444444-4444-4444-8444-444444444444'
const request = (body: unknown) => new Request('http://localhost/api/training/exercise-swaps/proposals', {
  method: 'POST', body: JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue({ ok: true, actor, supabase: { authenticated: true } })
  mocks.service.mockReturnValue({ service: true })
  mocks.dependencies.mockReturnValue({ dependencies: true })
})

describe('exercise swap routes', () => {
  it('accepts only the server lookup identities needed to create proposals', async () => {
    mocks.create.mockResolvedValue({ schemaVersion: 'training-exercise-swap-projection.v1', result: { kind: 'no_future_target', proposals: [] } })
    expect((await create(request({ sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }))).status).toBe(200)
    expect(mocks.create).toHaveBeenCalledWith(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }, actor, { dependencies: true },
    )
    for (const extra of [{ targetExerciseVersionId: 'arbitrary.v1' }, { actorUserId: actor.userId }]) {
      expect((await create(request({ sessionId: 'session-2', exerciseInstanceId: 'exercise-2', ...extra }))).status).toBe(422)
    }
  })

  it('accepts only a proposal-bound load option index and request ID', async () => {
    mocks.accept.mockResolvedValue({ proposalId })
    expect((await accept(request({ requestId, selectedLoadOptionIndex: 0 }), {
      params: Promise.resolve({ proposalId }),
    })).status).toBe(200)
    expect(mocks.accept).toHaveBeenCalledWith(
      proposalId, { requestId, selectedLoadOptionIndex: 0 }, { dependencies: true },
    )
    expect((await accept(request({ requestId, selectedLoadOptionIndex: 0, quantity: { value: '20', unit: 'kg' } }), {
      params: Promise.resolve({ proposalId }),
    })).status).toBe(422)
  })

  it('maps stale proposals to an explicit refresh conflict and preserves the actor gate', async () => {
    mocks.accept.mockRejectedValueOnce(new ExerciseSwapError('exercise_swap_source_stale'))
    const stale = await accept(request({ requestId, selectedLoadOptionIndex: 0 }), {
      params: Promise.resolve({ proposalId }),
    })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({ error: 'exercise_swap_source_stale', action: 'refresh_exercise_swaps' })

    mocks.context.mockResolvedValue({ ok: false, response: new NextResponse(null, { status: 403 }) })
    expect((await create(request({ sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }))).status).toBe(403)
    expect(mocks.create).toHaveBeenCalledTimes(0)
  })

  it.each([
    ['exercise_swap_request_id_conflict', 409, { error: 'exercise_swap_request_id_conflict', action: 'retry_with_new_request' }],
    ['exercise_swap_selection_invalid', 422, { error: 'exercise_swap_selection_invalid', action: 'choose_starting_target' }],
    ['exercise_swap_forbidden', 403, { error: 'exercise_swap_forbidden' }],
    ['exercise_swap_unavailable', 503, { error: 'exercise_swap_unavailable' }],
  ] as const)('preserves the %s acceptance outcome', async (code, status, body) => {
    mocks.accept.mockRejectedValueOnce(new ExerciseSwapError(code))
    const response = await accept(request({ requestId, selectedLoadOptionIndex: 0 }), {
      params: Promise.resolve({ proposalId }),
    })
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual(body)
  })
})

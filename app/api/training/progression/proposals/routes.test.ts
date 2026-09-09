import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  context: vi.fn(), service: vi.fn(), dependencies: vi.fn(), create: vi.fn(), accept: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceClient: mocks.service }))
vi.mock('@/lib/training/persistence/request-context', () => ({ trainingRequestContext: mocks.context }))
vi.mock('@/lib/training/persistence/progression-proposals', async (original) => {
  const actual = await original<typeof import('@/lib/training/persistence/progression-proposals')>()
  return {
    ...actual,
    createSupabaseProgressionProposalDependencies: mocks.dependencies,
    createStoredProgressionProposal: mocks.create,
    acceptStoredProgressionProposal: mocks.accept,
  }
})

import { ProgressionProposalError } from '@/lib/training/persistence/progression-proposals'
import { POST as create } from './route'
import { POST as accept } from './[proposalId]/accept/route'

const actor = {
  ok: true, actorKind: 'athlete', userId: '11111111-1111-4111-8111-111111111111',
  subjectId: '22222222-2222-4222-8222-222222222222',
} as const
const proposalId = '33333333-3333-4333-8333-333333333333'
const requestId = '44444444-4444-4444-8444-444444444444'
const request = (body: unknown) => new Request('http://localhost/api/training/progression/proposals', {
  method: 'POST', body: JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.context.mockResolvedValue({ ok: true, actor, supabase: { authenticated: true } })
  mocks.service.mockReturnValue({ service: true })
  mocks.dependencies.mockReturnValue({ dependencies: true })
})

describe('progression proposal routes', () => {
  it('accepts only server lookup identities for proposal creation', async () => {
    mocks.create.mockResolvedValue({ schemaVersion: 'training-progression-projection.v1', result: { kind: 'no_pending_target', proposalId: null, reason: 'no_pending_strength_target' } })
    const response = await create(request({ sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }))
    expect(response.status).toBe(200)
    expect(mocks.create).toHaveBeenCalledWith(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }, actor, { dependencies: true },
    )
    for (const extra of [{ evidence: [] }, { targetSessionId: 'session-3' }, { load: '100' }]) {
      expect((await create(request({ sessionId: 'session-2', exerciseInstanceId: 'exercise-2', ...extra }))).status)
        .toBe(422)
    }
  })

  it('accepts a bounded recovery submission and rejects client-owned authority or dose fields', async () => {
    const recoveryContext = {
      requestId: requestId,
      context: {
        report: {
          schemaVersion: 'recovery-context.v1', capturedAt: '2026-09-09T18:00:00.000Z',
          sleep: 'unknown', fatigue: 'concern_reported', schedule: 'unknown', illness: 'unknown',
        },
        choice: 'hold',
      },
    }
    mocks.create.mockResolvedValue({
      schemaVersion: 'training-progression-projection.v1',
      result: { kind: 'recovery_review', proposalId: null },
    })
    const response = await create(request({
      sessionId: 'session-2', exerciseInstanceId: 'exercise-2', recoveryContext,
    }))
    expect(response.status).toBe(200)
    expect(mocks.create).toHaveBeenCalledWith(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2', recoveryContext },
      actor,
      { dependencies: true },
    )
    for (const invalid of [
      { ...recoveryContext, actorUserId: actor.userId },
      { ...recoveryContext, context: { ...recoveryContext.context, reductionPercent: 10 } },
    ]) {
      expect((await create(request({
        sessionId: 'session-2', exerciseInstanceId: 'exercise-2', recoveryContext: invalid,
      }))).status).toBe(422)
    }
  })

  it('accepts only a request ID and leaves actor/context authority to the authenticated RPC', async () => {
    mocks.accept.mockResolvedValue({
      schemaVersion: 'training-progression-acceptance.v1', proposalId,
      assignmentId: 'assignment-1', programRevisionNumber: 2,
      targetSessionId: 'session-3', targetExerciseInstanceId: 'exercise-3',
    })
    const response = await accept(request({ requestId }), { params: Promise.resolve({ proposalId }) })
    expect(response.status).toBe(200)
    expect(mocks.accept).toHaveBeenCalledWith(proposalId, { requestId }, { dependencies: true })
    expect((await accept(request({ requestId, actorUserId: actor.userId }), {
      params: Promise.resolve({ proposalId }),
    })).status).toBe(422)
  })

  it('maps stale evidence to refresh and a stale profile to rebuild', async () => {
    mocks.accept.mockRejectedValueOnce(new ProgressionProposalError('progression_source_stale'))
    const stale = await accept(request({ requestId }), { params: Promise.resolve({ proposalId }) })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({ error: 'progression_source_stale', action: 'refresh_progression' })

    mocks.create.mockRejectedValueOnce(new ProgressionProposalError('progression_profile_stale'))
    const profile = await create(request({ sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }))
    expect(profile.status).toBe(409)
    expect(await profile.json()).toEqual({ error: 'progression_profile_stale', action: 'rebuild_program' })

    mocks.create.mockRejectedValueOnce(new ProgressionProposalError('progression_recovery_context_conflict'))
    const recovery = await create(request({ sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }))
    expect(recovery.status).toBe(409)
    expect(await recovery.json()).toEqual({
      error: 'progression_recovery_context_conflict', action: 'refresh_progression',
    })
  })

  it('does not call proposal logic when the actor gate fails', async () => {
    mocks.context.mockResolvedValue({ ok: false, response: new NextResponse(null, { status: 403 }) })
    expect((await create(request({ sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

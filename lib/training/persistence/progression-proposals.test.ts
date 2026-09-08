import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLoadQuantity } from '../quantity'

const mocks = vi.hoisted(() => ({ build: vi.fn() }))
vi.mock('../progression/persistedProposal', async (original) => {
  const actual = await original<typeof import('../progression/persistedProposal')>()
  return { ...actual, buildPersistedProgressionProjection: mocks.build }
})

import {
  ProgressionProposalError,
  acceptStoredProgressionProposal,
  createStoredProgressionProposal,
  type ProgressionProposalDependencies,
  type StoredProgressionProposalV1,
} from './progression-proposals'

const actor = {
  ok: true, actorKind: 'athlete',
  userId: '11111111-1111-4111-8111-111111111111',
  subjectId: '22222222-2222-4222-8222-222222222222',
} as const
const proposalId = '33333333-3333-4333-8333-333333333333'
const requestId = '44444444-4444-4444-8444-444444444444'
const now = new Date('2026-09-08T18:00:00.000Z')

const decision = {
  kind: 'load_proposal' as const, status: 'proposed' as const,
  policyVersion: 'strength-progression-v1' as const, executionContext: { kind: 'live' as const },
  decisionKey: 'decision-1', subjectId: actor.subjectId,
  prescriptionId: 'session-3:exercise-3', exerciseVersionId: 'press.v1', equipmentId: 'machine-1',
  loadBasis: 'machine_stack' as const, programRevisionId: 'compiled-1', sourceProfileRevisionId: '1',
  sourceEligibilityRevisionId: 'eligibility-1', loadEpoch: 1, reasonCodes: ['two_ceiling_successes' as const],
  sourceExposureRevisionIds: ['evidence-1', 'evidence-2'], sourceAcknowledgementRevisionIds: [],
  proposal: {
    load: { equipmentId: 'machine-1', basis: 'machine_stack' as const, quantity: createLoadQuantity({ value: '52', unit: 'kg' }) },
    targetReps: [6, 6],
  },
}

function projection() {
  return {
    kind: 'proposal' as const, proposalKey: 'a'.repeat(64),
    target: {
      assignmentId: 'assignment-1', baseProgramRevisionNumber: 1,
      sessionId: 'session-3', exerciseInstanceId: 'exercise-3', scheduledLocalDate: '2026-09-10',
    },
    decision,
    sourceBindings: {
      subjectId: actor.subjectId, assignmentRevision: 1, programHash: 'b'.repeat(64), profileRevision: 1,
      eligibilitySourceRevisionId: 'eligibility-1', progressionSeriesId: 'strength-slot:push',
      executionContext: { kind: 'live' as const },
      sourceSessions: [{ sessionId: 'session-1', revision: 4 }, { sessionId: 'session-2', revision: 4 }],
      mutableTargets: [
        { sessionId: 'session-3', sessionRevision: 1, exerciseInstanceId: 'exercise-3', scheduledLocalDate: '2026-09-10' },
        { sessionId: 'session-4', sessionRevision: 1, exerciseInstanceId: 'exercise-4', scheduledLocalDate: '2026-09-13' },
      ],
    },
  }
}

function harness() {
  const inserted: StoredProgressionProposalV1[] = []
  const accepted: Array<{ proposalId: string; requestId: string }> = []
  const dependencies: ProgressionProposalDependencies = {
    now: () => now,
    newId: () => proposalId,
    loadCandidate: async () => ({ server: 'projection' }),
    insertProposal: async value => { inserted.push(value); return { id: value.id } },
    acceptProposal: async (acceptedProposalId, acceptedRequestId) => {
      accepted.push({ proposalId: acceptedProposalId, requestId: acceptedRequestId })
      return {
        schemaVersion: 'training-progression-acceptance.v1', proposalId: acceptedProposalId,
        assignmentId: 'assignment-1', programRevisionNumber: 2,
        targetSessionId: 'session-3', targetExerciseInstanceId: 'exercise-3',
      }
    },
  }
  return { dependencies, inserted, accepted }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.build.mockReturnValue(projection())
})

describe('stored progression proposals', () => {
  it('persists only the server-derived decision with complete source and future-target bindings', async () => {
    const state = harness()
    const result = await createStoredProgressionProposal(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }, actor, state.dependencies,
    )
    expect(result).toMatchObject({
      schemaVersion: 'training-progression-projection.v1',
      result: { kind: 'proposal', proposalId, target: { sessionId: 'session-3' } },
    })
    expect(state.inserted).toEqual([expect.objectContaining({
      id: proposalId, createdByUserId: actor.userId, subjectId: actor.subjectId,
      baseAssignmentRevision: 1, targetSessionRevision: 1,
      sourceSessionRevisions: [{ sessionId: 'session-1', revision: 4 }, { sessionId: 'session-2', revision: 4 }],
      mutableTargetRevisions: expect.arrayContaining([expect.objectContaining({ sessionId: 'session-4' })]),
      decision,
    })])
  })

  it('does not persist a hold and never allows an athlete projection for another subject', async () => {
    const state = harness()
    const proposed = projection()
    const { proposal: _ignored, ...auditDecision } = decision
    void _ignored
    mocks.build.mockReturnValueOnce({
      kind: 'not_proposed', target: proposed.target,
      decision: { ...auditDecision, kind: 'hold', status: 'not_proposed', reasonCodes: ['valid_state_hold'] },
    })
    const result = await createStoredProgressionProposal(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }, actor, state.dependencies,
    )
    expect(result.result).toMatchObject({ kind: 'not_proposed', proposalId: null })
    expect(state.inserted).toHaveLength(0)

    mocks.build.mockReturnValueOnce({
      ...proposed, sourceBindings: { ...proposed.sourceBindings, subjectId: '55555555-5555-4555-8555-555555555555' },
    })
    await expect(createStoredProgressionProposal(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }, actor, state.dependencies,
    )).rejects.toEqual(new ProgressionProposalError('progression_proposal_forbidden'))
  })

  it('accepts through the authenticated dependency using only proposal and request identity', async () => {
    const state = harness()
    await expect(acceptStoredProgressionProposal(proposalId, { requestId }, state.dependencies)).resolves.toEqual({
      schemaVersion: 'training-progression-acceptance.v1', proposalId,
      assignmentId: 'assignment-1', programRevisionNumber: 2,
      targetSessionId: 'session-3', targetExerciseInstanceId: 'exercise-3',
    })
    expect(state.accepted).toEqual([{ proposalId, requestId }])
    await expect(acceptStoredProgressionProposal(proposalId, { requestId, actorUserId: actor.userId }, state.dependencies))
      .rejects.toBeInstanceOf(Error)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLoadQuantity } from '../quantity'
import type { RecoveryContextRecordV1 } from '../contracts/recovery-context'

const mocks = vi.hoisted(() => ({ build: vi.fn() }))
vi.mock('../progression/persistedProposal', async (original) => {
  const actual = await original<typeof import('../progression/persistedProposal')>()
  return { ...actual, buildPersistedProgressionProjection: mocks.build }
})

import {
  ProgressionProposalError,
  acceptStoredProgressionProposal,
  createSupabaseProgressionProposalDependencies,
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
const recoveryRequestId = '55555555-5555-4555-8555-555555555555'

const recoveryReport = {
  schemaVersion: 'recovery-context.v1' as const,
  capturedAt: '2026-09-08T17:55:00.000Z',
  sleep: 'unknown' as const,
  fatigue: 'concern_reported' as const,
  schedule: 'no_concern_reported' as const,
  illness: 'unknown' as const,
}

function recoveryRecord(choice?: 'hold' | 'request_review' | 'new_familiarization'): RecoveryContextRecordV1 {
  return {
    schemaVersion: 'training-recovery-context-record.v1',
    recordId: recoveryRequestId,
    subjectId: actor.subjectId,
    assignmentId: 'assignment-1',
    sourceProgramRevisionNumber: 1,
    sourceProgramHash: 'b'.repeat(64),
    sourceSessionId: 'session-2',
    sourceSessionRevision: 4,
    exerciseInstanceId: 'exercise-2',
    progressionSeriesId: 'strength-slot:push',
    executionContext: { kind: 'live' },
    context: choice ? { report: recoveryReport, choice } : { report: recoveryReport },
    recordedAt: now.toISOString(),
  }
}

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

const dedicatedDecision = {
  schemaVersion: 'bodyweight-assistance-progression-decision.v1' as const,
  kind: 'rep_proposal' as const,
  status: 'proposed' as const,
  reason: 'one_rep_progression' as const,
  loadChange: 'none' as const,
  preservedLoad: {
    loadBasis: 'bodyweight_external' as const,
    equipmentId: 'bodyweight-station',
    externalLoad: createLoadQuantity({ value: '0', unit: 'kg' }),
  },
  targetReps: [8, 7],
  policyId: 'bodyweight-rep-only.v1',
  policyVersion: '1',
  sourceExposureRevisionId: 'session-evidence:bodyweight',
}

const candidateBinding = {
  assignment: { id: 'assignment-1', subjectId: actor.subjectId, activeRevision: 1 },
  programHash: 'b'.repeat(64), progressionSeriesId: 'strength-slot:push',
  executionContext: { kind: 'live' as const },
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

function harness(
  latestRecoveryContext: unknown | null = null,
  candidate: unknown = candidateBinding,
) {
  const inserted: StoredProgressionProposalV1[] = []
  const accepted: Array<{ proposalId: string; requestId: string }> = []
  const recorded: unknown[] = []
  const dependencies: ProgressionProposalDependencies = {
    now: () => now,
    newId: () => proposalId,
    loadCandidate: async () => candidate,
    loadRecoveryContext: async () => latestRecoveryContext,
    recordRecoveryContext: async value => {
      recorded.push(value)
      return recoveryRecord(value.context.choice)
    },
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
  return { dependencies, inserted, accepted, recorded }
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
      recoveryContextRecordId: null,
      sourceSessionRevisions: [{ sessionId: 'session-1', revision: 4 }, { sessionId: 'session-2', revision: 4 }],
      mutableTargetRevisions: expect.arrayContaining([expect.objectContaining({ sessionId: 'session-4' })]),
      decision,
    })])
  })

  it('persists a dedicated rep-only decision without converting it into generic load authority', async () => {
    const dedicatedProjection = { ...projection(), decision: dedicatedDecision }
    mocks.build.mockReturnValueOnce(dedicatedProjection)
    const state = harness()
    const result = await createStoredProgressionProposal(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }, actor, state.dependencies,
    )
    expect(result).toMatchObject({
      result: {
        kind: 'proposal', proposalId,
        decision: {
          schemaVersion: 'bodyweight-assistance-progression-decision.v1',
          loadChange: 'none', preservedLoad: { loadBasis: 'bodyweight_external' },
        },
      },
    })
    expect(state.inserted).toEqual([expect.objectContaining({ decision: dedicatedDecision })])
    expect(state.inserted[0].decision).not.toHaveProperty('proposal.load')
  })

  it('does not let an omitted payload bypass an applicable stored hold', async () => {
    const state = harness({
      ...recoveryRecord('hold'),
      sourceSessionId: 'session-1', exerciseInstanceId: 'exercise-1',
    })
    const result = await createStoredProgressionProposal(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }, actor, state.dependencies,
    )
    expect(result).toMatchObject({
      result: {
        kind: 'recovery_review', proposalId: null,
        requestBinding: { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' },
        record: { recordId: recoveryRequestId, context: { choice: 'hold' } },
        review: { kind: 'hold', reason: 'explicit_recovery_hold' },
      },
    })
    expect(mocks.build).toHaveBeenCalledOnce()
    expect(state.inserted).toHaveLength(0)
  })

  it('keeps a series hold applicable across an unrelated program revision', async () => {
    const state = harness({
      ...recoveryRecord('hold'),
      sourceSessionId: 'session-1', exerciseInstanceId: 'exercise-1',
    }, {
      ...candidateBinding,
      assignment: { ...candidateBinding.assignment, activeRevision: 2 },
      programHash: 'c'.repeat(64),
    })
    const result = await createStoredProgressionProposal(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }, actor, state.dependencies,
    )
    expect(result.result).toMatchObject({
      kind: 'recovery_review',
      requestBinding: { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' },
      record: {
        sourceProgramRevisionNumber: 1,
        sourceSessionId: 'session-1', exerciseInstanceId: 'exercise-1',
        progressionSeriesId: 'strength-slot:push',
      },
      review: { kind: 'hold' },
    })
  })

  it('persists an explicit review before performance and allows a newer no-choice report to resume', async () => {
    const held = harness()
    const heldResult = await createStoredProgressionProposal({
      sessionId: 'session-2', exerciseInstanceId: 'exercise-2',
      recoveryContext: {
        requestId: recoveryRequestId,
        context: { report: recoveryReport, choice: 'request_review' },
      },
    }, actor, held.dependencies)
    expect(heldResult.result).toMatchObject({
      kind: 'recovery_review', review: { kind: 'request_review' },
    })
    expect(held.recorded).toEqual([{
      sessionId: 'session-2', exerciseInstanceId: 'exercise-2',
      requestId: recoveryRequestId,
      context: { report: recoveryReport, choice: 'request_review' },
    }])
    expect(mocks.build).toHaveBeenCalledOnce()

    mocks.build.mockReturnValue(projection())
    const resumed = harness()
    const result = await createStoredProgressionProposal({
      sessionId: 'session-2', exerciseInstanceId: 'exercise-2',
      recoveryContext: {
        requestId: recoveryRequestId,
        context: { report: recoveryReport },
      },
    }, actor, resumed.dependencies)
    expect(result.result.kind).toBe('proposal')
    expect(resumed.inserted[0]).toMatchObject({ recoveryContextRecordId: recoveryRequestId })
    expect(resumed.inserted[0].proposalKey).not.toBe(projection().proposalKey)
  })

  it('keeps eligibility, symptom, and completeness decisions ahead of recovery', async () => {
    const state = harness(recoveryRecord('hold'))
    const proposed = projection()
    const { proposal: _ignored, ...auditDecision } = decision
    void _ignored
    mocks.build.mockReturnValueOnce({
      kind: 'not_proposed', target: proposed.target,
      decision: {
        ...auditDecision, kind: 'hold', status: 'not_proposed',
        reasonCodes: ['adverse_symptom_hold'],
      },
    })
    const result = await createStoredProgressionProposal(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }, actor, state.dependencies,
    )
    expect(result.result).toMatchObject({
      kind: 'not_proposed', decision: { reasonCodes: ['adverse_symptom_hold'] },
    })
    expect(state.inserted).toHaveLength(0)
  })

  it('returns pre-recovery decisions without reading or recording recovery', async () => {
    const proposed = projection()
    const { proposal: _ignored, ...auditDecision } = decision
    void _ignored
    mocks.build.mockReturnValue({
      kind: 'not_proposed', target: proposed.target,
      decision: {
        ...auditDecision, kind: 'hold', status: 'not_proposed',
        reasonCodes: ['adverse_symptom_hold'],
      },
    })
    for (const input of [
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' },
      {
        sessionId: 'session-2', exerciseInstanceId: 'exercise-2',
        recoveryContext: {
          requestId: recoveryRequestId,
          context: { report: recoveryReport, choice: 'hold' as const },
        },
      },
    ]) {
      const state = harness()
      const loadRecoveryContext = vi.fn().mockRejectedValue(new Error('must not read recovery'))
      const recordRecoveryContext = vi.fn().mockRejectedValue(new Error('must not record recovery'))
      const dependencies = { ...state.dependencies, loadRecoveryContext, recordRecoveryContext }
      await expect(createStoredProgressionProposal(input, actor, dependencies)).resolves.toMatchObject({
        result: { kind: 'not_proposed', decision: { reasonCodes: ['adverse_symptom_hold'] } },
      })
      expect(loadRecoveryContext).not.toHaveBeenCalled()
      expect(recordRecoveryContext).not.toHaveBeenCalled()
    }
  })

  it('keeps dedicated policy and adverse-state holds ahead of recovery', async () => {
    for (const reason of ['policy_unavailable_hold', 'adverse_symptom_review'] as const) {
      const state = harness(recoveryRecord('request_review'))
      mocks.build.mockReturnValueOnce({
        kind: 'not_proposed', target: projection().target,
        executionContext: { kind: 'live' },
        decision: {
          schemaVersion: 'bodyweight-assistance-progression-decision.v1',
          kind: reason === 'adverse_symptom_review' ? 'review' : 'hold',
          status: 'not_proposed', reason,
          policyId: 'bodyweight-rep-only.v1', policyVersion: '1',
          sourceExposureRevisionId: 'session-evidence:bodyweight',
        },
      })
      const result = await createStoredProgressionProposal(
        { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }, actor, state.dependencies,
      )
      expect(result.result).toMatchObject({ kind: 'not_proposed', decision: { reason } })
      expect(state.inserted).toHaveLength(0)
    }
  })

  it('lets an explicit recovery choice precede a performance-only hold', async () => {
    const state = harness(recoveryRecord('request_review'))
    const proposed = projection()
    const { proposal: _ignored, ...auditDecision } = decision
    void _ignored
    mocks.build.mockReturnValueOnce({
      kind: 'not_proposed', target: proposed.target,
      decision: {
        ...auditDecision, kind: 'hold', status: 'not_proposed',
        reasonCodes: ['difficult_exposure_hold'],
      },
    })
    const result = await createStoredProgressionProposal(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }, actor, state.dependencies,
    )
    expect(result.result).toMatchObject({
      kind: 'recovery_review', review: { kind: 'request_review' },
    })
  })

  it('rejects a forged recovery record binding', async () => {
    const state = harness({
      ...recoveryRecord(), subjectId: 'another-subject',
    })
    await expect(createStoredProgressionProposal(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }, actor, state.dependencies,
    )).rejects.toEqual(new ProgressionProposalError('progression_proposal_unavailable'))
  })

  it('authorizes the candidate subject before any returned projection and rejects mismatched result bindings', async () => {
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

    const foreignCandidate = harness(null, {
      ...candidateBinding,
      assignment: { ...candidateBinding.assignment, subjectId: '55555555-5555-4555-8555-555555555555' },
    })
    await expect(createStoredProgressionProposal(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }, actor, foreignCandidate.dependencies,
    )).rejects.toEqual(new ProgressionProposalError('progression_proposal_forbidden'))

    mocks.build.mockReturnValueOnce({
      ...proposed, sourceBindings: { ...proposed.sourceBindings, subjectId: '55555555-5555-4555-8555-555555555555' },
    })
    await expect(createStoredProgressionProposal(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }, actor, state.dependencies,
    )).rejects.toEqual(new ProgressionProposalError('progression_proposal_unavailable'))
  })

  it('reuses a proposal-key collision only when every immutable persisted binding matches', async () => {
    const captured = harness()
    await createStoredProgressionProposal(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }, actor, captured.dependencies,
    )
    const proposal = captured.inserted[0]
    const existingId = '66666666-6666-4666-8666-666666666666'
    const replayRow = {
      id: existingId,
      proposal_key: proposal.proposalKey,
      created_by_user_id: proposal.createdByUserId,
      subject_id: proposal.subjectId,
      assignment_id: proposal.assignmentId,
      base_program_revision_number: proposal.baseProgramRevisionNumber,
      base_assignment_revision: proposal.baseAssignmentRevision,
      target_session_id: proposal.targetSessionId,
      target_exercise_instance_id: proposal.targetExerciseInstanceId,
      target_session_revision: proposal.targetSessionRevision,
      recovery_context_record_id: proposal.recoveryContextRecordId,
      progression_series_id: proposal.progressionSeriesId,
      source_profile_revision: proposal.sourceProfileRevision,
      source_eligibility_revision_id: proposal.sourceEligibilityRevisionId,
      source_program_hash: proposal.programHash,
      execution_context: proposal.executionContext,
      source_session_revisions: proposal.sourceSessionRevisions,
      mutable_target_revisions: proposal.mutableTargetRevisions,
      decision_json: proposal.decision,
    }
    function dependenciesFor(existing: unknown) {
      const table = {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: null, error: { code: '23505' } })),
          })),
        })),
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({ data: existing, error: null })),
          })),
        })),
      }
      return createSupabaseProgressionProposalDependencies(
        { rpc: vi.fn() } as never,
        { from: vi.fn(() => table) } as never,
        () => now,
      )
    }
    await expect(dependenciesFor(replayRow).insertProposal(proposal)).resolves.toEqual({ id: existingId })
    await expect(dependenciesFor({ ...replayRow, subject_id: '77777777-7777-4777-8777-777777777777' })
      .insertProposal(proposal))
      .rejects.toEqual(new ProgressionProposalError('progression_proposal_conflict'))
    await expect(dependenciesFor({
      ...replayRow,
      decision_json: {
        ...decision,
        proposal: { ...decision.proposal, targetReps: [99] },
      },
    })
      .insertProposal(proposal))
      .rejects.toEqual(new ProgressionProposalError('progression_proposal_conflict'))
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

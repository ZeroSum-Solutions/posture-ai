import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLoadQuantity } from '../quantity'

const mocks = vi.hoisted(() => ({
  buildOffer: vi.fn(),
  buildProgression: vi.fn(),
  adaptEvidence: vi.fn(),
}))
vi.mock('../engine/manualRecalibration', async original => ({
  ...await original<typeof import('../engine/manualRecalibration')>(),
  buildManualRecalibrationOffer: mocks.buildOffer,
}))
vi.mock('../progression/persistedProposal', async original => ({
  ...await original<typeof import('../progression/persistedProposal')>(),
  buildPersistedProgressionProjection: mocks.buildProgression,
}))
vi.mock('../progression/sessionEvidence', async original => ({
  ...await original<typeof import('../progression/sessionEvidence')>(),
  adaptStrengthSessionEvidence: mocks.adaptEvidence,
}))

import {
  ManualRecalibrationError,
  acceptStoredManualRecalibrationProposal,
  createStoredManualRecalibrationProposal,
  createSupabaseManualRecalibrationDependencies,
  type ManualRecalibrationDependencies,
  type StoredManualRecalibrationProposalV1,
} from './manual-recalibrations'

const actor = {
  ok: true, actorKind: 'athlete',
  userId: '11111111-1111-4111-8111-111111111111',
  subjectId: '22222222-2222-4222-8222-222222222222',
} as const
const proposalId = '33333333-3333-4333-8333-333333333333'
const requestId = '55555555-5555-4555-8555-555555555555'
const now = new Date('2026-09-09T18:00:00.000Z')
const actualLoad = createLoadQuantity({ value: '10', unit: 'kg' })
const selectedQuantity = createLoadQuantity({ value: '15', unit: 'kg' })
const context = {
  kind: 'synthetic_simulation' as const,
  simulationRunId: '44444444-4444-4444-8444-444444444444',
  fixtureId: 'synthetic-active.v1', fixtureHash: 'a'.repeat(64), label: 'Practice data' as const,
}
const origin = {
  kind: 'synthetic_fixture' as const, source: 'server_fixture' as const,
  fixtureId: context.fixtureId, fixtureHash: context.fixtureHash, label: 'Synthetic catalog',
}
const target = {
  sessionId: 'session-2', sessionRevision: 1,
  exerciseInstanceId: 'exercise-2', scheduledLocalDate: '2026-09-11',
}
const acceptedInitialLoad = {
  status: 'accepted' as const, acceptanceId: 'acceptance-1',
  acceptedAt: '2026-09-01T18:00:00.000Z', acceptedByUserId: actor.userId,
  source: 'equipment_inventory' as const, executionContext: context,
  exerciseInstanceId: 'exercise-2', exerciseVersionId: 'press.v1', equipmentId: 'db-1',
  provenance: { profileRevisionId: '3', compiledProgramRevisionId: 'compiled-1', catalogVersion: context.fixtureId, catalogOrigin: origin },
  loadBasis: 'dumbbell_single_implement' as const,
  implementCount: 1 as const, holdingConfiguration: 'two_hands_single_implement' as const,
  quantity: actualLoad,
}
const program = {
  schemaVersion: 'training-program-revision.v1' as const,
  assignmentId: 'assignment-1', revisionNumber: 1, subjectId: actor.subjectId,
  programMode: 'self_directed' as const, owningPractitionerId: null,
  executionContext: context, cycleStartLocalDate: '2026-09-08', cycleLengthWeeks: 4 as const,
  profileRevisionId: '3', eligibilitySourceRevisionId: 'eligibility-3',
  compilerPolicyVersion: 'strength-cycle-compiler.v3', catalogVersion: context.fixtureId,
  catalogOrigin: origin, ruleVersion: 'rules-1', compiledProgramRevisionId: 'compiled-1',
  publishedAt: '2026-09-01T18:00:00.000Z', author: { kind: 'system' as const, userId: null },
  sessions: [{
    sessionId: 'session-2', scheduledLocalDate: '2026-09-11', athleteTimezone: 'America/Los_Angeles',
    exercises: [{
      exerciseInstanceId: 'exercise-2', exerciseVersionId: 'press.v1', setIds: ['set-1'],
      repRange: { minimum: 6, maximum: 10 }, targetRir: { minimum: 2, maximum: 3 }, restSeconds: 120,
      progression: {
        progressionSeriesId: 'series-push', side: 'bilateral' as const, rom: 'catalog_default' as const,
        tempo: 'self_selected_controlled' as const, exposureType: 'standard' as const, loadEpoch: 2,
      },
      acceptedInitialLoad,
    }],
  }],
  conditioningBouts: [{
    status: 'accepted' as const, acceptanceId: 'conditioning-1', acceptedAt: '2026-09-01T18:00:00.000Z',
    acceptedByUserId: actor.userId, executionContext: context, boutId: 'bout-1', modalityId: 'walk.v1',
    scheduledLocalDate: '2026-09-10', athleteTimezone: 'America/Los_Angeles', acceptedDurationSeconds: 600,
    effortCue: 'Synthetic easy walk.', source: {
      compiledProgramRevisionId: 'compiled-1', compilerPolicyVersion: 'strength-cycle-compiler.v3',
      catalogVersion: context.fixtureId, catalogOrigin: origin,
    },
  }],
}

function candidate() {
  return {
    assignment: {
      id: 'assignment-1', subjectId: actor.subjectId, programMode: 'self_directed',
      owningPractitionerId: null, simulationRunId: context.simulationRunId,
      activeRevision: 1, revision: 3,
    },
    program, programHash: 'b'.repeat(64), currentProfileRevision: 3, profileRevision: 3,
    profile: {}, eligibility: { sourceRevisionId: 'eligibility-3' },
    progressionSeriesId: 'series-push', executionContext: context,
    evidence: [{ session: {
      sessionId: 'session-1', revision: 4, state: 'completed',
      subjectId: actor.subjectId, assignmentId: 'assignment-1',
    } }], targets: [target],
    sourceSessionRevision: 4, sourceSessionState: 'completed',
  }
}

const sourceDecision = {
  decisionIdentity: 'decision-1', reason: 'effort_too_easy_recalibration' as const,
  sourceSessionId: 'session-1', sourceExerciseInstanceId: 'exercise-1', sourceSessionRevision: 4,
  sourceSessionState: 'completed' as const, sourceExposureRevisionIds: ['exposure-1'],
  lastComparableActualLoad: { equipmentId: 'db-1', basis: 'dumbbell_single_implement' as const, quantity: actualLoad },
}
const offer = {
  schemaVersion: 'manual-recalibration-offer.v1' as const, kind: 'options' as const,
  status: 'requires_explicit_selection' as const,
  sourceBindings: {
    subjectId: actor.subjectId, assignmentId: 'assignment-1', sourceProgramRevisionNumber: 1,
    sourceProgramHash: 'b'.repeat(64), sourceProfileRevisionId: '3', sourceEligibilityRevisionId: 'eligibility-3',
    executionContext: context, catalogVersion: context.fixtureId, catalogOrigin: origin,
    target: { sessionId: target.sessionId, exerciseInstanceId: target.exerciseInstanceId, sessionState: 'scheduled' as const, prescriptionState: 'unprescribed' as const },
    exerciseVersionId: 'press.v1', priorProgressionSeriesId: 'series-push', priorLoadEpoch: 2,
    sourceDecision,
  },
  currentLoad: { equipmentId: 'db-1', basis: 'dumbbell_single_implement' as const, quantity: actualLoad },
  seriesIntent: { kind: 'new_series_on_acceptance' as const, reason: 'explicit_too_easy_recalibration' as const, sourceProgressionSeriesId: 'series-push', sourceLoadEpoch: 2, nextLoadEpoch: 3 },
  options: [{
    optionIndex: 0, equipmentId: 'db-1', basis: 'dumbbell_single_implement' as const,
    quantity: selectedQuantity, harderDirection: 'higher_resistance_or_external_load' as const,
    confirmation: { explicitSelectionRequired: true as const, outlierDisposition: 'greater_than_20_percent_acknowledgement_required' as const },
  }],
}

function harness(rawCandidate: unknown = candidate()) {
  const inserted: StoredManualRecalibrationProposalV1[] = []
  const dependencies: ManualRecalibrationDependencies = {
    now: () => now, newId: () => proposalId, loadCandidate: async () => rawCandidate,
    insertProposal: async proposal => { inserted.push(proposal); return { id: proposal.id } },
    acceptProposal: async (id, _request, _option, acknowledged) => ({
      schemaVersion: 'manual-recalibration-acceptance.v1', proposalId: id,
      assignmentId: 'assignment-1', programRevisionNumber: 2, executionContext: context,
      selectedLoad: {
        equipmentId: offer.options[0].equipmentId,
        basis: offer.options[0].basis,
        quantity: offer.options[0].quantity,
      },
      sourceDecision, outlierAcknowledged: acknowledged,
      seriesIntent: offer.seriesIntent, newProgressionSeriesId: `manual-recalibration:${id}`,
      affectedTargets: [{ sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }],
    }),
  }
  return { dependencies, inserted }
}

beforeEach(() => {
  mocks.buildOffer.mockReset().mockReturnValue(offer)
  mocks.buildProgression.mockReset().mockReturnValue({
    kind: 'not_proposed', target: {}, executionContext: context,
    decision: { decisionKey: 'decision-1', reasonCodes: ['effort_too_easy_recalibration'], sourceExposureRevisionIds: ['exposure-1'] },
  })
  mocks.adaptEvidence.mockReset().mockReturnValue({
    kind: 'ready', exposure: {
      sourceRevisionId: 'exposure-1', sets: [{ kind: 'working', actualReps: 7, load: sourceDecision.lastComparableActualLoad }],
    },
  })
})

describe('stored manual recalibration', () => {
  it('persists only a server-derived too-easy offer and exact comparable actual', async () => {
    const state = harness()
    await expect(createStoredManualRecalibrationProposal({ sessionId: 'session-1', exerciseInstanceId: 'exercise-1' }, actor, state.dependencies))
      .resolves.toMatchObject({ proposalId, offer: { kind: 'options' } })
    expect(mocks.buildOffer).toHaveBeenCalledWith(expect.objectContaining({ sourceDecision }))
    expect(mocks.buildProgression).toHaveBeenCalledWith({
      assignment: candidate().assignment,
      program, programHash: 'b'.repeat(64), currentProfileRevision: 3, profileRevision: 3,
      profile: {}, eligibility: { sourceRevisionId: 'eligibility-3' },
      progressionSeriesId: 'series-push', evidence: candidate().evidence, targets: [target],
      executionContext: context,
    }, now, expect.any(Object))
    expect(state.inserted[0]).toMatchObject({
      sourceSessionId: 'session-1', sourceExerciseInstanceId: 'exercise-1',
      sourceSessionRevisions: [{ sessionId: 'session-1', revision: 4 }],
      offer: { sourceBindings: { sourceDecision } }, targetBindings: [target],
    })
  })

  it('rejects a non-too-easy decision and mismatched evidence load history', async () => {
    mocks.buildProgression.mockReturnValueOnce({
      kind: 'not_proposed', target: {}, executionContext: context,
      decision: { decisionKey: 'decision-2', reasonCodes: ['effort_unknown_hold'], sourceExposureRevisionIds: ['exposure-1'] },
    })
    await expect(createStoredManualRecalibrationProposal({ sessionId: 'session-1', exerciseInstanceId: 'exercise-1' }, actor, harness().dependencies))
      .rejects.toEqual(new ManualRecalibrationError('manual_recalibration_unavailable'))
    mocks.adaptEvidence.mockReturnValueOnce({
      kind: 'ready', exposure: { sourceRevisionId: 'exposure-1', sets: [
        { kind: 'working', actualReps: 7, load: sourceDecision.lastComparableActualLoad },
        { kind: 'working', actualReps: 7, load: { ...sourceDecision.lastComparableActualLoad, quantity: selectedQuantity } },
      ] },
    })
    await expect(createStoredManualRecalibrationProposal({ sessionId: 'session-1', exerciseInstanceId: 'exercise-1' }, actor, harness().dependencies))
      .rejects.toEqual(new ManualRecalibrationError('manual_recalibration_unavailable'))
  })

  it('preserves the latest exact entry when working loads are canonically equal', async () => {
    const lexicalActual = {
      ...sourceDecision.lastComparableActualLoad,
      quantity: createLoadQuantity({ value: '10.0', unit: 'kg' }),
    }
    mocks.adaptEvidence.mockReturnValueOnce({
      kind: 'ready', exposure: { sourceRevisionId: 'exposure-1', sets: [
        { kind: 'working', actualReps: 7, load: sourceDecision.lastComparableActualLoad },
        { kind: 'working', actualReps: 7, load: lexicalActual },
      ] },
    })
    await createStoredManualRecalibrationProposal(
      { sessionId: 'session-1', exerciseInstanceId: 'exercise-1' }, actor, harness().dependencies,
    )
    expect(mocks.buildOffer).toHaveBeenCalledWith(expect.objectContaining({
      sourceDecision: expect.objectContaining({ lastComparableActualLoad: lexicalActual }),
    }))
  })

  it('allows the athlete to request a coach-assigned offer but only its owning coach practitioner', async () => {
    const coachId = '66666666-6666-4666-8666-666666666666'
    const coachProgram = { ...program, programMode: 'coach_assigned' as const, owningPractitionerId: coachId }
    const coachCandidate = { ...candidate(), assignment: { ...candidate().assignment, programMode: 'coach_assigned', owningPractitionerId: coachId }, program: coachProgram }
    await expect(createStoredManualRecalibrationProposal({ sessionId: 'session-1', exerciseInstanceId: 'exercise-1' }, actor, harness(coachCandidate).dependencies))
      .resolves.toMatchObject({ proposalId })
    const coach = { ok: true as const, actorKind: 'practitioner' as const, userId: coachId, subjectId: null }
    await expect(createStoredManualRecalibrationProposal({ sessionId: 'session-1', exerciseInstanceId: 'exercise-1' }, coach, harness(coachCandidate).dependencies))
      .resolves.toMatchObject({ proposalId })
    await expect(createStoredManualRecalibrationProposal({ sessionId: 'session-1', exerciseInstanceId: 'exercise-1' }, { ...coach, userId: '77777777-7777-4777-8777-777777777777' }, harness(coachCandidate).dependencies))
      .rejects.toEqual(new ManualRecalibrationError('manual_recalibration_forbidden'))
  })

  it.each(['active', 'renewed', 'accepted'] as const)(
    'recovers the same exact proposal when its server lifetime resolves as %s', async status => {
      const state = harness()
      await createStoredManualRecalibrationProposal(
        { sessionId: 'session-1', exerciseInstanceId: 'exercise-1' }, actor, state.dependencies,
      )
      const proposal = state.inserted[0]
      const existingId = '88888888-8888-4888-8888-888888888888'
      const existing = {
        id: existingId, proposal_key: proposal.proposalKey,
        subject_id: proposal.subjectId, assignment_id: proposal.assignmentId,
        base_program_revision_number: proposal.baseProgramRevisionNumber,
        base_assignment_revision: proposal.baseAssignmentRevision,
        source_session_id: proposal.sourceSessionId,
        source_exercise_instance_id: proposal.sourceExerciseInstanceId,
        source_session_revision: proposal.sourceSessionRevision,
        source_session_revisions: proposal.sourceSessionRevisions,
        source_profile_revision: proposal.sourceProfileRevision,
        source_eligibility_revision_id: proposal.sourceEligibilityRevisionId,
        source_program_hash: proposal.sourceProgramHash,
        execution_context: proposal.executionContext,
        catalog_version: proposal.catalogVersion, catalog_origin: proposal.catalogOrigin,
        target_bindings: proposal.targetBindings, offer_json: proposal.offer,
        expires_at: '2026-09-09T18:30:00.000Z',
      }
      const service = {
        from: vi.fn(() => ({
          insert: vi.fn(() => ({ select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: null, error: { code: '23505' } })),
          })) })),
          select: vi.fn(() => ({ eq: vi.fn(() => ({
            single: vi.fn(async () => ({ data: existing, error: null })),
          })) })),
        })),
      }
      const rpc = vi.fn().mockResolvedValue({ data: {
        proposalId: existingId, status, expiresAt: '2026-09-09T19:30:00.000Z',
      }, error: null })
      const dependencies = createSupabaseManualRecalibrationDependencies(
        { rpc } as never, service as never,
      )
      await expect(dependencies.insertProposal({
        ...proposal, id: '99999999-9999-4999-8999-999999999999',
        createdAt: '2026-09-09T18:10:00.000Z', expiresAt: '2026-09-09T19:10:00.000Z',
      })).resolves.toEqual({ id: existingId })
      expect(rpc).toHaveBeenCalledWith('renew_training_manual_recalibration_proposal', {
        p_proposal_id: existingId,
      })
    },
  )

  it('validates the exact acceptance receipt including acknowledgement', async () => {
    const state = harness()
    await expect(acceptStoredManualRecalibrationProposal(proposalId, { requestId, optionIndex: 0, outlierAcknowledged: true }, state.dependencies))
      .resolves.toMatchObject({ proposalId, outlierAcknowledged: true, sourceDecision })
    await expect(acceptStoredManualRecalibrationProposal(proposalId, { requestId, optionIndex: 0, outlierAcknowledged: true }, {
      ...state.dependencies, acceptProposal: async () => ({ proposalId: 'wrong' }),
    })).rejects.toEqual(new ManualRecalibrationError('manual_recalibration_unavailable'))
  })

  it('maps exact request conflicts and acknowledgement failures from the authenticated RPC', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'manual recalibration request ID reused' } })
      .mockResolvedValueOnce({ data: null, error: { code: 'PT409', message: 'outlier acknowledgement required' } })
    const dependencies = createSupabaseManualRecalibrationDependencies({ rpc } as never, {} as never)
    await expect(dependencies.acceptProposal(proposalId, requestId, 0, true))
      .rejects.toEqual(new ManualRecalibrationError('manual_recalibration_request_id_conflict'))
    await expect(dependencies.acceptProposal(proposalId, requestId, 0, false))
      .rejects.toEqual(new ManualRecalibrationError('manual_recalibration_acknowledgement_required'))
  })
})

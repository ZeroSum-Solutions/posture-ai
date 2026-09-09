import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLoadQuantity } from '../quantity'
import { SYNTHETIC_SWAP_JOURNEY_CATALOG } from '../catalog/syntheticSwapJourney'

const mocks = vi.hoisted(() => ({ buildOffer: vi.fn() }))
vi.mock('../engine/activeCalibration', async original => ({
  ...await original<typeof import('../engine/activeCalibration')>(),
  buildActiveCalibrationOffer: mocks.buildOffer,
}))

import {
  ActiveCalibrationError,
  DEFAULT_ACTIVE_CALIBRATION_REGISTRY,
  acceptStoredActiveCalibrationProposal,
  createSupabaseActiveCalibrationDependencies,
  createStoredActiveCalibrationProposal,
  type ActiveCalibrationDependencies,
  type StoredActiveCalibrationProposalV1,
} from './active-calibrations'

const actor = {
  ok: true, actorKind: 'athlete',
  userId: '11111111-1111-4111-8111-111111111111',
  subjectId: '22222222-2222-4222-8222-222222222222',
} as const
const proposalId = '33333333-3333-4333-8333-333333333333'
const now = new Date('2026-09-09T18:00:00.000Z')
const load = createLoadQuantity({ value: '5', unit: 'kg' })
const context = {
  kind: 'synthetic_simulation' as const,
  simulationRunId: '44444444-4444-4444-8444-444444444444',
  fixtureId: 'synthetic-active.v1', fixtureHash: 'a'.repeat(64), label: 'Practice data' as const,
}
const origin = {
  kind: 'synthetic_fixture' as const, source: 'server_fixture' as const,
  fixtureId: context.fixtureId, fixtureHash: context.fixtureHash, label: 'Synthetic active catalog',
}
const target = {
  sessionId: 'session-2', sessionRevision: 1,
  exerciseInstanceId: 'exercise-2', scheduledLocalDate: '2026-09-11',
}
const progression = {
  progressionSeriesId: 'series-push', side: 'bilateral' as const,
  rom: 'catalog_default' as const, tempo: 'self_selected_controlled' as const,
  exposureType: 'standard' as const, loadEpoch: 2,
}
const acceptedInitialLoad = {
  status: 'accepted' as const, acceptanceId: 'acceptance-1',
  acceptedAt: '2026-09-01T18:00:00.000Z', acceptedByUserId: actor.userId,
  source: 'equipment_inventory' as const, executionContext: context,
  exerciseInstanceId: 'exercise-2', exerciseVersionId: 'press.v1', equipmentId: 'db-1',
  provenance: {
    profileRevisionId: '3', compiledProgramRevisionId: 'compiled-1',
    catalogVersion: context.fixtureId, catalogOrigin: origin,
  },
  loadBasis: 'dumbbell_single_implement' as const,
  implementCount: 1 as const, holdingConfiguration: 'two_hands_single_implement' as const,
  quantity: createLoadQuantity({ value: '10', unit: 'kg' }),
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
      exerciseInstanceId: 'exercise-2', exerciseVersionId: 'press.v1', setIds: ['set-1', 'set-2'],
      repRange: { minimum: 6, maximum: 10 }, targetRir: { minimum: 2, maximum: 3 }, restSeconds: 120,
      progression, acceptedInitialLoad,
    }],
  }],
  conditioningBouts: [{
    status: 'accepted' as const, acceptanceId: 'conditioning-1',
    acceptedAt: '2026-09-01T18:00:00.000Z', acceptedByUserId: actor.userId,
    executionContext: context, boutId: 'bout-1', modalityId: 'walk.v1',
    scheduledLocalDate: '2026-09-10', athleteTimezone: 'America/Los_Angeles',
    acceptedDurationSeconds: 600, effortCue: 'Synthetic easy walk.',
    source: {
      compiledProgramRevisionId: 'compiled-1', compilerPolicyVersion: 'strength-cycle-compiler.v3',
      catalogVersion: context.fixtureId, catalogOrigin: origin,
    },
  }],
}

function candidate() {
  return {
    assignment: {
      id: 'assignment-1', subjectId: actor.subjectId, programMode: 'self_directed',
      owningPractitionerId: null, activeRevision: 1, revision: 3,
    },
    program, programHash: 'b'.repeat(64), currentProfileRevision: 3, profileRevision: 3,
    profile: {
      schemaVersion: 'athlete-training-profile.v1',
      origin: { kind: 'synthetic_fixture', fixtureId: context.fixtureId, label: 'Synthetic active profile' },
      goal: 'general_fitness', experience: 'beginner', recentConsistency: 'consistent', cycleLengthWeeks: 4,
      strengthDays: ['monday', 'thursday'], localTimezone: 'America/Los_Angeles',
      sessionTimeBudgetMinutes: 30, preferredLoadUnit: 'kg',
      equipmentInventory: [{ kind: 'dumbbell', equipmentId: 'db-1', unit: 'kg', perHandLoads: ['5', '10'] }],
      startingHistory: [],
    },
    eligibility: {
      state: 'eligible_general', scope: 'supported', policyVersion: 'synthetic-policy.v1',
      sourceRevisionId: 'eligibility-3',
      source: {
        kind: 'synthetic_fixture', sourceVersion: 'synthetic-eligibility-fixture.v1',
        fixtureId: context.fixtureId, label: 'Synthetic eligibility',
      },
      effectiveFrom: '2026-09-01T00:00:00.000Z', effectiveUntil: null, supersededAt: null,
    },
    progressionSeriesId: 'series-push', executionContext: context, targets: [target],
    sourceSessionRevision: 4, sourceSessionState: 'completed',
  }
}

const offer = {
  schemaVersion: 'active-calibration-offer.v1' as const,
  kind: 'options' as const, status: 'requires_explicit_selection' as const,
  sourceBindings: {
    subjectId: actor.subjectId, assignmentId: 'assignment-1', sourceProgramRevisionNumber: 1,
    sourceProgramHash: 'b'.repeat(64), sourceProfileRevisionId: '3',
    sourceEligibilityRevisionId: 'eligibility-3', executionContext: context,
    catalogVersion: context.fixtureId, catalogOrigin: origin,
    target: {
      sessionId: target.sessionId, exerciseInstanceId: target.exerciseInstanceId,
      sessionState: 'scheduled' as const, prescriptionState: 'unprescribed' as const,
    },
    exerciseVersionId: 'press.v1', priorProgressionSeriesId: 'series-push', priorLoadEpoch: 2,
  },
  currentLoad: { equipmentId: 'db-1', basis: 'dumbbell_single_implement' as const, quantity: acceptedInitialLoad.quantity },
  seriesIntent: {
    kind: 'new_series_on_acceptance' as const, reason: 'explicit_familiarization' as const,
    sourceProgressionSeriesId: 'series-push', sourceLoadEpoch: 2, nextLoadEpoch: 3,
  },
  options: [{
    optionIndex: 0, equipmentId: 'db-1', basis: 'dumbbell_single_implement' as const,
    quantity: load, easierDirection: 'lower_resistance_or_external_load' as const,
  }],
}

function harness(rawCandidate: unknown = candidate()) {
  const inserted: StoredActiveCalibrationProposalV1[] = []
  const dependencies: ActiveCalibrationDependencies = {
    now: () => now, newId: () => proposalId,
    loadCandidate: async () => rawCandidate,
    insertProposal: async proposal => { inserted.push(proposal); return { id: proposal.id } },
    acceptProposal: async id => ({
      schemaVersion: 'active-calibration-acceptance.v1', proposalId: id,
      assignmentId: 'assignment-1', programRevisionNumber: 2, executionContext: context,
      selectedLoad: { equipmentId: 'db-1', basis: 'dumbbell_single_implement', quantity: load },
      seriesIntent: offer.seriesIntent,
      newProgressionSeriesId: `familiarization:${id}`,
      affectedTargets: [{ sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }],
    }),
  }
  return { dependencies, inserted }
}

beforeEach(() => mocks.buildOffer.mockReset().mockReturnValue(offer))

describe('stored active calibration', () => {
  it('uses the context-aware default catalog resolver', () => {
    expect(DEFAULT_ACTIVE_CALIBRATION_REGISTRY.catalog.resolve(
      SYNTHETIC_SWAP_JOURNEY_CATALOG.catalogVersion,
      SYNTHETIC_SWAP_JOURNEY_CATALOG.origin,
    )).toBe(SYNTHETIC_SWAP_JOURNEY_CATALOG)
    expect(DEFAULT_ACTIVE_CALIBRATION_REGISTRY.catalog.resolve(
      'unknown-authored.v1',
      { kind: 'authored_catalog' },
    )).toBeNull()
  })

  it('persists a server-built offer with complete current and target bindings', async () => {
    const state = harness()
    await expect(createStoredActiveCalibrationProposal({
      sessionId: 'session-1', exerciseInstanceId: 'exercise-1',
    }, actor, state.dependencies)).resolves.toMatchObject({ proposalId, offer: { kind: 'options' } })
    expect(state.inserted).toEqual([expect.objectContaining({
      subjectId: actor.subjectId, assignmentId: 'assignment-1',
      sourceSessionId: 'session-1', sourceExerciseInstanceId: 'exercise-1', sourceSessionRevision: 4,
      sourceProfileRevision: 3, sourceEligibilityRevisionId: 'eligibility-3',
      targetBindings: [target], offer,
    })])
  })

  it('does not persist when no easier exact setting exists', async () => {
    const { options: _options, ...common } = offer
    void _options
    mocks.buildOffer.mockReturnValueOnce({
      ...common, kind: 'unavailable', status: 'not_offered',
      reason: 'no_easier_achievable_setting',
    })
    const state = harness()
    const result = await createStoredActiveCalibrationProposal({
      sessionId: 'session-1', exerciseInstanceId: 'exercise-1',
    }, actor, state.dependencies)
    expect(result).toMatchObject({ proposalId: null, offer: { kind: 'unavailable' } })
    expect(state.inserted).toHaveLength(0)
  })

  it('fails closed for foreign subjects and stale profile/program sources', async () => {
    await expect(createStoredActiveCalibrationProposal({
      sessionId: 'session-1', exerciseInstanceId: 'exercise-1',
    }, actor, harness({
      ...candidate(), assignment: { ...candidate().assignment, subjectId: 'another-subject' },
    }).dependencies)).rejects.toEqual(new ActiveCalibrationError('active_calibration_forbidden'))
    await expect(createStoredActiveCalibrationProposal({
      sessionId: 'session-1', exerciseInstanceId: 'exercise-1',
    }, actor, harness({ ...candidate(), currentProfileRevision: 4 }).dependencies))
      .rejects.toEqual(new ActiveCalibrationError('active_calibration_source_stale'))
  })

  it('allows only the owning coach to create a coach-assigned proposal', async () => {
    const coachProgram = {
      ...program,
      programMode: 'coach_assigned' as const,
      owningPractitionerId: '66666666-6666-4666-8666-666666666666',
    }
    const coachCandidate = {
      ...candidate(),
      assignment: {
        ...candidate().assignment,
        programMode: 'coach_assigned',
        owningPractitionerId: coachProgram.owningPractitionerId,
      },
      program: coachProgram,
    }
    const owningCoach = {
      ok: true as const, actorKind: 'practitioner' as const,
      userId: coachProgram.owningPractitionerId, subjectId: null,
    }
    await expect(createStoredActiveCalibrationProposal({
      sessionId: 'session-1', exerciseInstanceId: 'exercise-1',
    }, owningCoach, harness(coachCandidate).dependencies)).resolves.toMatchObject({ proposalId })
    await expect(createStoredActiveCalibrationProposal({
      sessionId: 'session-1', exerciseInstanceId: 'exercise-1',
    }, { ...owningCoach, userId: '77777777-7777-4777-8777-777777777777' },
    harness(coachCandidate).dependencies)).rejects
      .toEqual(new ActiveCalibrationError('active_calibration_forbidden'))
  })

  it.each(['active', 'renewed', 'accepted'] as const)(
    'recovers the same exact proposal when its server lifetime resolves as %s', async status => {
    const state = harness()
    await createStoredActiveCalibrationProposal({
      sessionId: 'session-1', exerciseInstanceId: 'exercise-1',
    }, actor, state.dependencies)
    const proposal = state.inserted[0]
    const existingId = '88888888-8888-4888-8888-888888888888'
    const existing = {
      id: existingId,
      proposal_key: proposal.proposalKey,
      created_by_user_id: '66666666-6666-4666-8666-666666666666',
      subject_id: proposal.subjectId,
      assignment_id: proposal.assignmentId,
      base_program_revision_number: proposal.baseProgramRevisionNumber,
      base_assignment_revision: proposal.baseAssignmentRevision,
      source_session_id: proposal.sourceSessionId,
      source_exercise_instance_id: proposal.sourceExerciseInstanceId,
      source_session_revision: proposal.sourceSessionRevision,
      source_profile_revision: proposal.sourceProfileRevision,
      source_eligibility_revision_id: proposal.sourceEligibilityRevisionId,
      source_program_hash: proposal.sourceProgramHash,
      execution_context: proposal.executionContext,
      catalog_version: proposal.catalogVersion,
      catalog_origin: proposal.catalogOrigin,
      target_bindings: proposal.targetBindings,
      offer_json: proposal.offer,
      expires_at: '2026-09-09T18:30:00.000Z',
    }
    const service = {
      from: vi.fn(() => ({
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
      })),
    }
    const rpc = vi.fn().mockResolvedValue({ data: {
      proposalId: existingId, status, expiresAt: '2026-09-09T19:30:00.000Z',
    }, error: null })
    const dependencies = createSupabaseActiveCalibrationDependencies(
      { rpc } as never,
      service as never,
    )
    await expect(dependencies.insertProposal({
      ...proposal,
      id: '99999999-9999-4999-8999-999999999999',
      createdByUserId: existing.created_by_user_id,
      createdAt: '2026-09-09T18:10:00.000Z',
      expiresAt: '2026-09-09T19:10:00.000Z',
    })).resolves.toEqual({ id: existingId })
    expect(rpc).toHaveBeenCalledWith('renew_training_active_calibration_proposal', {
      p_proposal_id: existingId,
    })
  })

  it('validates the exact proposal acceptance receipt', async () => {
    const state = harness()
    await expect(acceptStoredActiveCalibrationProposal(
      proposalId,
      { requestId: '55555555-5555-4555-8555-555555555555', optionIndex: 0 },
      state.dependencies,
    )).resolves.toMatchObject({ proposalId, selectedLoad: { quantity: { entered: { value: '5' } } } })
    await expect(acceptStoredActiveCalibrationProposal(
      proposalId,
      { requestId: '55555555-5555-4555-8555-555555555555', optionIndex: 0 },
      { ...state.dependencies, acceptProposal: async () => ({ proposalId: 'wrong' }) },
    )).rejects.toEqual(new ActiveCalibrationError('active_calibration_unavailable'))
  })
})

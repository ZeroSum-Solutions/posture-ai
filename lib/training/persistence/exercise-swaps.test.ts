import { describe, expect, it, vi } from 'vitest'
import { TrainingCatalogV1Schema } from '../catalog/types'
import { SYNTHETIC_SWAP_JOURNEY_CATALOG } from '../catalog/syntheticSwapJourney'
import { TrainingProgramRevisionV1Schema } from '../contracts/program'
import { createLoadQuantity } from '../quantity'
import {
  ExerciseSwapError,
  DEFAULT_EXERCISE_SWAP_CATALOG_REGISTRY,
  acceptStoredExerciseSwapProposal,
  createSupabaseExerciseSwapDependencies,
  createStoredExerciseSwapProposals,
  type ExerciseSwapDependencies,
} from './exercise-swaps'

const subjectId = '11111111-1111-4111-8111-111111111111'
const proposalId = '22222222-2222-4222-8222-222222222222'
const requestId = '33333333-3333-4333-8333-333333333333'
const actor = { ok: true, actorKind: 'athlete', userId: subjectId, subjectId } as const
const origin = {
  kind: 'synthetic_fixture', source: 'server_fixture', fixtureId: 'synthetic-swap.v1',
  fixtureHash: 'a'.repeat(64), label: 'Synthetic swap fixture',
} as const
const defaults = { side: 'bilateral', rom: 'catalog_default', tempo: 'controlled', exposureType: 'standard' } as const
const difference = [{ kind: 'body_position', description: 'The replacement uses a supported torso position.' }] as const
const compatibility = [{
  kind: 'dumbbell', basis: 'dumbbell_per_hand', implementCount: 2,
  holdingConfiguration: 'one_per_hand', minimumCanonicalKg: '2', maximumCanonicalKg: '10',
}] as const
const sourceCatalogExercise = {
  exerciseId: 'row-a', exerciseVersionId: 'row-a.v1', label: 'Synthetic Row A', movementPattern: 'pull',
  role: 'primary', lifecycle: 'active', contentReviewStatus: 'reviewed_fixture', mediaStatus: 'missing',
  preparationSeconds: 30, secondsPerRep: 4, preferenceRank: 0, textInstruction: 'Fixture instructions.',
  progressionDefaults: defaults, equipmentCompatibility: compatibility,
  swap: { trainingIntentId: 'horizontal-pull', alternatives: [{ exerciseVersionId: 'row-b.v1', differences: difference, recalibrationRequired: true }] },
} as const
const replacementCatalogExercise = {
  ...sourceCatalogExercise, exerciseId: 'row-b', exerciseVersionId: 'row-b.v1', label: 'Synthetic Row B',
  preferenceRank: 1, warmupSets: [{ targetReps: 8, load: { value: '5', unit: 'kg' } }],
  swap: { trainingIntentId: 'horizontal-pull', alternatives: [{ exerciseVersionId: 'row-a.v1', differences: difference, recalibrationRequired: true }] },
} as const
const catalog = TrainingCatalogV1Schema.parse({
  schemaVersion: 'training-catalog.v1', catalogVersion: 'synthetic-swap.v1', origin,
  exercises: [sourceCatalogExercise, replacementCatalogExercise], conditioningModes: [],
})
const acceptedInitialLoad = {
  status: 'accepted', acceptanceId: 'acceptance-1', acceptedAt: '2026-09-01T12:00:00.000Z',
  acceptedByUserId: subjectId, source: 'equipment_inventory', executionContext: {
    kind: 'synthetic_simulation', simulationRunId: '44444444-4444-4444-8444-444444444444',
    fixtureId: origin.fixtureId, fixtureHash: origin.fixtureHash, label: 'Practice data',
  },
  exerciseInstanceId: 'exercise-2', exerciseVersionId: 'row-a.v1', equipmentId: 'db-home',
  loadBasis: 'dumbbell_per_hand', implementCount: 2, holdingConfiguration: 'one_per_hand',
  provenance: { profileRevisionId: '1', compiledProgramRevisionId: 'compiled-1', catalogVersion: catalog.catalogVersion, catalogOrigin: origin },
  quantity: { entered: { value: '5', unit: 'kg' }, canonicalKg: '5' },
} as const
const sourceExercise = {
  exerciseInstanceId: 'exercise-2', exerciseVersionId: 'row-a.v1', movementPattern: 'pull',
  setIds: ['set-1'], repRange: { minimum: 8, maximum: 12 }, targetReps: [8],
  targetRir: { minimum: 2, maximum: 3 }, restSeconds: 90,
  progression: { progressionSeriesId: 'series-1', ...defaults, exposureType: 'heavy', loadEpoch: 0 }, acceptedInitialLoad,
} as const
const program = {
  schemaVersion: 'training-program-revision.v1', assignmentId: 'assignment-1', revisionNumber: 1,
  subjectId, programMode: 'self_directed', owningPractitionerId: null,
  executionContext: acceptedInitialLoad.executionContext, cycleStartLocalDate: '2026-09-01', cycleLengthWeeks: 8,
  profileRevisionId: '1', eligibilitySourceRevisionId: 'eligibility-1', compilerPolicyVersion: 'strength-cycle-compiler.v3',
  catalogVersion: catalog.catalogVersion, catalogOrigin: origin, ruleVersion: 'rules.v1',
  compiledProgramRevisionId: 'compiled-1', publishedAt: '2026-09-01T12:00:00.000Z',
  author: { kind: 'system', userId: null },
  sessions: [{ sessionId: 'session-2', sessionType: 'full_body', scheduledLocalDate: '2026-09-10', athleteTimezone: 'UTC', exercises: [sourceExercise] }],
  conditioningBouts: [{
    status: 'accepted', acceptanceId: 'conditioning-1', acceptedAt: '2026-09-01T12:00:00.000Z',
    acceptedByUserId: subjectId, executionContext: acceptedInitialLoad.executionContext,
    boutId: 'bout-1', modalityId: 'walk', scheduledLocalDate: '2026-09-10', athleteTimezone: 'UTC',
    acceptedDurationSeconds: 600, effortCue: 'Conversational pace.', source: {
      compiledProgramRevisionId: 'compiled-1', compilerPolicyVersion: 'strength-cycle-compiler.v3',
      catalogVersion: catalog.catalogVersion, catalogOrigin: origin,
    },
  }],
} as const
const profile = {
  schemaVersion: 'athlete-training-profile.v1', origin: { kind: 'synthetic_fixture', fixtureId: 'profile.v1', label: 'Synthetic profile' },
  goal: 'strength', experience: 'beginner', recentConsistency: 'consistent', cycleLengthWeeks: 8,
  strengthDays: ['monday', 'thursday'], localTimezone: 'UTC', sessionTimeBudgetMinutes: 45,
  preferredLoadUnit: 'kg', equipmentInventory: [{ kind: 'dumbbell', equipmentId: 'db-home', unit: 'kg', perHandLoads: ['2', '5', '10'] }],
  startingHistory: [],
} as const
const candidate = {
  schemaVersion: 'training-exercise-swap-candidate.v1', status: 'ready', assignmentId: 'assignment-1',
  assignmentRevision: 1, baseProgramRevisionNumber: 1, subjectId, programHash: 'b'.repeat(64),
  program, profile, currentProfileRevision: 1,
  sourceExerciseVersionId: 'row-a.v1', sourceExerciseInstanceId: 'exercise-2',
  targets: [{ sessionId: 'session-2', sessionRevision: 1, scheduledLocalDate: '2026-09-10', exerciseInstanceId: 'exercise-2', sourceExercise }],
} as const

function dependencies(read: unknown = candidate): ExerciseSwapDependencies {
  return {
    now: () => new Date('2026-09-08T12:00:00.000Z'), newId: () => proposalId,
    loadCandidate: vi.fn().mockResolvedValue(read),
    insertProposal: vi.fn(async proposal => proposal.proposal),
    acceptProposal: vi.fn(),
  }
}

describe('exercise swap persistence', () => {
  it('uses the context-aware default catalog resolver', () => {
    expect(DEFAULT_EXERCISE_SWAP_CATALOG_REGISTRY.resolve(
      SYNTHETIC_SWAP_JOURNEY_CATALOG.catalogVersion,
      SYNTHETIC_SWAP_JOURNEY_CATALOG.origin,
    )).toBe(SYNTHETIC_SWAP_JOURNEY_CATALOG)
    expect(DEFAULT_EXERCISE_SWAP_CATALOG_REGISTRY.resolve(
      'unknown-authored.v1',
      { kind: 'authored_catalog' },
    )).toBeNull()
  })

  it('stores a bounded immutable proposal derived from the server candidate and exact catalog', async () => {
    const deps = dependencies()
    const result = await createStoredExerciseSwapProposals(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }, actor, deps,
      { resolve: () => catalog },
    )
    expect(result.result).toMatchObject({
      kind: 'proposals', proposals: [{ proposalId, replacementExercise: { exerciseVersionId: 'row-b.v1' } }],
    })
    expect(deps.insertProposal).toHaveBeenCalledWith(expect.objectContaining({
      proposalKey: expect.stringMatching(/^[a-f0-9]{64}$/), subjectId,
      replacementDefaults: expect.objectContaining({
        progressionDefaults: expect.objectContaining({ exposureType: 'standard' }),
        warmupSets: [{
          targetReps: 8,
          prescribedLoad: { entered: { value: '5', unit: 'kg' }, canonicalKg: '5' },
        }],
      }),
      targetBindings: [expect.objectContaining({
        sourceExercise: expect.objectContaining({
          progression: expect.objectContaining({ exposureType: 'heavy' }),
        }),
      })],
    }))
  })

  it('stores the exact context-bound assistance policy with every dedicated load option', async () => {
    const policyReference = { policyId: 'synthetic-assistance-only.v1', policyVersion: '1' }
    const dedicatedReplacement = {
      ...replacementCatalogExercise,
      warmupSets: undefined,
      equipmentCompatibility: [{
        kind: 'assistance_machine' as const, basis: 'machine_assistance' as const,
        implementCount: 1 as const, holdingConfiguration: 'machine_assistance' as const,
        minimumCanonicalKg: '10', maximumCanonicalKg: '50', bodyweightAssistancePolicy: policyReference,
      }],
    }
    const dedicatedCatalog = TrainingCatalogV1Schema.parse({
      ...catalog, exercises: [sourceCatalogExercise, dedicatedReplacement],
    })
    const dedicatedProfile = {
      ...profile,
      equipmentInventory: [{
        kind: 'assistance_machine' as const, equipmentId: 'assist-1', unit: 'kg' as const,
        assistanceLoads: ['5', '20', '40', '70'],
      }],
    }
    const deps = dependencies({ ...candidate, profile: dedicatedProfile })
    const result = await createStoredExerciseSwapProposals(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }, actor, deps,
      { resolve: () => dedicatedCatalog },
      { resolve: () => ({
        schemaVersion: 'bodyweight-assistance-progression-policy.v1',
        policyId: policyReference.policyId, policyVersion: policyReference.policyVersion,
        progressionMode: 'rep_only_same_benchmark', loadBasis: 'machine_assistance',
        supportedAssistanceRange: {
          equipmentId: 'assist-1', minimum: createLoadQuantity({ value: '5', unit: 'kg' }),
          maximum: createLoadQuantity({ value: '60', unit: 'kg' }),
        },
        provenance: {
          kind: 'synthetic_fixture', fixtureId: origin.fixtureId,
          fixtureHash: origin.fixtureHash, label: 'Practice data',
        },
      }) },
    )
    expect(result.result).toMatchObject({
      kind: 'proposals',
      proposals: [{ loadOptions: [
        { optionIndex: 0, equipmentId: 'assist-1', loadBasis: 'machine_assistance',
          implementCount: 1, holdingConfiguration: 'machine_assistance',
          bodyweightAssistancePolicy: policyReference,
          quantity: createLoadQuantity({ value: '20', unit: 'kg' }) },
        { optionIndex: 1, quantity: createLoadQuantity({ value: '40', unit: 'kg' }) },
      ] }],
    })
    expect(deps.insertProposal).toHaveBeenCalledWith(expect.objectContaining({
      loadOptions: expect.arrayContaining([expect.objectContaining({
        loadBasis: 'machine_assistance', bodyweightAssistancePolicy: policyReference,
      })]),
    }))
  })

  it('uses the server registry to offer the exact private-practice swap fixture', async () => {
    const swapOrigin = SYNTHETIC_SWAP_JOURNEY_CATALOG.origin
    const swapContext = {
      ...acceptedInitialLoad.executionContext,
      fixtureId: swapOrigin.kind === 'synthetic_fixture' ? swapOrigin.fixtureId : '',
      fixtureHash: swapOrigin.kind === 'synthetic_fixture' ? swapOrigin.fixtureHash : '',
    } as const
    const swapInitialLoad = {
      ...acceptedInitialLoad,
      executionContext: swapContext,
      exerciseVersionId: 'synthetic-two-dumbbell-floor-press.v1',
      provenance: {
        ...acceptedInitialLoad.provenance,
        catalogVersion: SYNTHETIC_SWAP_JOURNEY_CATALOG.catalogVersion,
        catalogOrigin: swapOrigin,
      },
    }
    const swapSourceExercise = {
      ...sourceExercise,
      exerciseVersionId: 'synthetic-two-dumbbell-floor-press.v1',
      movementPattern: 'push' as const,
      acceptedInitialLoad: swapInitialLoad,
    }
    const swapProgram = {
      ...program,
      executionContext: swapContext,
      catalogVersion: SYNTHETIC_SWAP_JOURNEY_CATALOG.catalogVersion,
      catalogOrigin: swapOrigin,
      sessions: [{
        ...program.sessions[0],
        exercises: [swapSourceExercise],
      }],
      conditioningBouts: program.conditioningBouts.map(bout => ({
        ...bout,
        executionContext: swapContext,
        source: {
          ...bout.source,
          catalogVersion: SYNTHETIC_SWAP_JOURNEY_CATALOG.catalogVersion,
          catalogOrigin: swapOrigin,
        },
      })),
    }
    const swapCandidate = {
      ...candidate,
      program: swapProgram,
      sourceExerciseVersionId: swapSourceExercise.exerciseVersionId,
      targets: [{
        ...candidate.targets[0],
        sourceExercise: swapSourceExercise,
      }],
    }
    TrainingProgramRevisionV1Schema.parse(swapProgram)

    const result = await createStoredExerciseSwapProposals(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' },
      actor,
      dependencies(swapCandidate),
    )

    expect(result).toMatchObject({
      result: {
        kind: 'proposals',
        proposals: [{
          replacementExercise: {
            exerciseVersionId: 'synthetic-neutral-grip-two-dumbbell-floor-press.v1',
            recalibrationRequired: true,
          },
          catalogVersion: 'synthetic-swap-journey-catalog.v1',
        }],
      },
    })
  })

  it('returns explicit closed states and rejects an athlete crossing subject ownership', async () => {
    await expect(createStoredExerciseSwapProposals(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' }, actor,
      dependencies({ schemaVersion: 'training-exercise-swap-candidate.v1', status: 'no_future_target' }),
      { resolve: () => catalog },
    )).resolves.toMatchObject({ result: { kind: 'no_future_target', proposals: [] } })
    await expect(createStoredExerciseSwapProposals(
      { sessionId: 'session-2', exerciseInstanceId: 'exercise-2' },
      { ...actor, subjectId: '55555555-5555-4555-8555-555555555555' }, dependencies(),
      { resolve: () => catalog },
    )).rejects.toEqual(expect.objectContaining({ code: 'exercise_swap_forbidden' }))
  })

  it('accepts only the proposal-bound load option returned by the authenticated RPC', async () => {
    const deps = dependencies()
    deps.acceptProposal = vi.fn().mockResolvedValue({
      schemaVersion: 'training-exercise-swap-acceptance.v1', proposalId, assignmentId: 'assignment-1',
      programRevisionNumber: 2, replacementExerciseVersionId: 'row-b.v1',
      selectedLoad: { optionIndex: 0, equipmentId: 'db-home', loadBasis: 'dumbbell_per_hand', implementCount: 2, holdingConfiguration: 'one_per_hand', quantity: { entered: { value: '5', unit: 'kg' }, canonicalKg: '5' } },
      affectedSessionIds: ['session-2'],
      recalibration: { required: true, reason: 'exercise_variant_changed', loadDisposition: 'starting_target_to_confirm' },
    })
    await expect(acceptStoredExerciseSwapProposal(
      proposalId, { requestId, selectedLoadOptionIndex: 0 }, deps,
    )).resolves.toMatchObject({ proposalId, selectedLoad: { optionIndex: 0 } })
    expect(deps.acceptProposal).toHaveBeenCalledWith(proposalId, requestId, 0)
  })

  it.each([
    ['PT409', 'exercise swap request ID reused with different content', 'exercise_swap_request_id_conflict'],
    ['40001', 'exercise swap request ID reused with different content', 'exercise_swap_request_id_conflict'],
    ['PT409', 'exercise swap source changed', 'exercise_swap_source_stale'],
    ['40P01', 'deadlock detected', 'exercise_swap_source_stale'],
    ['42501', 'exercise swap acceptance is not authorized', 'exercise_swap_forbidden'],
    ['P0001', 'exercise swap proposal is unavailable', 'exercise_swap_unavailable'],
    ['22023', 'exercise swap load option is invalid', 'exercise_swap_selection_invalid'],
  ] as const)('maps RPC %s failures without collapsing retry semantics', async (code, message, expected) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message } })
    const deps = createSupabaseExerciseSwapDependencies({ rpc } as never, {} as never)
    await expect(deps.acceptProposal(proposalId, requestId, 0)).rejects.toEqual(
      new ExerciseSwapError(expected),
    )
  })
})

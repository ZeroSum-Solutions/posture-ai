import { describe, expect, it } from 'vitest'
import { AthleteTrainingProfileV1Schema } from '../contracts/profile'
import {
  acceptCompiledExerciseInitialLoad,
  buildCompiledExerciseInitialLoadCalibration,
} from '../contracts/calibration'
import { compileTrainingProgram } from '../engine/compileProgram'
import {
  resolveSyntheticBodyweightAssistancePolicy,
  resolveSyntheticTrainingCatalog,
} from './syntheticRegistry'
import {
  SYNTHETIC_ASSISTANCE_POLICY_REFERENCE,
  SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG,
  SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_HASH,
  SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
  SYNTHETIC_BODYWEIGHT_POLICY_REFERENCE,
} from './syntheticBodyweightAssistance'

const context = {
  kind: 'synthetic_simulation' as const,
  simulationRunId: '11111111-1111-4111-8111-111111111111',
  fixtureId: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
  fixtureHash: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_HASH,
  label: 'Practice data' as const,
}

const policyRegistry = {
  resolve: resolveSyntheticBodyweightAssistancePolicy,
}

function profile() {
  return AthleteTrainingProfileV1Schema.parse({
    schemaVersion: 'athlete-training-profile.v1',
    origin: {
      kind: 'synthetic_fixture',
      fixtureId: SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
      label: 'Synthetic bodyweight and assistance profile',
    },
    goal: 'general_fitness', experience: 'beginner', recentConsistency: 'consistent',
    cycleLengthWeeks: 4, strengthDays: ['monday', 'thursday'],
    localTimezone: 'America/Los_Angeles', sessionTimeBudgetMinutes: 30,
    preferredLoadUnit: 'kg',
    equipmentInventory: [
      {
        kind: 'bodyweight_external', equipmentId: 'synthetic-bodyweight-station', unit: 'kg',
        externalLoads: ['0', '2.5', '5'],
      },
      {
        kind: 'assistance_machine', equipmentId: 'synthetic-assisted-pullup-machine', unit: 'kg',
        assistanceLoads: ['10', '20', '30', '40', '50', '60'],
      },
    ],
    startingHistory: [],
  })
}

describe('synthetic bodyweight and assistance fixture', () => {
  it('compiles every required movement with explicit load meaning and policy identity', () => {
    const result = compileTrainingProgram({
      subjectId: 'subject-1', profileRevisionId: '1', programRevisionId: 'program-1',
      cycleStartLocalDate: '2026-09-14', conditioningModalityId: 'synthetic-continuous-walking.v1',
      executionContext: context, profile: profile(), catalog: SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG,
    })

    expect(result.kind).toBe('draft_program')
    if (result.kind !== 'draft_program') return
    const exercises = result.weeks[0].strengthSessions[0].exercises
    expect(exercises.map(exercise => exercise.loadBasis)).toEqual([
      'bodyweight_external', 'bodyweight_external', 'bodyweight_external', 'machine_assistance',
    ])
    expect(exercises.every(exercise => exercise.bodyweightAssistancePolicy)).toBe(true)
    expect(exercises.find(exercise => exercise.loadBasis === 'bodyweight_external')).toMatchObject({
      implementCount: 0, holdingConfiguration: 'bodyweight_plus_external_load',
    })
    expect(exercises.find(exercise => exercise.loadBasis === 'machine_assistance')).toMatchObject({
      implementCount: 1, holdingConfiguration: 'machine_assistance',
    })
  })

  it('offers and accepts exact external and assistance settings with catalog-attested policy identity', () => {
    const sourceProfile = profile()
    const result = compileTrainingProgram({
      subjectId: 'subject-1', profileRevisionId: '1', programRevisionId: 'program-1',
      cycleStartLocalDate: '2026-09-14', conditioningModalityId: 'synthetic-continuous-walking.v1',
      executionContext: context, profile: sourceProfile, catalog: SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG,
    })
    if (result.kind !== 'draft_program') throw new Error('fixture did not compile')
    const exercises = result.weeks[0].strengthSessions[0].exercises
    const bodyweight = exercises.find(exercise => exercise.loadBasis === 'bodyweight_external')!
    const assistance = exercises.find(exercise => exercise.loadBasis === 'machine_assistance')!

    const bodyweightCalibration = buildCompiledExerciseInitialLoadCalibration({
      draft: result, exerciseInstanceId: bodyweight.exerciseInstanceId,
      catalog: SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG, profile: sourceProfile,
      bodyweightAssistancePolicyRegistry: policyRegistry,
    })
    expect(bodyweightCalibration.options.map(option => option.quantity.entered.value))
      .toEqual(['0', '2.5', '5'])
    expect(bodyweightCalibration.bodyweightAssistancePolicy)
      .toEqual(SYNTHETIC_BODYWEIGHT_POLICY_REFERENCE)

    const accepted = acceptCompiledExerciseInitialLoad({
      draft: result, exerciseInstanceId: assistance.exerciseInstanceId,
      catalog: SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG, profile: sourceProfile,
      bodyweightAssistancePolicyRegistry: policyRegistry,
      acceptanceId: 'acceptance-1', acceptedAt: '2026-09-14T08:00:00Z',
      acceptedByUserId: 'athlete-1', optionIndex: 1,
    })
    expect(accepted).toMatchObject({
      loadBasis: 'machine_assistance', implementCount: 1,
      holdingConfiguration: 'machine_assistance',
      bodyweightAssistancePolicy: SYNTHETIC_ASSISTANCE_POLICY_REFERENCE,
      quantity: { entered: { value: '20', unit: 'kg' } },
    })

    const tampered = structuredClone(result)
    const tamperedExercise = tampered.weeks[0].strengthSessions[0].exercises
      .find(exercise => exercise.exerciseInstanceId === assistance.exerciseInstanceId)!
    ;(tamperedExercise as { bodyweightAssistancePolicy?: { policyId: string; policyVersion: string } })
      .bodyweightAssistancePolicy = SYNTHETIC_BODYWEIGHT_POLICY_REFERENCE
    expect(() => buildCompiledExerciseInitialLoadCalibration({
      draft: tampered, exerciseInstanceId: assistance.exerciseInstanceId,
      catalog: SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG, profile: sourceProfile,
      bodyweightAssistancePolicyRegistry: policyRegistry,
    })).toThrow('policy is not catalog-attested')

    expect(() => buildCompiledExerciseInitialLoadCalibration({
      draft: result, exerciseInstanceId: bodyweight.exerciseInstanceId,
      catalog: SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG, profile: sourceProfile,
    })).toThrow('policy is unavailable')

    const differentMachineProfile = profile()
    differentMachineProfile.equipmentInventory = differentMachineProfile.equipmentInventory.map(item => (
      item.kind === 'assistance_machine'
        ? { ...item, equipmentId: 'other-assisted-machine' }
        : item
    ))
    const differentMachineDraft = compileTrainingProgram({
      subjectId: 'subject-1', profileRevisionId: '1', programRevisionId: 'program-2',
      cycleStartLocalDate: '2026-09-14', conditioningModalityId: 'synthetic-continuous-walking.v1',
      executionContext: context, profile: differentMachineProfile,
      catalog: SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG,
    })
    if (differentMachineDraft.kind !== 'draft_program') throw new Error('fixture did not compile')
    const differentAssistance = differentMachineDraft.weeks[0].strengthSessions[0].exercises
      .find(exercise => exercise.loadBasis === 'machine_assistance')!
    expect(() => buildCompiledExerciseInitialLoadCalibration({
      draft: differentMachineDraft, exerciseInstanceId: differentAssistance.exerciseInstanceId,
      catalog: SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG, profile: differentMachineProfile,
      bodyweightAssistancePolicyRegistry: policyRegistry,
    })).toThrow('outside the reviewed machine range')
  })

  it('resolves only its exact registered catalog and exact simulation-bound policy', () => {
    expect(resolveSyntheticTrainingCatalog(
      SYNTHETIC_BODYWEIGHT_ASSISTANCE_FIXTURE_ID,
      SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG.origin,
    )).toBe(SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG)
    expect(resolveSyntheticBodyweightAssistancePolicy(
      SYNTHETIC_ASSISTANCE_POLICY_REFERENCE, context,
    )).toMatchObject({
      loadBasis: 'machine_assistance',
      supportedAssistanceRange: { equipmentId: 'synthetic-assisted-pullup-machine' },
      provenance: { label: 'Practice data' },
    })
    expect(resolveSyntheticBodyweightAssistancePolicy(
      SYNTHETIC_BODYWEIGHT_POLICY_REFERENCE,
      { ...context, fixtureHash: '0'.repeat(64) },
    )).toBeNull()
    expect(resolveSyntheticBodyweightAssistancePolicy(
      SYNTHETIC_BODYWEIGHT_POLICY_REFERENCE,
      { kind: 'live' },
    )).toBeNull()
  })

  it('rejects a new load basis when its exact policy reference is removed', () => {
    const altered = structuredClone(SYNTHETIC_BODYWEIGHT_ASSISTANCE_CATALOG)
    const compatibility = altered.exercises[0].equipmentCompatibility[0]
    delete (compatibility as { bodyweightAssistancePolicy?: unknown }).bodyweightAssistancePolicy

    expect(() => AthleteTrainingProfileV1Schema.parse(profile())).not.toThrow()
    expect(() => compileTrainingProgram({
      subjectId: 'subject-1', profileRevisionId: '1', programRevisionId: 'program-1',
      cycleStartLocalDate: '2026-09-14', conditioningModalityId: 'synthetic-continuous-walking.v1',
      executionContext: context, profile: profile(), catalog: altered,
    })).toThrow()
  })
})

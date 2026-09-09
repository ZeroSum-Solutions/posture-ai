import { describe, expect, it } from 'vitest'
import { resolveExerciseSwapAlternatives } from './exerciseSwaps'
import { TrainingCatalogV1Schema } from './types'
import { createLoadQuantity } from '../quantity'

const defaults = {
  side: 'bilateral', rom: 'catalog_default', tempo: 'controlled', exposureType: 'standard',
} as const
const compatibility = [{
  kind: 'dumbbell', basis: 'dumbbell_per_hand', implementCount: 2,
  holdingConfiguration: 'one_per_hand', minimumCanonicalKg: '2', maximumCanonicalKg: '20',
}] as const
const difference = [{ kind: 'body_position', description: 'The replacement uses a supported torso position.' }] as const
const base = {
  role: 'primary', lifecycle: 'active', contentReviewStatus: 'reviewed_fixture',
  mediaStatus: 'missing', preparationSeconds: 30, secondsPerRep: 4,
  textInstruction: 'Synthetic fixture instructions.', progressionDefaults: defaults,
  equipmentCompatibility: compatibility,
} as const
const source = {
  ...base, exerciseId: 'synthetic-row-a', exerciseVersionId: 'synthetic-row-a.v1',
  label: 'Synthetic row A', movementPattern: 'pull', preferenceRank: 0,
  swap: {
    trainingIntentId: 'synthetic-horizontal-pull',
    alternatives: [{ exerciseVersionId: 'synthetic-row-b.v1', differences: difference, recalibrationRequired: true }],
  },
} as const
const target = {
  ...base, exerciseId: 'synthetic-row-b', exerciseVersionId: 'synthetic-row-b.v1',
  label: 'Synthetic row B', movementPattern: 'pull', preferenceRank: 1,
  swap: {
    trainingIntentId: 'synthetic-horizontal-pull',
    alternatives: [{ exerciseVersionId: 'synthetic-row-a.v1', differences: difference, recalibrationRequired: true }],
  },
} as const
const catalog = {
  schemaVersion: 'training-catalog.v1', catalogVersion: 'synthetic-swap-catalog.v1',
  origin: {
    kind: 'synthetic_fixture', source: 'server_fixture', fixtureId: 'synthetic-swap-catalog.v1',
    fixtureHash: 'a'.repeat(64), label: 'Synthetic swap catalog fixture',
  },
  exercises: [source, target], conditioningModes: [],
} as const
const profile = {
  schemaVersion: 'athlete-training-profile.v1', origin: { kind: 'synthetic_fixture', fixtureId: 'synthetic-profile.v1', label: 'Synthetic profile fixture' },
  goal: 'strength', experience: 'beginner', recentConsistency: 'consistent', cycleLengthWeeks: 8,
  strengthDays: ['monday', 'thursday'], localTimezone: 'UTC', sessionTimeBudgetMinutes: 45,
  preferredLoadUnit: 'kg', equipmentInventory: [{
    kind: 'dumbbell', equipmentId: 'db-home', unit: 'kg', perHandLoads: ['2', '5', '10', '25'],
  }], startingHistory: [],
} as const
const executionContext = {
  kind: 'synthetic_simulation' as const,
  simulationRunId: '11111111-1111-4111-8111-111111111111',
  fixtureId: catalog.origin.fixtureId,
  fixtureHash: catalog.origin.fixtureHash,
  label: 'Practice data' as const,
}

describe('exercise swap catalog resolver', () => {
  it('does not offer a bodyweight alternative through the conventional-load swap contract', () => {
    const bodyweightTarget = {
      ...target,
      equipmentCompatibility: [{
        kind: 'bodyweight_external', basis: 'bodyweight_external', implementCount: 0,
        holdingConfiguration: 'bodyweight_plus_external_load',
        minimumCanonicalKg: '0', maximumCanonicalKg: '20',
        bodyweightAssistancePolicy: { policyId: 'synthetic-rep-only.v1', policyVersion: '1' },
      }],
    }
    const candidate = TrainingCatalogV1Schema.parse({ ...catalog, exercises: [source, bodyweightTarget] })
    expect(resolveExerciseSwapAlternatives({
      catalog: candidate,
      profile: { ...profile, equipmentInventory: [{
        kind: 'bodyweight_external', equipmentId: 'bodyweight-home', unit: 'kg', externalLoads: ['0', '5'],
      }] },
      sourceExerciseVersionId: source.exerciseVersionId,
    })).toEqual([])
  })

  it('offers exact zero external load only with its context-bound dedicated policy', () => {
    const policyReference = { policyId: 'synthetic-rep-only.v1', policyVersion: '1' }
    const bodyweightTarget = {
      ...target,
      equipmentCompatibility: [{
        kind: 'bodyweight_external' as const, basis: 'bodyweight_external' as const,
        implementCount: 0 as const, holdingConfiguration: 'bodyweight_plus_external_load' as const,
        minimumCanonicalKg: '0', maximumCanonicalKg: '20', bodyweightAssistancePolicy: policyReference,
      }],
    }
    const candidate = TrainingCatalogV1Schema.parse({ ...catalog, exercises: [source, bodyweightTarget] })
    const dedicatedProfile = { ...profile, equipmentInventory: [{
      kind: 'bodyweight_external' as const, equipmentId: 'bodyweight-home', unit: 'kg' as const,
      externalLoads: ['0', '5', '25'],
    }] }
    const registry = { resolve: () => ({
      schemaVersion: 'bodyweight-assistance-progression-policy.v1' as const,
      policyId: policyReference.policyId, policyVersion: policyReference.policyVersion,
      progressionMode: 'rep_only_same_benchmark' as const, loadBasis: 'bodyweight_external' as const,
      provenance: {
        kind: 'synthetic_fixture' as const, fixtureId: executionContext.fixtureId,
        fixtureHash: executionContext.fixtureHash, label: executionContext.label,
      },
    }) }
    expect(resolveExerciseSwapAlternatives({
      catalog: candidate, profile: dedicatedProfile, sourceExerciseVersionId: source.exerciseVersionId,
      executionContext, bodyweightAssistancePolicyRegistry: registry,
    })[0]?.loadOptions).toEqual([
      expect.objectContaining({
        optionIndex: 0, loadBasis: 'bodyweight_external', implementCount: 0,
        holdingConfiguration: 'bodyweight_plus_external_load', bodyweightAssistancePolicy: policyReference,
        quantity: createLoadQuantity({ value: '0', unit: 'kg' }),
      }),
      expect.objectContaining({ optionIndex: 1, quantity: createLoadQuantity({ value: '5', unit: 'kg' }) }),
    ])
    expect(resolveExerciseSwapAlternatives({
      catalog: candidate, profile: dedicatedProfile, sourceExerciseVersionId: source.exerciseVersionId,
      executionContext: { ...executionContext, fixtureHash: 'b'.repeat(64) },
      bodyweightAssistancePolicyRegistry: registry,
    })).toEqual([])
  })

  it('bounds assistance options to the exact machine and reviewed policy range', () => {
    const policyReference = { policyId: 'synthetic-assistance-only.v1', policyVersion: '1' }
    const assistanceTarget = {
      ...target,
      equipmentCompatibility: [{
        kind: 'assistance_machine' as const, basis: 'machine_assistance' as const,
        implementCount: 1 as const, holdingConfiguration: 'machine_assistance' as const,
        minimumCanonicalKg: '10', maximumCanonicalKg: '50', bodyweightAssistancePolicy: policyReference,
      }],
    }
    const candidate = TrainingCatalogV1Schema.parse({ ...catalog, exercises: [source, assistanceTarget] })
    const dedicatedProfile = { ...profile, equipmentInventory: [{
      kind: 'assistance_machine' as const, equipmentId: 'assist-1', unit: 'kg' as const,
      assistanceLoads: ['5', '20', '40', '70'],
    }] }
    const registry = { resolve: () => ({
      schemaVersion: 'bodyweight-assistance-progression-policy.v1' as const,
      policyId: policyReference.policyId, policyVersion: policyReference.policyVersion,
      progressionMode: 'rep_only_same_benchmark' as const, loadBasis: 'machine_assistance' as const,
      supportedAssistanceRange: {
        equipmentId: 'assist-1', minimum: createLoadQuantity({ value: '5', unit: 'kg' }),
        maximum: createLoadQuantity({ value: '60', unit: 'kg' }),
      },
      provenance: {
        kind: 'synthetic_fixture' as const, fixtureId: executionContext.fixtureId,
        fixtureHash: executionContext.fixtureHash, label: executionContext.label,
      },
    }) }
    expect(resolveExerciseSwapAlternatives({
      catalog: candidate, profile: dedicatedProfile, sourceExerciseVersionId: source.exerciseVersionId,
      executionContext, bodyweightAssistancePolicyRegistry: registry,
    })[0]?.loadOptions).toEqual([
      expect.objectContaining({
        optionIndex: 0, loadBasis: 'machine_assistance', bodyweightAssistancePolicy: policyReference,
        quantity: createLoadQuantity({ value: '20', unit: 'kg' }),
      }),
      expect.objectContaining({ optionIndex: 1, quantity: createLoadQuantity({ value: '40', unit: 'kg' }) }),
    ])
    expect(resolveExerciseSwapAlternatives({
      catalog: candidate, profile: dedicatedProfile, sourceExerciseVersionId: source.exerciseVersionId,
      executionContext, bodyweightAssistancePolicyRegistry: { resolve: () => null },
    })).toEqual([])
  })

  it('returns only explicitly linked, reviewed-fixture alternatives and exact achievable loads', () => {
    expect(resolveExerciseSwapAlternatives({
      catalog, profile, sourceExerciseVersionId: source.exerciseVersionId,
    })).toEqual([expect.objectContaining({
      exercise: expect.objectContaining({ exerciseVersionId: target.exerciseVersionId }),
      trainingIntentId: 'synthetic-horizontal-pull', differences: difference,
      loadOptions: [
        expect.objectContaining({ optionIndex: 0, equipmentId: 'db-home', quantity: { entered: { value: '2', unit: 'kg' }, canonicalKg: '2' } }),
        expect.objectContaining({ optionIndex: 1, equipmentId: 'db-home', quantity: { entered: { value: '5', unit: 'kg' }, canonicalKg: '5' } }),
        expect.objectContaining({ optionIndex: 2, equipmentId: 'db-home', quantity: { entered: { value: '10', unit: 'kg' }, canonicalKg: '10' } }),
      ],
    })])
  })

  it('rejects a cross-intent link, unreviewed target, or inventory mismatch', () => {
    const altered = (replacement: unknown) => ({ ...catalog, exercises: [source, replacement] })
    expect(TrainingCatalogV1Schema.safeParse(altered({
      ...target, swap: { ...target.swap, trainingIntentId: 'synthetic-other-intent' },
    })).success).toBe(false)
    expect(resolveExerciseSwapAlternatives({
      catalog: altered({ ...target, contentReviewStatus: 'unreviewed' }), profile,
      sourceExerciseVersionId: source.exerciseVersionId,
    })).toEqual([])
    expect(resolveExerciseSwapAlternatives({
      catalog, profile: { ...profile, equipmentInventory: [] },
      sourceExerciseVersionId: source.exerciseVersionId,
    })).toEqual([])
  })

  it('requires every authored replacement warm-up load to be exactly representable', () => {
    expect(resolveExerciseSwapAlternatives({
      catalog: {
        ...catalog,
        exercises: [source, {
          ...target,
          warmupSets: [{ targetReps: 8, load: { value: '7.5', unit: 'kg' } }],
        }],
      },
      profile,
      sourceExerciseVersionId: source.exerciseVersionId,
    })).toEqual([])

    expect(resolveExerciseSwapAlternatives({
      catalog: {
        ...catalog,
        exercises: [source, {
          ...target,
          warmupSets: [{ targetReps: 8, load: { value: '5', unit: 'kg' } }],
        }],
      },
      profile,
      sourceExerciseVersionId: source.exerciseVersionId,
    })).toHaveLength(1)
  })

  it('rejects duplicate, missing, self, or cross-pattern catalog links', () => {
    for (const alternatives of [
      [source.swap.alternatives[0], source.swap.alternatives[0]],
      [{ ...source.swap.alternatives[0], exerciseVersionId: 'missing.v1' }],
      [{ ...source.swap.alternatives[0], exerciseVersionId: source.exerciseVersionId }],
    ]) {
      expect(TrainingCatalogV1Schema.safeParse({
        ...catalog, exercises: [{ ...source, swap: { ...source.swap, alternatives } }, target],
      }).success).toBe(false)
    }
    expect(TrainingCatalogV1Schema.safeParse({
      ...catalog, exercises: [source, { ...target, movementPattern: 'push' }],
    }).success).toBe(false)
  })
})

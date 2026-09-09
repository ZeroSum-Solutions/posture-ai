import { describe, expect, it } from 'vitest'
import { TrainingCatalogV1Schema, type EquipmentCompatibilityV1 } from '../catalog/types'
import { AthleteTrainingProfileV1Schema } from '../contracts/profile'
import { TrainingProgramRevisionV1Schema } from '../contracts/program'
import type { EquipmentInventory, EquipmentLoadBasis } from '../equipment'
import { createLoadQuantity } from '../quantity'
import {
  buildActiveCalibrationOffer,
  selectActiveCalibrationOption,
  type BuildActiveCalibrationInputV1,
} from './activeCalibration'

const fixtureHash = 'b'.repeat(64)
const programHash = 'c'.repeat(64)
const context = {
  kind: 'synthetic_simulation' as const,
  simulationRunId: '11111111-1111-4111-8111-111111111111',
  fixtureId: 'synthetic-active-calibration.v1', fixtureHash, label: 'Practice data' as const,
}
const origin = {
  kind: 'synthetic_fixture' as const, source: 'server_fixture' as const,
  fixtureId: context.fixtureId, fixtureHash, label: 'Synthetic active calibration catalog',
}
const policyReference = { policyId: 'synthetic-familiarization-policy.v1', policyVersion: '1' }

function configuration(basis: EquipmentLoadBasis) {
  if (basis === 'dumbbell_per_hand') return { implementCount: 2 as const, holdingConfiguration: 'one_per_hand' as const }
  if (basis === 'dumbbell_single_implement') return { implementCount: 1 as const, holdingConfiguration: 'two_hands_single_implement' as const }
  if (basis === 'bodyweight_external') return { implementCount: 0 as const, holdingConfiguration: 'bodyweight_plus_external_load' as const }
  if (basis === 'machine_assistance') return { implementCount: 1 as const, holdingConfiguration: 'machine_assistance' as const }
  if (basis === 'barbell_total') return { implementCount: 1 as const, holdingConfiguration: 'both_hands_barbell' as const }
  return { implementCount: 1 as const, holdingConfiguration: 'machine_defined' as const }
}

function compatibility(basis: EquipmentLoadBasis): EquipmentCompatibilityV1 {
  const bounds = { minimumCanonicalKg: '0', maximumCanonicalKg: basis === 'machine_assistance' ? '60' : '100' }
  if (basis === 'barbell_total') return { kind: 'barbell', basis, ...bounds }
  if (basis === 'dumbbell_per_hand') return {
    kind: 'dumbbell', basis, implementCount: 2, holdingConfiguration: 'one_per_hand', ...bounds,
  }
  if (basis === 'dumbbell_single_implement') return {
    kind: 'dumbbell', basis, implementCount: 1, holdingConfiguration: 'two_hands_single_implement', ...bounds,
  }
  if (basis === 'machine_stack') return { kind: 'machine', basis, ...bounds }
  if (basis === 'bodyweight_external') return {
    kind: 'bodyweight_external', basis, implementCount: 0, holdingConfiguration: 'bodyweight_plus_external_load',
    bodyweightAssistancePolicy: policyReference, ...bounds,
  }
  return {
    kind: 'assistance_machine', basis, implementCount: 1, holdingConfiguration: 'machine_assistance',
    bodyweightAssistancePolicy: policyReference, minimumCanonicalKg: '10', maximumCanonicalKg: '60',
  }
}

function inputFor(
  basis: EquipmentLoadBasis,
  currentValue: string,
  inventory: EquipmentInventory,
): BuildActiveCalibrationInputV1 {
  const exerciseVersionId = `synthetic-${basis}.v1`
  const catalog = TrainingCatalogV1Schema.parse({
    schemaVersion: 'training-catalog.v1', catalogVersion: context.fixtureId, origin,
    exercises: [{
      exerciseId: `synthetic-${basis}`, exerciseVersionId,
      label: `Synthetic ${basis} exercise`, movementPattern: 'push', role: 'primary',
      preferenceRank: 0, lifecycle: 'active', contentReviewStatus: 'reviewed_fixture', mediaStatus: 'missing',
      preparationSeconds: 30, secondsPerRep: 4,
      textInstruction: 'Use the exact synthetic practice setup.',
      progressionDefaults: {
        side: 'bilateral', rom: 'catalog_default', tempo: 'self_selected_controlled', exposureType: 'standard',
      },
      equipmentCompatibility: [compatibility(basis)],
    }],
    conditioningModes: [{
      modalityId: 'synthetic-walking.v1', label: 'Synthetic walking', preferenceRank: 0,
      lifecycle: 'active', contentReviewStatus: 'reviewed_fixture', effortCue: 'Synthetic comfortable pace.',
    }],
  })
  const quantity = createLoadQuantity({ value: currentValue, unit: inventory.unit })
  const program = TrainingProgramRevisionV1Schema.parse({
    schemaVersion: 'training-program-revision.v1', assignmentId: 'assignment-1', revisionNumber: 2,
    subjectId: 'subject-1', programMode: 'self_directed', owningPractitionerId: null,
    executionContext: context, cycleStartLocalDate: '2030-01-07', cycleLengthWeeks: 4,
    profileRevisionId: '3', eligibilitySourceRevisionId: 'eligibility-3',
    compilerPolicyVersion: 'strength-cycle-compiler.v3', catalogVersion: catalog.catalogVersion,
    catalogOrigin: origin, ruleVersion: 'rules-1', compiledProgramRevisionId: 'compiled-1',
    publishedAt: '2026-09-09T18:00:00.000Z', author: { kind: 'system', userId: null },
    sessions: [{
      sessionId: 'session-2', scheduledLocalDate: '2030-01-10', athleteTimezone: 'America/Los_Angeles',
      exercises: [{
        exerciseInstanceId: 'exercise-2', exerciseVersionId, setIds: ['set-1', 'set-2'],
        repRange: { minimum: 6, maximum: 10 }, targetRir: { minimum: 2, maximum: 3 }, restSeconds: 120,
        progression: {
          progressionSeriesId: 'series-push', side: 'bilateral', rom: 'catalog_default',
          tempo: 'self_selected_controlled', exposureType: 'standard', loadEpoch: 2,
        },
        acceptedInitialLoad: {
          status: 'accepted', acceptanceId: 'acceptance-1', acceptedAt: '2026-09-09T17:00:00.000Z',
          acceptedByUserId: 'user-1', source: 'equipment_inventory', executionContext: context,
          exerciseInstanceId: 'exercise-2', exerciseVersionId, equipmentId: inventory.equipmentId,
          provenance: {
            profileRevisionId: '3', compiledProgramRevisionId: 'compiled-1',
            catalogVersion: catalog.catalogVersion, catalogOrigin: origin,
          },
          ...(basis === 'bodyweight_external' || basis === 'machine_assistance'
            ? { bodyweightAssistancePolicy: policyReference }
            : {}),
          loadBasis: basis, ...configuration(basis), quantity,
        },
      }],
    }],
    conditioningBouts: [{
      status: 'accepted', acceptanceId: 'conditioning-acceptance-1',
      acceptedAt: '2026-09-09T17:00:00.000Z', acceptedByUserId: 'user-1', executionContext: context,
      boutId: 'bout-1', modalityId: 'synthetic-walking.v1', scheduledLocalDate: '2030-01-08',
      athleteTimezone: 'America/Los_Angeles', acceptedDurationSeconds: 600,
      effortCue: 'Synthetic comfortable pace.', scheduleArrangement: { kind: 'separate' },
      source: {
        compiledProgramRevisionId: 'compiled-1', compilerPolicyVersion: 'strength-cycle-compiler.v3',
        catalogVersion: catalog.catalogVersion, catalogOrigin: origin,
      },
    }],
  })
  const profile = AthleteTrainingProfileV1Schema.parse({
    schemaVersion: 'athlete-training-profile.v1',
    origin: { kind: 'synthetic_fixture', fixtureId: context.fixtureId, label: 'Synthetic active calibration profile' },
    goal: 'general_fitness', experience: 'beginner', recentConsistency: 'consistent', cycleLengthWeeks: 4,
    strengthDays: ['monday', 'thursday'], localTimezone: 'America/Los_Angeles', sessionTimeBudgetMinutes: 30,
    preferredLoadUnit: inventory.unit, equipmentInventory: [inventory], startingHistory: [],
  })
  return {
    program, sourceProgramHash: programHash, currentProfileRevisionId: '3', currentProfile: profile,
    currentEligibility: {
      state: 'eligible_general' as const,
      scope: 'supported' as const,
      policyVersion: 'synthetic-policy.v1',
      sourceRevisionId: 'eligibility-3',
      source: {
        kind: 'synthetic_fixture' as const,
        sourceVersion: 'synthetic-eligibility-fixture.v1' as const,
        fixtureId: context.fixtureId,
        label: 'Synthetic active calibration fixture',
      },
      effectiveFrom: '2026-09-01T00:00:00.000Z',
      effectiveUntil: null,
      supersededAt: null,
    },
    evaluatedAt: '2026-09-09T12:00:00.000Z',
    target: {
      sessionId: 'session-2', exerciseInstanceId: 'exercise-2',
      sessionState: 'scheduled', prescriptionState: 'unprescribed',
    },
    catalogRegistry: { resolve: () => structuredClone(catalog) },
    bodyweightAssistancePolicyRegistry: {
      resolve: () => basis === 'machine_assistance'
        ? {
            schemaVersion: 'bodyweight-assistance-progression-policy.v1', ...policyReference,
            loadBasis: basis, progressionMode: 'rep_only_same_benchmark',
            provenance: {
              kind: 'synthetic_fixture', fixtureId: context.fixtureId,
              fixtureHash: context.fixtureHash, label: context.label,
            },
            supportedAssistanceRange: {
              equipmentId: inventory.equipmentId,
              minimum: createLoadQuantity({ value: '10', unit: inventory.unit }),
              maximum: createLoadQuantity({ value: '60', unit: inventory.unit }),
            },
          }
        : {
            schemaVersion: 'bodyweight-assistance-progression-policy.v1', ...policyReference,
            loadBasis: 'bodyweight_external', progressionMode: 'rep_only_same_benchmark',
            provenance: {
              kind: 'synthetic_fixture', fixtureId: context.fixtureId,
              fixtureHash: context.fixtureHash, label: context.label,
            },
          },
    },
  }
}

function withWarmup(
  input: BuildActiveCalibrationInputV1,
  value: string,
): BuildActiveCalibrationInputV1 {
  const sourceSession = input.program.sessions[0]
  const sourceExercise = sourceSession.exercises[0]
  return {
    ...input,
    program: TrainingProgramRevisionV1Schema.parse({
      ...input.program,
      sessions: [{
        ...sourceSession,
        exercises: [{
          ...sourceExercise,
          warmupSets: [{
            setId: 'warmup-1', targetReps: 5,
            prescribedLoad: createLoadQuantity({
              value,
              unit: sourceExercise.acceptedInitialLoad.quantity.entered.unit,
            }),
          }],
        }],
      }],
    }),
  }
}

describe('active program familiarization calibration', () => {
  it.each([
    ['barbell_total', '60', { kind: 'barbell', equipmentId: 'bar-1', unit: 'kg', barWeight: '50', collarsTotalWeight: '0', plates: [{ value: '5', count: 2 }] }, ['50']],
    ['dumbbell_single_implement', '10', { kind: 'dumbbell', equipmentId: 'db-1', unit: 'kg', perHandLoads: ['5', '10', '12'] }, ['5']],
    ['machine_stack', '30', { kind: 'machine', equipmentId: 'machine-1', unit: 'kg', stackLoads: ['10', '20', '30', '40'] }, ['10', '20']],
  ] as const)('offers only exact lower %s settings without choosing one', (basis, current, inventory, expected) => {
    const offer = buildActiveCalibrationOffer(inputFor(basis, current, inventory))
    expect(offer).toMatchObject({
      kind: 'options', status: 'requires_explicit_selection',
      sourceBindings: {
        sourceProgramRevisionNumber: 2, sourceProgramHash: programHash,
        sourceProfileRevisionId: '3', sourceEligibilityRevisionId: 'eligibility-3',
        target: { sessionState: 'scheduled', prescriptionState: 'unprescribed' },
        priorProgressionSeriesId: 'series-push', priorLoadEpoch: 2,
      },
      seriesIntent: { kind: 'new_series_on_acceptance', nextLoadEpoch: 3 },
    })
    if (offer.kind !== 'options') return
    expect(offer.options.map(option => option.quantity.entered.value)).toEqual(expected)
    expect(offer.options.every(option => option.easierDirection === 'lower_resistance_or_external_load')).toBe(true)
    expect(offer.options.map(option => option.optionIndex)).toEqual(expected.map((_, index) => index))
  })

  it('treats higher assistance as easier while preserving exact assistance policy identity', () => {
    const input = inputFor('machine_assistance', '20', {
      kind: 'assistance_machine', equipmentId: 'assist-1', unit: 'kg', assistanceLoads: ['10', '20', '30', '40'],
    })
    const offer = buildActiveCalibrationOffer(input)
    expect(offer).toMatchObject({
      kind: 'options', bodyweightAssistancePolicy: policyReference,
      currentLoad: { basis: 'machine_assistance', quantity: { entered: { value: '20' } } },
    })
    if (offer.kind !== 'options') return
    expect(offer.options.map(option => option.quantity.entered.value)).toEqual(['30', '40'])
    expect(offer.options.every(option => option.easierDirection === 'higher_machine_assistance')).toBe(true)
  })

  it('preserves authored warm-ups and excludes settings that would make them harder than working sets', () => {
    const resistance = buildActiveCalibrationOffer(withWarmup(inputFor('machine_stack', '30', {
      kind: 'machine', equipmentId: 'machine-1', unit: 'kg', stackLoads: ['10', '20', '30'],
    }), '20'))
    expect(resistance.kind).toBe('options')
    if (resistance.kind === 'options') {
      expect(resistance.options.map(option => option.quantity.entered.value)).toEqual(['20'])
    }

    const assistance = buildActiveCalibrationOffer(withWarmup(inputFor('machine_assistance', '20', {
      kind: 'assistance_machine', equipmentId: 'assist-1', unit: 'kg', assistanceLoads: ['20', '30', '40'],
    }), '30'))
    expect(assistance.kind).toBe('options')
    if (assistance.kind === 'options') {
      expect(assistance.options.map(option => option.quantity.entered.value)).toEqual(['30'])
    }
  })

  it('returns no easier setting at zero external load and offers lower exact external loads otherwise', () => {
    const inventory = {
      kind: 'bodyweight_external' as const, equipmentId: 'bodyweight-1', unit: 'kg' as const,
      externalLoads: ['0', '2.5', '5'],
    }
    expect(buildActiveCalibrationOffer(inputFor('bodyweight_external', '0', inventory))).toMatchObject({
      kind: 'unavailable', status: 'not_offered', reason: 'no_easier_achievable_setting',
      currentLoad: { quantity: { entered: { value: '0' } } },
    })
    const offer = buildActiveCalibrationOffer(inputFor('bodyweight_external', '5', inventory))
    expect(offer.kind).toBe('options')
    if (offer.kind === 'options') {
      expect(offer.options.map(option => option.quantity.entered.value)).toEqual(['0', '2.5'])
    }
  })

  it('fails closed for stale source revisions, non-pending targets, and unavailable policy authority', () => {
    const input = inputFor('machine_assistance', '20', {
      kind: 'assistance_machine', equipmentId: 'assist-1', unit: 'kg', assistanceLoads: ['10', '20', '30'],
    })
    expect(() => buildActiveCalibrationOffer({ ...input, currentProfileRevisionId: '4' }))
      .toThrow('profile is stale')
    expect(() => buildActiveCalibrationOffer({
      ...input,
      currentEligibility: { ...input.currentEligibility, sourceRevisionId: 'eligibility-4' },
    }))
      .toThrow('eligibility source is stale')
    expect(() => buildActiveCalibrationOffer({
      ...input,
      target: { ...input.target, sessionState: 'in_progress' } as never,
    })).toThrow()
    expect(() => buildActiveCalibrationOffer({ ...input, bodyweightAssistancePolicyRegistry: undefined }))
      .toThrow('policy is unavailable')
  })

  it('rejects expired, superseded, unsupported, and cross-context eligibility', () => {
    const input = inputFor('barbell_total', '60', {
      kind: 'barbell', equipmentId: 'bar-1', unit: 'kg',
      barWeight: '50', collarsTotalWeight: '0', plates: [{ value: '5', count: 2 }],
    })
    expect(() => buildActiveCalibrationOffer({
      ...input,
      currentEligibility: { ...input.currentEligibility, effectiveUntil: '2026-09-08T12:00:00.000Z' },
    })).toThrow('eligibility is not current')
    expect(() => buildActiveCalibrationOffer({
      ...input,
      currentEligibility: { ...input.currentEligibility, supersededAt: '2026-09-09T11:00:00.000Z' },
    })).toThrow('eligibility is not current')
    expect(() => buildActiveCalibrationOffer({
      ...input,
      currentEligibility: { ...input.currentEligibility, scope: 'outside_release' },
    })).toThrow('eligibility is unavailable')
    expect(() => buildActiveCalibrationOffer({
      ...input,
      currentEligibility: {
        ...input.currentEligibility,
        source: {
          kind: 'synthetic_fixture', sourceVersion: 'synthetic-eligibility-fixture.v1',
          fixtureId: 'another-fixture', label: 'Synthetic active calibration fixture',
        },
      },
    })).toThrow('synthetic eligibility context does not match')
  })

  it('returns an explicit selection that remains unapplied and rejects unknown indices', () => {
    const offer = buildActiveCalibrationOffer(inputFor('dumbbell_per_hand', '10', {
      kind: 'dumbbell', equipmentId: 'db-1', unit: 'kg', perHandLoads: ['5', '10'],
    }))
    const requestId = '22222222-2222-4222-8222-222222222222'
    expect(selectActiveCalibrationOption(offer, { requestId, optionIndex: 0 })).toMatchObject({
      schemaVersion: 'active-calibration-selection.v1', status: 'selected_not_applied', requestId,
      selectedOption: { basis: 'dumbbell_per_hand', quantity: { entered: { value: '5', unit: 'kg' } } },
      seriesIntent: { kind: 'new_series_on_acceptance', nextLoadEpoch: 3 },
    })
    expect(() => selectActiveCalibrationOption(offer, { requestId, optionIndex: 1 }))
      .toThrow('was not offered')

    const assistanceOffer = buildActiveCalibrationOffer(inputFor('machine_assistance', '20', {
      kind: 'assistance_machine', equipmentId: 'assist-1', unit: 'kg', assistanceLoads: ['20', '30'],
    }))
    expect(selectActiveCalibrationOption(assistanceOffer, { requestId, optionIndex: 0 }))
      .toMatchObject({ bodyweightAssistancePolicy: policyReference, selectedOption: { basis: 'machine_assistance' } })
  })
})

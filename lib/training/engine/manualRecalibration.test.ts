import { describe, expect, it } from 'vitest'
import { TrainingCatalogV1Schema, type EquipmentCompatibilityV1 } from '../catalog/types'
import { AthleteTrainingProfileV1Schema } from '../contracts/profile'
import { TrainingProgramRevisionV1Schema } from '../contracts/program'
import type { EquipmentInventory, EquipmentLoadBasis } from '../equipment'
import { createLoadQuantity } from '../quantity'
import {
  buildManualRecalibrationOffer,
  selectManualRecalibrationOption,
  type BuildManualRecalibrationInputV1,
} from './manualRecalibration'

const fixtureHash = 'b'.repeat(64)
const programHash = 'c'.repeat(64)
const context = {
  kind: 'synthetic_simulation' as const,
  simulationRunId: '11111111-1111-4111-8111-111111111111',
  fixtureId: 'synthetic-manual-recalibration.v1', fixtureHash, label: 'Practice data' as const,
}
const origin = {
  kind: 'synthetic_fixture' as const, source: 'server_fixture' as const,
  fixtureId: context.fixtureId, fixtureHash, label: 'Synthetic manual recalibration catalog',
}
const policyReference = { policyId: 'synthetic-manual-recalibration-policy.v1', policyVersion: '1' }

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
): BuildManualRecalibrationInputV1 {
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
  const exercise = (exerciseInstanceId: string) => ({
    exerciseInstanceId, exerciseVersionId, setIds: [`${exerciseInstanceId}-set-1`, `${exerciseInstanceId}-set-2`],
    repRange: { minimum: 6, maximum: 10 }, targetRir: { minimum: 2, maximum: 3 }, restSeconds: 120,
    progression: {
      progressionSeriesId: 'series-push', side: 'bilateral' as const, rom: 'catalog_default',
      tempo: 'self_selected_controlled', exposureType: 'standard', loadEpoch: 2,
    },
    acceptedInitialLoad: {
      status: 'accepted' as const, acceptanceId: 'acceptance-1', acceptedAt: '2026-09-09T17:00:00.000Z',
      acceptedByUserId: 'user-1', source: 'equipment_inventory' as const, executionContext: context,
      exerciseInstanceId, exerciseVersionId, equipmentId: inventory.equipmentId,
      provenance: {
        profileRevisionId: '3', compiledProgramRevisionId: 'compiled-1',
        catalogVersion: catalog.catalogVersion, catalogOrigin: origin,
      },
      ...(basis === 'bodyweight_external' || basis === 'machine_assistance'
        ? { bodyweightAssistancePolicy: policyReference }
        : {}),
      loadBasis: basis, ...configuration(basis), quantity,
    },
  })
  const program = TrainingProgramRevisionV1Schema.parse({
    schemaVersion: 'training-program-revision.v1', assignmentId: 'assignment-1', revisionNumber: 2,
    subjectId: 'subject-1', programMode: 'self_directed', owningPractitionerId: null,
    executionContext: context, cycleStartLocalDate: '2030-01-07', cycleLengthWeeks: 4,
    profileRevisionId: '3', eligibilitySourceRevisionId: 'eligibility-3',
    compilerPolicyVersion: 'strength-cycle-compiler.v3', catalogVersion: catalog.catalogVersion,
    catalogOrigin: origin, ruleVersion: 'rules-1', compiledProgramRevisionId: 'compiled-1',
    publishedAt: '2026-09-09T18:00:00.000Z', author: { kind: 'system', userId: null },
    sessions: [
      {
        sessionId: 'session-1', scheduledLocalDate: '2030-01-07', athleteTimezone: 'America/Los_Angeles',
        exercises: [exercise('exercise-1')],
      },
      {
        sessionId: 'session-2', scheduledLocalDate: '2030-01-10', athleteTimezone: 'America/Los_Angeles',
        exercises: [exercise('exercise-2')],
      },
    ],
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
    origin: { kind: 'synthetic_fixture', fixtureId: context.fixtureId, label: 'Synthetic manual recalibration profile' },
    goal: 'general_fitness', experience: 'beginner', recentConsistency: 'consistent', cycleLengthWeeks: 4,
    strengthDays: ['monday', 'thursday'], localTimezone: 'America/Los_Angeles', sessionTimeBudgetMinutes: 30,
    preferredLoadUnit: inventory.unit, equipmentInventory: [inventory], startingHistory: [],
  })
  return {
    program, sourceProgramHash: programHash, currentProfileRevisionId: '3', currentProfile: profile,
    currentEligibility: {
      state: 'eligible_general', scope: 'supported', policyVersion: 'synthetic-policy.v1',
      sourceRevisionId: 'eligibility-3',
      source: {
        kind: 'synthetic_fixture', sourceVersion: 'synthetic-eligibility-fixture.v1',
        fixtureId: context.fixtureId, label: 'Synthetic manual recalibration fixture',
      },
      effectiveFrom: '2026-09-01T00:00:00.000Z', effectiveUntil: null, supersededAt: null,
    },
    evaluatedAt: '2026-09-09T19:00:00.000Z',
    sourceDecision: {
      decisionIdentity: 'decision-too-easy-1', reason: 'effort_too_easy_recalibration',
      sourceSessionId: 'session-1', sourceExerciseInstanceId: 'exercise-1',
      sourceSessionRevision: 4, sourceSessionState: 'completed', sourceExposureRevisionIds: ['log-1:2'],
      lastComparableActualLoad: {
        equipmentId: inventory.equipmentId, basis, quantity,
      },
    },
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

function withWarmup(input: BuildManualRecalibrationInputV1, value: string) {
  const sessions = input.program.sessions.map(session => ({
    ...session,
    exercises: session.exercises.map(exercise => ({
      ...exercise,
      warmupSets: [{
        setId: `${exercise.exerciseInstanceId}-warmup-1`, targetReps: 5,
        prescribedLoad: createLoadQuantity({
          value, unit: exercise.acceptedInitialLoad.quantity.entered.unit,
        }),
      }],
    })),
  }))
  return { ...input, program: TrainingProgramRevisionV1Schema.parse({ ...input.program, sessions }) }
}

describe('manual too-easy recalibration', () => {
  it('offers every exact harder resistance setting without selecting one and marks the exact outlier boundary', () => {
    const offer = buildManualRecalibrationOffer(inputFor('machine_stack', '60', {
      kind: 'machine', equipmentId: 'machine-1', unit: 'kg', stackLoads: ['50', '60', '70', '72', '73', '75'],
    }))
    expect(offer).toMatchObject({
      kind: 'options', status: 'requires_explicit_selection',
      sourceBindings: {
        sourceDecision: {
          reason: 'effort_too_easy_recalibration', sourceSessionId: 'session-1',
          sourceSessionRevision: 4, sourceExposureRevisionIds: ['log-1:2'],
        },
      },
      seriesIntent: {
        reason: 'explicit_too_easy_recalibration', sourceProgressionSeriesId: 'series-push',
        sourceLoadEpoch: 2, nextLoadEpoch: 3,
      },
    })
    if (offer.kind !== 'options') return
    expect(offer.options.map(option => option.quantity.entered.value)).toEqual(['70', '72', '73', '75'])
    expect(offer.options.map(option => option.confirmation.outlierDisposition)).toEqual([
      'within_20_percent', 'within_20_percent',
      'greater_than_20_percent_acknowledgement_required',
      'greater_than_20_percent_acknowledgement_required',
    ])
    expect(offer.options.every(option => option.harderDirection === 'higher_resistance_or_external_load')).toBe(true)

    const differentActualBaseline = buildManualRecalibrationOffer({
      ...inputFor('machine_stack', '60', {
        kind: 'machine', equipmentId: 'machine-1', unit: 'kg', stackLoads: ['50', '60', '70'],
      }),
      sourceDecision: {
        ...inputFor('machine_stack', '60', {
          kind: 'machine', equipmentId: 'machine-1', unit: 'kg', stackLoads: ['50', '60', '70'],
        }).sourceDecision,
        lastComparableActualLoad: {
          equipmentId: 'machine-1', basis: 'machine_stack',
          quantity: createLoadQuantity({ value: '50', unit: 'kg' }),
        },
      },
    })
    expect(differentActualBaseline.kind).toBe('options')
    if (differentActualBaseline.kind === 'options') {
      expect(differentActualBaseline.options[0].confirmation.outlierDisposition)
        .toBe('greater_than_20_percent_acknowledgement_required')
    }
  })

  it('treats lower exact assistance as harder and does not apply the external-load outlier ratio', () => {
    const offer = buildManualRecalibrationOffer(inputFor('machine_assistance', '30', {
      kind: 'assistance_machine', equipmentId: 'assist-1', unit: 'kg', assistanceLoads: ['10', '20', '30', '40'],
    }))
    expect(offer.kind).toBe('options')
    if (offer.kind !== 'options') return
    expect(offer.options.map(option => option.quantity.entered.value)).toEqual(['10', '20'])
    expect(offer.options.every(option => (
      option.harderDirection === 'lower_machine_assistance'
      && option.confirmation.outlierDisposition === 'not_applicable_to_assistance'
    ))).toBe(true)
    expect(offer.bodyweightAssistancePolicy).toEqual(policyReference)
  })

  it('offers explicit positive external load from zero without dividing by zero', () => {
    const offer = buildManualRecalibrationOffer(inputFor('bodyweight_external', '0', {
      kind: 'bodyweight_external', equipmentId: 'bodyweight-1', unit: 'kg', externalLoads: ['0', '2.5', '5'],
    }))
    expect(offer.kind).toBe('options')
    if (offer.kind !== 'options') return
    expect(offer.options.map(option => [
      option.quantity.entered.value, option.confirmation.outlierDisposition,
    ])).toEqual([
      ['2.5', 'zero_prior_requires_calibration_confirmation'],
      ['5', 'zero_prior_requires_calibration_confirmation'],
    ])
  })

  it('preserves authored warmups and rejects a setting that would make a warmup harder than the working target', () => {
    const offer = buildManualRecalibrationOffer(withWarmup(inputFor('machine_stack', '20', {
      kind: 'machine', equipmentId: 'machine-1', unit: 'kg', stackLoads: ['20', '25', '30', '40'],
    }), '30'))
    expect(offer.kind).toBe('options')
    if (offer.kind !== 'options') return
    expect(offer.options.map(option => option.quantity.entered.value)).toEqual(['30', '40'])
  })

  it('fails closed for a mismatched source series, stale eligibility, and unavailable dedicated policy', () => {
    const base = inputFor('machine_assistance', '30', {
      kind: 'assistance_machine', equipmentId: 'assist-1', unit: 'kg', assistanceLoads: ['10', '20', '30'],
    })
    const sourceProgram = structuredClone(base.program)
    sourceProgram.sessions[0].exercises[0].progression!.progressionSeriesId = 'another-series'
    expect(() => buildManualRecalibrationOffer({ ...base, program: sourceProgram })).toThrow(/source/i)
    expect(() => buildManualRecalibrationOffer({
      ...base,
      currentEligibility: { ...base.currentEligibility, sourceRevisionId: 'old-eligibility' },
    })).toThrow(/eligibility/i)
    expect(() => buildManualRecalibrationOffer({
      ...base, bodyweightAssistancePolicyRegistry: { resolve: () => null },
    })).toThrow(/policy/i)
  })

  it('returns unavailable when there is no harder setting and records an explicit choice as unapplied', () => {
    const unavailable = buildManualRecalibrationOffer(inputFor('machine_stack', '40', {
      kind: 'machine', equipmentId: 'machine-1', unit: 'kg', stackLoads: ['20', '40'],
    }))
    expect(unavailable).toMatchObject({
      kind: 'unavailable', status: 'not_offered', reason: 'no_harder_achievable_setting',
    })

    const offer = buildManualRecalibrationOffer(inputFor('machine_stack', '20', {
      kind: 'machine', equipmentId: 'machine-1', unit: 'kg', stackLoads: ['20', '30'],
    }))
    const selection = selectManualRecalibrationOption(offer, {
      requestId: '22222222-2222-4222-8222-222222222222', optionIndex: 0,
    })
    expect(selection).toMatchObject({
      status: 'selected_not_applied', selectedOption: { quantity: { entered: { value: '30' } } },
      seriesIntent: { reason: 'explicit_too_easy_recalibration', nextLoadEpoch: 3 },
    })
    expect(Object.isFrozen(selection)).toBe(true)
    expect(() => selectManualRecalibrationOption(offer, {
      requestId: '33333333-3333-4333-8333-333333333333', optionIndex: 1,
    })).toThrow(/not offered/i)
  })
})

import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from '../quantity'
import {
  AcceptedInitialLoadV1Schema,
  ExecutionContextV1Schema,
  TrainingProgramRevisionV1Schema,
} from './program'

const live = { kind: 'live' } as const
const synthetic = {
  kind: 'synthetic_simulation', simulationRunId: '11111111-1111-4111-8111-111111111111', fixtureId: 'starter-v1',
  fixtureHash: 'a'.repeat(64), label: 'Practice data',
} as const

const acceptedLoad = {
  status: 'accepted', acceptanceId: 'accept-1', acceptedAt: '2026-09-08T01:00:00Z',
  acceptedByUserId: 'athlete-1', source: 'equipment_inventory', executionContext: live,
  exerciseInstanceId: 'exercise-1', exerciseVersionId: 'goblet-squat.v1', equipmentId: 'db-set-1',
  provenance: { profileRevisionId: '1', compiledProgramRevisionId: 'compiled-program-1', catalogVersion: 'starter.v1', catalogOrigin: { kind: 'authored_catalog' } },
  loadBasis: 'dumbbell_single_implement', implementCount: 1,
  holdingConfiguration: 'two_hands_single_implement', quantity: createLoadQuantity({ value: '10', unit: 'kg' }),
} as const

const acceptedBout = {
  status: 'accepted', acceptanceId: 'conditioning-accept-1', acceptedAt: '2026-09-08T01:00:00Z',
  acceptedByUserId: 'athlete-1', executionContext: live, boutId: 'bout-1',
  modalityId: 'walking.v1', scheduledLocalDate: '2026-09-09', athleteTimezone: 'America/Los_Angeles',
  acceptedDurationSeconds: 600, effortCue: 'Easy to moderate; maintain the talk test.',
  source: { compiledProgramRevisionId: 'compiled-program-1', compilerPolicyVersion: 'eight-week-compiler.v1', catalogVersion: 'starter.v1', catalogOrigin: { kind: 'authored_catalog' } },
} as const

const acceptedBoutWithEvidenceIdentity = {
  ...acceptedBout,
  progressionIdentity: { progressionSeriesId: 'conditioning-walking', evidenceEpoch: 2 },
} as const

const progression = {
  progressionSeriesId: 'strength-slot:knee_dominant', side: 'bilateral', rom: 'catalog_default',
  tempo: 'self_selected_controlled', exposureType: 'standard', loadEpoch: 1,
} as const

const syntheticTemplate = {
  schemaVersion: 'strength-template.v1', style: 'intermediate_undulating',
  templateId: 'intermediate-undulating', templateVersion: 'intermediate-undulating.v1',
  provenance: {
    kind: 'synthetic_fixture', fixtureId: synthetic.fixtureId,
    fixtureHash: synthetic.fixtureHash, label: synthetic.label,
  },
  heavy: {
    exposureType: 'heavy', repRange: { minimum: 6, maximum: 8 },
    targetRir: { minimum: 2, maximum: 3 }, restSeconds: 180,
  },
  volume: {
    exposureType: 'volume', repRange: { minimum: 10, maximum: 12 },
    targetRir: { minimum: 2, maximum: 3 }, restSeconds: 120,
  },
} as const

function revision(
  cycleLengthWeeks: 4 | 6 | 8 | 12 = 8,
  compilerPolicyVersion = cycleLengthWeeks === 8
    ? 'eight-week-compiler.v1'
    : 'strength-cycle-compiler.v3',
) {
  return {
    schemaVersion: 'training-program-revision.v1', assignmentId: 'assignment-1', revisionNumber: 1,
    subjectId: 'subject-1', programMode: 'self_directed', owningPractitionerId: null,
    executionContext: live, cycleStartLocalDate: '2026-09-08', cycleLengthWeeks,
    profileRevisionId: '1', eligibilitySourceRevisionId: 'eligibility-1',
    compilerPolicyVersion, catalogVersion: 'starter.v1',
    catalogOrigin: { kind: 'authored_catalog' }, ruleVersion: 'rules.v1',
    compiledProgramRevisionId: 'compiled-program-1',
    publishedAt: '2026-09-08T01:00:00Z', author: { kind: 'athlete', userId: 'athlete-1' },
    sessions: [{
      sessionId: 'session-1', sessionType: 'full_body', scheduledLocalDate: '2026-09-08', athleteTimezone: 'America/Los_Angeles',
      exercises: [{
        exerciseInstanceId: 'exercise-1', exerciseVersionId: 'goblet-squat.v1', movementPattern: 'knee_dominant',
        setIds: ['set-1', 'set-2'],
        repRange: { minimum: 8, maximum: 12 }, targetRir: { minimum: 2, maximum: 3 }, restSeconds: 120,
        progression,
        acceptedInitialLoad: acceptedLoad,
      }],
    }],
    conditioningBouts: [acceptedBout],
  } as const
}

describe('conditioning evidence identity', () => {
  it('preserves legacy bouts while validating a bounded optional series and epoch', () => {
    expect(TrainingProgramRevisionV1Schema.safeParse(revision()).success).toBe(true)
    expect(TrainingProgramRevisionV1Schema.safeParse({
      ...revision(), conditioningBouts: [acceptedBoutWithEvidenceIdentity],
    }).success).toBe(true)
    expect(TrainingProgramRevisionV1Schema.safeParse({
      ...revision(), conditioningBouts: [{
        ...acceptedBout, progressionIdentity: { progressionSeriesId: 'walking', evidenceEpoch: -1 },
      }],
    }).success).toBe(false)
  })

  it('binds paired strength-first policy to the exact modality and execution context', () => {
    const paired = {
      ...acceptedBoutWithEvidenceIdentity,
      scheduleArrangement: {
        kind: 'paired_strength_first',
        pairingPolicy: {
          schemaVersion: 'conditioning-pairing-policy.v1', modalityId: acceptedBout.modalityId,
          catalogVersion: acceptedBout.source.catalogVersion,
          pairing: 'moderate_strength_first_allowed',
          provenance: {
            kind: 'reviewed_authored_policy', policyRecordId: 'pairing-policy-1',
            reviewRecordId: 'pairing-review-1', reviewedAt: '2026-09-08T01:00:00Z',
          },
        },
      },
    } as const
    expect(TrainingProgramRevisionV1Schema.safeParse({
      ...revision(), conditioningBouts: [paired],
    }).success).toBe(true)
    expect(TrainingProgramRevisionV1Schema.safeParse({
      ...revision(), conditioningBouts: [{
        ...paired, scheduleArrangement: {
          ...paired.scheduleArrangement,
          pairingPolicy: { ...paired.scheduleArrangement.pairingPolicy, modalityId: 'cycling.v1' },
        },
      }],
    }).success).toBe(false)
  })
})

describe('program contracts', () => {
  it('keeps synthetic execution context explicit and requires a UUID run identity', () => {
    expect(ExecutionContextV1Schema.parse(synthetic)).toEqual(synthetic)
    expect(() => ExecutionContextV1Schema.parse({ ...synthetic, simulationRunId: 'sim-1' })).toThrow()
    expect(() => ExecutionContextV1Schema.parse({ ...synthetic, label: 'Workout' })).toThrow()
    expect(() => ExecutionContextV1Schema.parse({ ...synthetic, athleteUserId: 'forged' })).toThrow()
  })

  it('distinguishes a one-dumbbell goblet load from a paired per-hand load', () => {
    expect(AcceptedInitialLoadV1Schema.parse(acceptedLoad)).toMatchObject({
      exerciseInstanceId: 'exercise-1', loadBasis: 'dumbbell_single_implement', implementCount: 1,
      holdingConfiguration: 'two_hands_single_implement', quantity: { canonicalKg: '10' },
    })
    expect(() => AcceptedInitialLoadV1Schema.parse({
      ...acceptedLoad, loadBasis: 'dumbbell_per_hand', implementCount: 1,
      holdingConfiguration: 'two_hands_single_implement',
    })).toThrow()
    expect(() => AcceptedInitialLoadV1Schema.parse({
      ...acceptedLoad, quantity: { ...acceptedLoad.quantity, canonicalKg: '20' },
    })).toThrow()
  })

  it('requires exact dedicated policy identity for bodyweight-external and assistance loads', () => {
    const policy = { policyId: 'synthetic-bodyweight-rep-only.v1', policyVersion: '1' }
    const bodyweight = {
      ...acceptedLoad,
      equipmentId: 'bodyweight-station',
      loadBasis: 'bodyweight_external',
      implementCount: 0,
      holdingConfiguration: 'bodyweight_plus_external_load',
      bodyweightAssistancePolicy: policy,
      quantity: createLoadQuantity({ value: '0', unit: 'kg' }),
    }
    const assistance = {
      ...bodyweight,
      equipmentId: 'assisted-pullup-a',
      loadBasis: 'machine_assistance',
      implementCount: 1,
      holdingConfiguration: 'machine_assistance',
      quantity: createLoadQuantity({ value: '20', unit: 'kg' }),
    }

    expect(AcceptedInitialLoadV1Schema.parse(bodyweight)).toEqual(bodyweight)
    expect(AcceptedInitialLoadV1Schema.parse(assistance)).toEqual(assistance)
    expect(AcceptedInitialLoadV1Schema.safeParse({
      ...bodyweight, bodyweightAssistancePolicy: undefined,
    }).success).toBe(false)
    expect(AcceptedInitialLoadV1Schema.safeParse({
      ...acceptedLoad, bodyweightAssistancePolicy: policy,
    }).success).toBe(false)
  })

  it('validates a published program with bound loads and durable conditioning', () => {
    const value = revision()
    expect(TrainingProgramRevisionV1Schema.parse(value)).toEqual(value)
    expect(() => TrainingProgramRevisionV1Schema.parse({ ...value, programMode: 'coach_assigned' })).toThrow()
    expect(() => TrainingProgramRevisionV1Schema.parse({ ...value, sessions: [value.sessions[0], value.sessions[0]] })).toThrow()
  })

  it.each([
    [1_320, '20 to 22 minute progression'],
    [1_800, '29 to 30 minute progression'],
  ] as const)('keeps a persisted %s second bout readable after %s', (acceptedDurationSeconds, _label) => {
    const value = revision()
    const progressed = {
      ...value,
      conditioningBouts: [{ ...acceptedBout, acceptedDurationSeconds }],
    }
    expect(TrainingProgramRevisionV1Schema.parse(progressed).conditioningBouts[0].acceptedDurationSeconds)
      .toBe(acceptedDurationSeconds)
  })

  it('rejects a persisted conditioning target above 30 minutes', () => {
    const value = revision()
    expect(TrainingProgramRevisionV1Schema.safeParse({
      ...value,
      conditioningBouts: [{ ...acceptedBout, acceptedDurationSeconds: 1_801 }],
    }).success).toBe(false)
  })

  it.each([4, 6, 8, 12] as const)('accepts a published %s-week cycle', (cycleLengthWeeks) => {
    expect(TrainingProgramRevisionV1Schema.parse(revision(cycleLengthWeeks)).cycleLengthWeeks)
      .toBe(cycleLengthWeeks)
  })

  it.each(['eight-week-compiler.v1', 'eight-week-compiler.v2', 'strength-cycle-compiler.v3'] as const)(
    'accepts eight-week published provenance from %s',
    (compilerPolicyVersion) => {
      expect(TrainingProgramRevisionV1Schema.parse(revision(8, compilerPolicyVersion)).cycleLengthWeeks)
        .toBe(8)
    },
  )

  it.each([
    [4, 'eight-week-compiler.v1'],
    [6, 'eight-week-compiler.v2'],
    [12, 'unknown-cycle-compiler.v1'],
    [8, 'unknown-cycle-compiler.v1'],
  ] as const)('rejects %s-week published provenance from %s', (cycleLengthWeeks, compilerPolicyVersion) => {
    expect(() => TrainingProgramRevisionV1Schema.parse(
      revision(cycleLengthWeeks, compilerPolicyVersion),
    )).toThrow()
  })

  it.each([0, 5, 10, 16])('rejects unsupported published cycle length %s', (cycleLengthWeeks) => {
    expect(() => TrainingProgramRevisionV1Schema.parse({ ...revision(), cycleLengthWeeks })).toThrow()
  })

  it('accepts authored progression identity while keeping legacy prescriptions readable', () => {
    const value = revision()
    const parsed = TrainingProgramRevisionV1Schema.parse(value)
    expect(parsed.sessions[0]).toMatchObject({ sessionType: 'full_body' })
    expect(parsed.sessions[0].exercises[0]).toMatchObject({ movementPattern: 'knee_dominant', progression })
    const { progression: _progression, movementPattern: _movementPattern, ...legacyExercise } = value.sessions[0].exercises[0]
    const { sessionType: _sessionType, ...legacySession } = value.sessions[0]
    void _progression
    void _movementPattern
    void _sessionType
    expect(TrainingProgramRevisionV1Schema.parse({
      ...value,
      sessions: [{ ...legacySession, exercises: [legacyExercise] }],
    }).sessions[0].exercises[0].progression).toBeUndefined()
    expect(() => TrainingProgramRevisionV1Schema.parse({
      ...value,
      sessions: [{ ...value.sessions[0], exercises: [{ ...value.sessions[0].exercises[0], progression: { ...progression, loadEpoch: -1 } }] }],
    })).toThrow()
  })

  it('binds an intermediate undulating program to its immutable template and comparison track', () => {
    const value = revision()
    const syntheticOrigin = {
      kind: 'synthetic_fixture', source: 'server_fixture', fixtureId: synthetic.fixtureId,
      fixtureHash: synthetic.fixtureHash, label: 'Synthetic starter catalog',
    } as const
    const trackedExercise = {
      ...value.sessions[0].exercises[0],
      repRange: syntheticTemplate.heavy.repRange,
      targetRir: syntheticTemplate.heavy.targetRir,
      restSeconds: syntheticTemplate.heavy.restSeconds,
      progression: {
        ...progression,
        progressionSeriesId: 'strength-slot:knee_dominant:heavy',
        exposureType: 'heavy',
      },
      acceptedInitialLoad: {
        ...acceptedLoad,
        executionContext: synthetic,
        provenance: {
          ...acceptedLoad.provenance,
          catalogOrigin: syntheticOrigin,
        },
      },
    }
    const program = {
      ...value,
      executionContext: synthetic,
      strengthProgrammingStyle: 'intermediate_undulating',
      strengthTemplate: syntheticTemplate,
      compilerPolicyVersion: 'strength-cycle-compiler.v3',
      catalogOrigin: syntheticOrigin,
      sessions: [{ ...value.sessions[0], exercises: [trackedExercise] }],
      conditioningBouts: [{
        ...acceptedBout,
        executionContext: synthetic,
        source: { ...acceptedBout.source, catalogOrigin: syntheticOrigin },
      }],
    }
    expect(TrainingProgramRevisionV1Schema.parse(program)).toMatchObject({
      strengthProgrammingStyle: 'intermediate_undulating',
      strengthTemplate: { provenance: { fixtureId: synthetic.fixtureId } },
    })
    expect(TrainingProgramRevisionV1Schema.safeParse({ ...program, strengthTemplate: undefined }).success).toBe(false)
    expect(TrainingProgramRevisionV1Schema.safeParse({
      ...program,
      sessions: [{
        ...program.sessions[0],
        exercises: [{ ...trackedExercise, progression: { ...trackedExercise.progression, exposureType: 'standard' } }],
      }],
    }).success).toBe(false)
    expect(TrainingProgramRevisionV1Schema.safeParse({
      ...program,
      sessions: [{
        ...program.sessions[0],
        exercises: [{ ...trackedExercise, restSeconds: 120 }],
      }],
    }).success).toBe(false)
    expect(TrainingProgramRevisionV1Schema.safeParse({
      ...program,
      strengthTemplate: {
        ...syntheticTemplate,
        provenance: { ...syntheticTemplate.provenance, fixtureHash: 'b'.repeat(64) },
      },
    }).success).toBe(false)
  })

  it('preserves legacy absent style and prevents template provenance on repeatable programs', () => {
    const value = revision()
    expect(TrainingProgramRevisionV1Schema.parse(value).strengthProgrammingStyle).toBeUndefined()
    expect(TrainingProgramRevisionV1Schema.parse({
      ...value,
      strengthProgrammingStyle: 'repeatable',
    }).strengthProgrammingStyle).toBe('repeatable')
    expect(TrainingProgramRevisionV1Schema.safeParse({
      ...value,
      strengthProgrammingStyle: 'repeatable',
      strengthTemplate: syntheticTemplate,
    }).success).toBe(false)
  })

  it('keeps authored warm-up sets separate from working sets with exact load quantities', () => {
    const value = revision()
    const exercise = value.sessions[0].exercises[0]
    const warmupSets = [{
      setId: 'warmup-set-1',
      targetReps: 8,
      prescribedLoad: createLoadQuantity({ value: '2.50', unit: 'kg' }),
    }]
    const parsed = TrainingProgramRevisionV1Schema.parse({
      ...value,
      sessions: [{
        ...value.sessions[0],
        exercises: [{ ...exercise, warmupSets }],
      }],
    })

    expect(parsed.sessions[0].exercises[0]).toMatchObject({
      setIds: ['set-1', 'set-2'],
      warmupSets: [{ setId: 'warmup-set-1', targetReps: 8, prescribedLoad: { entered: { value: '2.50', unit: 'kg' } } }],
    })
    expect(() => TrainingProgramRevisionV1Schema.parse({
      ...value,
      sessions: [{
        ...value.sessions[0],
        exercises: [{ ...exercise, warmupSets: [{ ...warmupSets[0], setId: 'set-1' }] }],
      }],
    })).toThrow()
    expect(TrainingProgramRevisionV1Schema.parse(value).sessions[0].exercises[0].warmupSets)
      .toBeUndefined()
  })

  it('rejects cross-context catalog, load, exercise, and conditioning provenance', () => {
    const value = revision()
    expect(() => TrainingProgramRevisionV1Schema.parse({ ...value, catalogOrigin: { kind: 'synthetic_fixture', source: 'server_fixture', fixtureId: 'starter-v1', fixtureHash: 'a'.repeat(64), label: 'Synthetic' } })).toThrow()
    expect(() => TrainingProgramRevisionV1Schema.parse({ ...value, sessions: [{ ...value.sessions[0], exercises: [{ ...value.sessions[0].exercises[0], acceptedInitialLoad: { ...acceptedLoad, executionContext: synthetic } }] }] })).toThrow()
    expect(() => TrainingProgramRevisionV1Schema.parse({ ...value, sessions: [{ ...value.sessions[0], exercises: [{ ...value.sessions[0].exercises[0], acceptedInitialLoad: { ...acceptedLoad, exerciseInstanceId: 'other-exercise' } }] }] })).toThrow()
    expect(() => TrainingProgramRevisionV1Schema.parse({ ...value, sessions: [{ ...value.sessions[0], exercises: [{ ...value.sessions[0].exercises[0], acceptedInitialLoad: { ...acceptedLoad, provenance: { ...acceptedLoad.provenance, profileRevisionId: '2' } } }] }] })).toThrow()
    expect(() => TrainingProgramRevisionV1Schema.parse({ ...value, conditioningBouts: [{ ...acceptedBout, source: { ...acceptedBout.source, compiledProgramRevisionId: 'other-program' } }] })).toThrow()
  })
})

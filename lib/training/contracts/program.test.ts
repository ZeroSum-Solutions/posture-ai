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

const progression = {
  progressionSeriesId: 'strength-slot:knee_dominant', side: 'bilateral', rom: 'catalog_default',
  tempo: 'self_selected_controlled', exposureType: 'standard', loadEpoch: 1,
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

  it('validates a published program with bound loads and durable conditioning', () => {
    const value = revision()
    expect(TrainingProgramRevisionV1Schema.parse(value)).toEqual(value)
    expect(() => TrainingProgramRevisionV1Schema.parse({ ...value, programMode: 'coach_assigned' })).toThrow()
    expect(() => TrainingProgramRevisionV1Schema.parse({ ...value, sessions: [value.sessions[0], value.sessions[0]] })).toThrow()
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

  it('rejects cross-context catalog, load, exercise, and conditioning provenance', () => {
    const value = revision()
    expect(() => TrainingProgramRevisionV1Schema.parse({ ...value, catalogOrigin: { kind: 'synthetic_fixture', source: 'server_fixture', fixtureId: 'starter-v1', fixtureHash: 'a'.repeat(64), label: 'Synthetic' } })).toThrow()
    expect(() => TrainingProgramRevisionV1Schema.parse({ ...value, sessions: [{ ...value.sessions[0], exercises: [{ ...value.sessions[0].exercises[0], acceptedInitialLoad: { ...acceptedLoad, executionContext: synthetic } }] }] })).toThrow()
    expect(() => TrainingProgramRevisionV1Schema.parse({ ...value, sessions: [{ ...value.sessions[0], exercises: [{ ...value.sessions[0].exercises[0], acceptedInitialLoad: { ...acceptedLoad, exerciseInstanceId: 'other-exercise' } }] }] })).toThrow()
    expect(() => TrainingProgramRevisionV1Schema.parse({ ...value, sessions: [{ ...value.sessions[0], exercises: [{ ...value.sessions[0].exercises[0], acceptedInitialLoad: { ...acceptedLoad, provenance: { ...acceptedLoad.provenance, profileRevisionId: '2' } } }] }] })).toThrow()
    expect(() => TrainingProgramRevisionV1Schema.parse({ ...value, conditioningBouts: [{ ...acceptedBout, source: { ...acceptedBout.source, compiledProgramRevisionId: 'other-program' } }] })).toThrow()
  })
})

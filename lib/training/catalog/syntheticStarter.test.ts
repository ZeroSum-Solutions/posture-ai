import { describe, expect, it } from 'vitest'
import { TrainingCatalogV1Schema } from './types'
import {
  SYNTHETIC_STARTER_CATALOG,
  SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH,
  SYNTHETIC_STARTER_PROGRESSION_DEFAULTS,
} from './syntheticStarter'
import { compileEightWeekProgram } from '../engine/compileProgram'

describe('synthetic starter catalog', () => {
  it('is a server-owned, visibly synthetic exact-variant roster with truthful missing media', () => {
    expect(TrainingCatalogV1Schema.parse(SYNTHETIC_STARTER_CATALOG)).toEqual(SYNTHETIC_STARTER_CATALOG)
    expect(SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH)
      .toBe('ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717')
    expect(SYNTHETIC_STARTER_CATALOG.origin).toMatchObject({ kind: 'synthetic_fixture', source: 'server_fixture' })
    expect(SYNTHETIC_STARTER_CATALOG.exercises.every(exercise => exercise.mediaStatus === 'missing' && exercise.textInstruction)).toBe(true)
    expect(Object.keys(SYNTHETIC_STARTER_PROGRESSION_DEFAULTS)).toEqual(
      SYNTHETIC_STARTER_CATALOG.exercises.map(exercise => exercise.exerciseVersionId),
    )
  })

  it('distinguishes goblet single-implement load from paired dumbbell variants', () => {
    const [goblet, ...paired] = SYNTHETIC_STARTER_CATALOG.exercises
    expect(goblet.equipmentCompatibility[0]).toMatchObject({
      basis: 'dumbbell_single_implement', implementCount: 1, holdingConfiguration: 'two_hands_single_implement',
    })
    expect(paired.every((exercise) => {
      const compatibility = exercise.equipmentCompatibility[0]
      return compatibility.basis === 'dumbbell_per_hand' && compatibility.implementCount === 2
    })).toBe(true)
  })

  it('compiles a concrete simulation draft against explicit dumbbell inventory', () => {
    const result = compileEightWeekProgram({
      subjectId: 'synthetic-subject-1', profileRevisionId: 'synthetic-profile-1',
      programRevisionId: 'synthetic-program-1', cycleStartLocalDate: '2026-09-08',
      conditioningModalityId: 'synthetic-continuous-walking.v1', catalog: SYNTHETIC_STARTER_CATALOG,
      executionContext: {
        kind: 'synthetic_simulation', simulationRunId: '11111111-1111-4111-8111-111111111111', fixtureId: 'synthetic-starter-catalog.v1',
        fixtureHash: SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH, label: 'Practice data',
      },
      profile: {
        schemaVersion: 'athlete-training-profile.v1',
        origin: { kind: 'synthetic_fixture', fixtureId: 'synthetic-starter-catalog.v1', label: 'Synthetic starter profile' },
        goal: 'general_fitness', experience: 'beginner', recentConsistency: 'intermittent', cycleLengthWeeks: 8,
        strengthDays: ['tuesday', 'friday'], localTimezone: 'America/Los_Angeles', sessionTimeBudgetMinutes: 30,
        preferredLoadUnit: 'kg',
        equipmentInventory: [{ kind: 'dumbbell', equipmentId: 'synthetic-db-set', unit: 'kg', perHandLoads: ['2.5', '5', '7.5', '10'] }],
        startingHistory: [],
      },
    })
    expect(result.kind).toBe('draft_program')
    if (result.kind !== 'draft_program') return
    expect(result.weeks[0].strengthSessions[0].exercises).toHaveLength(4)
    expect(result.weeks[0].strengthSessions[0].exercises[0]).toMatchObject({
      exerciseVersionId: 'synthetic-goblet-squat.v1', loadBasis: 'dumbbell_single_implement', implementCount: 1,
    })
  })
})

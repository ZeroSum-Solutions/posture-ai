import { describe, expect, it } from 'vitest'
import { SYNTHETIC_STARTER_CATALOG, SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH } from '../catalog/syntheticStarter'
import type { AthleteTrainingProfileV1 } from './profile'
import { compileEightWeekProgram, type CompilationResultV1 } from '../engine/compileProgram'
import {
  acceptCompiledExerciseInitialLoad,
  buildCompiledExerciseInitialLoadCalibration,
} from './calibration'

const context = {
  kind: 'synthetic_simulation' as const,
  simulationRunId: '11111111-1111-4111-8111-111111111111',
  fixtureId: 'synthetic-starter-catalog.v1',
  fixtureHash: SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH,
  label: 'Simulation' as const,
}

function profile(): AthleteTrainingProfileV1 {
  return {
    schemaVersion: 'athlete-training-profile.v1',
    origin: { kind: 'synthetic_fixture', fixtureId: context.fixtureId, label: 'Synthetic starter profile' },
    goal: 'general_fitness', experience: 'beginner', recentConsistency: 'consistent', cycleLengthWeeks: 8,
    strengthDays: ['monday', 'thursday'], localTimezone: 'America/Los_Angeles', sessionTimeBudgetMinutes: 30,
    preferredLoadUnit: 'kg',
    equipmentInventory: [{ kind: 'dumbbell', equipmentId: 'db-set-1', unit: 'kg', perHandLoads: ['5', '10', '200'] }],
    startingHistory: [],
  }
}

function draft(): Extract<CompilationResultV1, { kind: 'draft_program' }> {
  const result = compileEightWeekProgram({
    subjectId: 'subject-1', profileRevisionId: '1', programRevisionId: 'program-1',
    cycleStartLocalDate: '2026-09-08', conditioningModalityId: 'synthetic-continuous-walking.v1',
    executionContext: context, profile: profile(), catalog: SYNTHETIC_STARTER_CATALOG,
  })
  if (result.kind !== 'draft_program') throw new Error('fixture did not compile')
  return result
}

function input(exerciseInstanceId: string) {
  return { draft: draft(), exerciseInstanceId, catalog: SYNTHETIC_STARTER_CATALOG, profile: profile() }
}

describe('compiled initial-load calibration', () => {
  it('derives goblet options from the compiled catalog bounds and profile inventory', () => {
    const program = draft()
    const goblet = program.weeks[0].strengthSessions[0].exercises.find(exercise => exercise.loadBasis === 'dumbbell_single_implement')!
    const result = buildCompiledExerciseInitialLoadCalibration(input(goblet.exerciseInstanceId))
    expect(result.options.map(option => option.quantity.canonicalKg)).toEqual(['5', '10'])
    expect(result.options.every(option => option.basis === 'dumbbell_single_implement')).toBe(true)
    expect(result).toMatchObject({
      profileRevisionId: '1', programRevisionId: 'program-1', catalogVersion: 'synthetic-starter-catalog.v1',
      executionContext: context,
    })
  })

  it('recomputes the server offer and binds acceptance to the exercise and execution context', () => {
    const program = draft()
    const goblet = program.weeks[0].strengthSessions[0].exercises.find(exercise => exercise.loadBasis === 'dumbbell_single_implement')!
    const accepted = acceptCompiledExerciseInitialLoad({
      ...input(goblet.exerciseInstanceId), acceptanceId: 'accept-1', acceptedAt: '2026-09-08T01:00:00Z',
      acceptedByUserId: 'athlete-1', optionIndex: 1,
    })
    expect(accepted).toMatchObject({
      exerciseInstanceId: goblet.exerciseInstanceId, exerciseVersionId: goblet.exerciseVersionId,
      executionContext: context, loadBasis: 'dumbbell_single_implement', implementCount: 1,
      holdingConfiguration: 'two_hands_single_implement', quantity: { canonicalKg: '10' },
    })
  })

  it('preserves paired per-hand semantics without doubling the accepted denomination', () => {
    const program = draft()
    const paired = program.weeks[0].strengthSessions[0].exercises.find(exercise => exercise.loadBasis === 'dumbbell_per_hand')!
    const accepted = acceptCompiledExerciseInitialLoad({
      ...input(paired.exerciseInstanceId), acceptanceId: 'accept-2', acceptedAt: '2026-09-08T01:00:00Z',
      acceptedByUserId: 'athlete-1', optionIndex: 1,
    })
    expect(accepted).toMatchObject({
      loadBasis: 'dumbbell_per_hand', implementCount: 2, holdingConfiguration: 'one_per_hand',
      quantity: { canonicalKg: '10' },
    })
  })

  it('rejects tampered compiled bounds instead of accepting browser-supplied bounds', () => {
    const program = structuredClone(draft())
    const goblet = program.weeks[0].strengthSessions[0].exercises.find(exercise => exercise.loadBasis === 'dumbbell_single_implement')!
    ;(goblet.loadSelection as { maximumCanonicalKg: string }).maximumCanonicalKg = '1000'
    expect(() => buildCompiledExerciseInitialLoadCalibration({
      draft: program, exerciseInstanceId: goblet.exerciseInstanceId,
      catalog: SYNTHETIC_STARTER_CATALOG, profile: profile(),
    })).toThrow('not catalog-attested')
  })

  it('rejects mismatched catalog, profile inventory, and absent options', () => {
    const program = draft()
    const goblet = program.weeks[0].strengthSessions[0].exercises.find(exercise => exercise.loadBasis === 'dumbbell_single_implement')!
    const changedProfile = profile()
    changedProfile.equipmentInventory = []
    expect(() => buildCompiledExerciseInitialLoadCalibration({
      draft: program, exerciseInstanceId: goblet.exerciseInstanceId,
      catalog: SYNTHETIC_STARTER_CATALOG, profile: changedProfile,
    })).toThrow('not present')
    expect(() => acceptCompiledExerciseInitialLoad({
      ...input(goblet.exerciseInstanceId), acceptanceId: 'accept-3', acceptedAt: '2026-09-08T01:00:00Z',
      acceptedByUserId: 'athlete-1', optionIndex: 99,
    })).toThrow('not an offered')
  })
})

import { describe, expect, it } from 'vitest'
import { SYNTHETIC_STARTER_CATALOG, SYNTHETIC_STARTER_CATALOG_FIXTURE_HASH } from '../catalog/syntheticStarter'
import type { AthleteTrainingProfileV1 } from './profile'
import { compileEightWeekProgram, type CompilationResultV1 } from '../engine/compileProgram'
import { acceptCompiledConditioningBout } from './conditioning'

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
    equipmentInventory: [{ kind: 'dumbbell', equipmentId: 'db-set-1', unit: 'kg', perHandLoads: ['5', '10'] }],
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

describe('compiled conditioning acceptance', () => {
  it('binds the exact accepted duration to the compiled bout and source', () => {
    const program = draft()
    const bout = program.weeks[0].conditioningBouts[0]
    const accepted = acceptCompiledConditioningBout({
      draft: program, boutId: bout.boutId, acceptanceId: 'conditioning-1',
      acceptedAt: '2026-09-08T01:00:00Z', acceptedByUserId: 'athlete-1', acceptedDurationSeconds: 600,
    })
    expect(accepted).toMatchObject({
      executionContext: context, boutId: bout.boutId, modalityId: bout.modalityId,
      scheduledLocalDate: bout.scheduledLocalDate, athleteTimezone: 'America/Los_Angeles',
      acceptedDurationSeconds: 600, source: {
        compiledProgramRevisionId: 'program-1', compilerPolicyVersion: 'strength-cycle-compiler.v3',
        catalogVersion: 'synthetic-starter-catalog.v1', catalogOrigin: SYNTHETIC_STARTER_CATALOG.origin,
      },
    })
    expect(Object.isFrozen(accepted)).toBe(true)
  })

  it.each([60, 1_200])('accepts the compiled duration boundary %i seconds', (acceptedDurationSeconds) => {
    const program = draft()
    expect(acceptCompiledConditioningBout({
      draft: program, boutId: program.weeks[0].conditioningBouts[0].boutId,
      acceptanceId: `conditioning-${acceptedDurationSeconds}`, acceptedAt: '2026-09-08T01:00:00Z',
      acceptedByUserId: 'athlete-1', acceptedDurationSeconds,
    }).acceptedDurationSeconds).toBe(acceptedDurationSeconds)
  })

  it.each([59, 1_201])('rejects duration %i outside the compiled offer', (acceptedDurationSeconds) => {
    const program = draft()
    expect(() => acceptCompiledConditioningBout({
      draft: program, boutId: program.weeks[0].conditioningBouts[0].boutId,
      acceptanceId: 'conditioning-invalid', acceptedAt: '2026-09-08T01:00:00Z',
      acceptedByUserId: 'athlete-1', acceptedDurationSeconds,
    })).toThrow()
  })

  it('rejects a bout that is absent from the compiled parent', () => {
    expect(() => acceptCompiledConditioningBout({
      draft: draft(), boutId: 'missing-bout', acceptanceId: 'conditioning-missing',
      acceptedAt: '2026-09-08T01:00:00Z', acceptedByUserId: 'athlete-1', acceptedDurationSeconds: 600,
    })).toThrow('missing or ambiguous')
  })
})

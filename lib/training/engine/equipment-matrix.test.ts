import { describe, expect, it } from 'vitest'
import type { AthleteTrainingProfileV1 } from '../contracts/profile'
import {
  compileTrainingProgram,
} from './compileProgram'
import type { TrainingCatalogV1 } from '../catalog/types'

const patterns = ['knee_dominant', 'hinge', 'push', 'pull'] as const

function catalog(preparationSeconds = 0): TrainingCatalogV1 {
  return {
    schemaVersion: 'training-catalog.v1',
    catalogVersion: 'synthetic-compiler-catalog.v1',
    origin: {
      kind: 'synthetic_fixture', source: 'server_fixture', fixtureId: 'compiler-fixture',
      fixtureHash: 'a'.repeat(64), label: 'Synthetic compiler fixture catalog',
    },
    exercises: patterns.map((movementPattern, index) => ({
      exerciseId: `synthetic-${movementPattern}`,
      exerciseVersionId: `synthetic-${movementPattern}.v1`,
      label: `Synthetic ${movementPattern} exercise`,
      movementPattern,
      role: 'primary',
      preferenceRank: index,
      lifecycle: 'active',
      contentReviewStatus: 'reviewed_fixture',
      mediaStatus: 'reviewed_static_fixture',
      preparationSeconds,
      secondsPerRep: 4,
      progressionDefaults: {
        side: 'bilateral' as const,
        rom: 'catalog_default',
        tempo: 'self_selected_controlled',
        exposureType: 'standard',
      },
      equipmentCompatibility: [{
        kind: 'machine',
        basis: 'machine_stack',
        minimumCanonicalKg: '0',
        maximumCanonicalKg: '1000',
      }],
    })),
    conditioningModes: [{
      modalityId: 'synthetic-walk.v1',
      label: 'Synthetic walking modality',
      preferenceRank: 0,
      lifecycle: 'active',
      contentReviewStatus: 'reviewed_fixture',
      effortCue: 'Synthetic easy to moderate talk-test cue',
    }],
  }
}

function profile(strengthDays: AthleteTrainingProfileV1['strengthDays'], overrides: Partial<AthleteTrainingProfileV1> = {}): AthleteTrainingProfileV1 {
  return {
    schemaVersion: 'athlete-training-profile.v1',
    origin: { kind: 'synthetic_fixture', fixtureId: 'compiler-fixture', label: 'Synthetic compiler fixture profile' },
    goal: 'strength',
    experience: 'beginner',
    recentConsistency: 'consistent',
    cycleLengthWeeks: 8,
    strengthDays,
    localTimezone: 'America/Los_Angeles',
    sessionTimeBudgetMinutes: 30,
    preferredLoadUnit: 'kg',
    equipmentInventory: [{ kind: 'machine', equipmentId: 'synthetic-machine', unit: 'kg', stackLoads: ['20', '25', '30'] }],
    startingHistory: [],
    ...overrides,
  }
}

const baseIds = {
  subjectId: 'subject-1',
  profileRevisionId: 'profile-revision-1',
  programRevisionId: 'program-revision-1',
  cycleStartLocalDate: '2026-03-02',
  conditioningModalityId: 'synthetic-walk.v1',
  executionContext: {
    kind: 'synthetic_simulation', simulationRunId: '33333333-3333-4333-8333-333333333333', fixtureId: 'compiler-fixture',
    fixtureHash: 'a'.repeat(64), label: 'Practice data',
  },
} as const

// Synthetic fixtures exercise software contracts only; they are not reviewed live exercise catalogs.
const tiers = ['machine', 'barbell', 'dumbbell', 'mixed'] as const
const schedules: AthleteTrainingProfileV1['strengthDays'][] = [
  ['monday', 'thursday'], ['monday', 'wednesday', 'friday'], ['monday', 'tuesday', 'thursday', 'friday'],
]
function equipmentFixture(tier: typeof tiers[number], unit: 'kg' | 'lb') {
  const fixture = catalog()
  fixture.exercises.forEach((exercise, index) => {
    const kind = tier === 'mixed' ? (index === 0 ? 'barbell' : index === 3 ? 'machine' : 'dumbbell') : tier
    exercise.equipmentCompatibility = kind === 'machine'
      ? [{ kind, basis: 'machine_stack', minimumCanonicalKg: '0', maximumCanonicalKg: '1000' }]
      : kind === 'barbell'
        ? [{ kind, basis: 'barbell_total', minimumCanonicalKg: '0', maximumCanonicalKg: '1000' }]
        : index === 0
          ? [{ kind, basis: 'dumbbell_single_implement', implementCount: 1, holdingConfiguration: 'two_hands_single_implement', minimumCanonicalKg: '0', maximumCanonicalKg: '1000' }]
          : [{ kind, basis: 'dumbbell_per_hand', implementCount: 2, holdingConfiguration: 'one_per_hand', minimumCanonicalKg: '0', maximumCanonicalKg: '1000' }]
  })
  const inventory: AthleteTrainingProfileV1['equipmentInventory'] = [
    { kind: 'machine', equipmentId: 'machine', unit, stackLoads: ['10.25', '20.50'] },
    { kind: 'barbell', equipmentId: 'barbell', unit, barWeight: '10', collarsTotalWeight: '0', plates: [{ value: '0.125', count: 2 }, { value: '5', count: 4 }] },
    { kind: 'dumbbell', equipmentId: 'dumbbell', unit, perHandLoads: ['10.25', '20.50'] },
  ].filter(item => tier === 'mixed' || item.kind === tier) as AthleteTrainingProfileV1['equipmentInventory']
  return { fixture, inventory }
}

describe('program equipment matrix (synthetic)', () => {
  it('preserves movement coverage, equipment identity and time feasibility in 576 configurations', () => {
    let configurations = 0
    for (const tier of tiers) for (const unit of ['kg', 'lb'] as const) {
      const { fixture, inventory } = equipmentFixture(tier, unit)
      for (const cycleLengthWeeks of [4, 6, 8, 12] as const) for (const days of schedules)
        for (const sessionTimeBudgetMinutes of [30, 45, 60] as const) for (const goal of ['strength', 'general_fitness'] as const) {
          const input = { ...baseIds, catalog: fixture, profile: profile(days, { goal, cycleLengthWeeks, sessionTimeBudgetMinutes, preferredLoadUnit: unit, equipmentInventory: inventory }) }
          const result = compileTrainingProgram(input)
          expect(result.kind, `${tier}/${unit}/${cycleLengthWeeks}/${days.length}/${sessionTimeBudgetMinutes}/${goal}`).toBe('draft_program')
          if (result.kind !== 'draft_program') throw new Error('Expected feasible synthetic matrix fixture')
          expect(result.weeks).toHaveLength(cycleLengthWeeks)
          for (const week of result.weeks) {
            expect(week.strengthSessions).toHaveLength(days.length)
            for (const session of week.strengthSessions) {
              expect(session.estimatedDurationSeconds).toBeLessThanOrEqual(sessionTimeBudgetMinutes * 60)
              expect(session.estimatedDurationSeconds).toBeGreaterThanOrEqual(session.warmupSeconds)
            }
            expect(new Set(week.strengthSessions.flatMap(session => session.exercises.map(exercise => exercise.movementPattern)))).toEqual(new Set(patterns))
            for (const exercise of week.strengthSessions.flatMap(session => session.exercises)) {
              expect(inventory.some(item => item.equipmentId === exercise.equipmentId)).toBe(true)
              const authored = fixture.exercises.find(item => item.exerciseVersionId === exercise.exerciseVersionId)!
              expect(authored.equipmentCompatibility.some(item => item.basis === exercise.loadBasis)).toBe(true)
              expect(exercise.setIds).toHaveLength(2)
              if (exercise.loadBasis === 'dumbbell_per_hand') expect(exercise.implementCount).toBe(2)
              if (exercise.loadBasis === 'dumbbell_single_implement') expect(exercise.implementCount).toBe(1)
            }
          }
          expect(compileTrainingProgram(input)).toEqual(result)
          configurations += 1
        }
    }
    expect(configurations).toBe(576)
  })
  it('returns movement insufficiency instead of silently selecting unavailable equipment', () => {
    const { fixture } = equipmentFixture('barbell', 'kg')
    const result = compileTrainingProgram({ ...baseIds, catalog: fixture, profile: profile(['monday', 'thursday']) })
    expect(result).toMatchObject({ kind: 'needs_template_adjustment', reason: 'required_movement_unavailable' })
  })
})

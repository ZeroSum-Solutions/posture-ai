import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from '../quantity'
import type { AthleteTrainingProfileV1 } from '../contracts/profile'
import {
  compileEightWeekProgram,
  compileTrainingProgram,
  PROGRAM_COMPILER_POLICY_VERSION,
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

const cyclePhases = {
  4: ['calibration', 'build', 'build', 'review'],
  6: ['calibration', 'build', 'build', 'review_adjust', 'build', 'review'],
  8: ['calibration', 'build', 'build', 'review_adjust', 'build', 'build', 'build', 'review'],
  12: ['calibration', 'build', 'build', 'review_adjust', 'build', 'build', 'build', 'review_adjust', 'build', 'build', 'build', 'review'],
} as const

const supportedSchedules = [
  { days: ['monday', 'thursday'] as const, scheduleKind: 'full_body', exercisesPerSession: 4, setsPerPattern: 4 },
  { days: ['monday', 'wednesday', 'friday'] as const, scheduleKind: 'full_body', exercisesPerSession: 4, setsPerPattern: 6 },
  { days: ['monday', 'tuesday', 'thursday', 'friday'] as const, scheduleKind: 'upper_lower', exercisesPerSession: 2, setsPerPattern: 4 },
] as const

describe('compileTrainingProgram', () => {
  it('compiles the complete cycle, day-count, and time-budget matrix with stable bounded output', () => {
    for (const cycleLengthWeeks of [4, 6, 8, 12] as const) {
      for (const schedule of supportedSchedules) {
        for (const sessionTimeBudgetMinutes of [30, 45, 60] as const) {
          const input = {
            ...baseIds,
            profile: profile([...schedule.days], { cycleLengthWeeks, sessionTimeBudgetMinutes }),
            catalog: catalog(),
          }
          const result = compileTrainingProgram(input)
          expect(result.kind).toBe('draft_program')
          if (result.kind !== 'draft_program') continue
          expect(result).toMatchObject({
            cycleLengthWeeks,
            compilerPolicyVersion: 'strength-cycle-compiler.v3',
            scheduleKind: schedule.scheduleKind,
          })
          expect(result.weeks).toHaveLength(cycleLengthWeeks)
          expect(result.weeks.map(week => week.phase)).toEqual(cyclePhases[cycleLengthWeeks])
          expect(result.weeks.map(week => week.week)).toEqual(
            Array.from({ length: cycleLengthWeeks }, (_, index) => index + 1),
          )
          expect(result.weeks.every(week => (
            week.strengthSessions.length === schedule.days.length
            && week.strengthSessions.every(session => session.exercises.length === schedule.exercisesPerSession)
            && week.conditioningBouts.length === 2
          ))).toBe(true)
          const exercises = result.weeks.flatMap(week => week.strengthSessions)
            .flatMap(session => session.exercises)
          expect(exercises.every(exercise => (
            exercise.setIds.length === 2
            && exercise.targetRir.minimum === 2
            && exercise.targetRir.maximum === 3
            && exercise.restSeconds === 120
            && exercise.progression.exposureType === 'standard'
            && exercise.progression.loadEpoch === 1
          ))).toBe(true)
          for (const week of result.weeks) {
            for (const movementPattern of patterns) {
              const weeklySets = week.strengthSessions.flatMap(session => session.exercises)
                .filter(exercise => exercise.movementPattern === movementPattern)
                .reduce((sum, exercise) => sum + exercise.setIds.length, 0)
              expect(weeklySets).toBe(schedule.setsPerPattern)
            }
          }
          const dates = result.weeks.flatMap(week => [
            ...week.strengthSessions.map(session => session.scheduledLocalDate),
            ...week.conditioningBouts.map(bout => bout.scheduledLocalDate),
          ])
          const offsets = dates.map(date => (
            Date.parse(`${date}T00:00:00Z`) - Date.parse(`${result.cycleStartLocalDate}T00:00:00Z`)
          ) / 86_400_000)
          expect(Math.min(...offsets)).toBeGreaterThanOrEqual(0)
          expect(Math.max(...offsets)).toBeLessThan(cycleLengthWeeks * 7)
          const generatedIds = result.weeks.flatMap(week => [
            ...week.strengthSessions.flatMap(session => [
              session.sessionId,
              ...session.exercises.flatMap(exercise => [exercise.exerciseInstanceId, ...exercise.setIds]),
            ]),
            ...week.conditioningBouts.map(bout => bout.boutId),
          ])
          expect(new Set(generatedIds).size).toBe(generatedIds.length)
          expect(compileTrainingProgram(input)).toEqual(result)
        }
      }
    }
  })

  it('retains the eight-week export as a compatibility alias for every supported cycle', () => {
    for (const cycleLengthWeeks of [4, 6, 8, 12] as const) {
      const input = {
        ...baseIds,
        profile: profile(['monday', 'thursday'], { cycleLengthWeeks }),
        catalog: catalog(),
      }
      expect(compileEightWeekProgram(input)).toEqual(compileTrainingProgram(input))
    }
    expect(PROGRAM_COMPILER_POLICY_VERSION).toBe('strength-cycle-compiler.v3')
  })

  it.each([
    [['monday', 'thursday'] as const, 'full_body', 4, 4],
    [['monday', 'wednesday', 'friday'] as const, 'full_body', 4, 6],
    [['monday', 'tuesday', 'thursday', 'friday'] as const, 'upper_lower', 2, 4],
  ])('compiles an eight-week %s schedule with required weekly coverage', (days, scheduleKind, exercisesPerSession, setsPerPattern) => {
    const result = compileEightWeekProgram({ ...baseIds, profile: profile([...days]), catalog: catalog() })
    expect(result.kind).toBe('draft_program')
    if (result.kind !== 'draft_program') return
    expect(result.status).toBe('requires_explicit_acceptance')
    expect(result).toMatchObject({
      cycleLengthWeeks: 8,
      compilerPolicyVersion: 'strength-cycle-compiler.v3',
      goal: 'strength',
      cycleStartLocalDate: '2026-03-02',
      athleteTimezone: 'America/Los_Angeles',
      sessionTimeBudgetMinutes: 30,
    })
    expect(result.scheduleKind).toBe(scheduleKind)
    expect(result.weeks).toHaveLength(8)
    expect(result.weeks.map(week => week.phase)).toEqual([
      'calibration', 'build', 'build', 'review_adjust', 'build', 'build', 'build', 'review',
    ])
    expect(result.weeks[0].strengthSessions.every(session => session.exercises.length === exercisesPerSession)).toBe(true)
    for (const movementPattern of patterns) {
      const weeklySets = result.weeks[0].strengthSessions.flatMap(session => session.exercises)
        .filter(exercise => exercise.movementPattern === movementPattern)
        .reduce((sum, exercise) => sum + exercise.setIds.length, 0)
      expect(weeklySets).toBe(setsPerPattern)
    }
    expect(result.weeks.every(week => week.conditioningBouts.length === 2)).toBe(true)
    expect(result.weeks[0].conditioningBouts.every(bout => bout.durationOfferSeconds === 600 && bout.status === 'requires_explicit_acceptance')).toBe(true)
    expect(result.weeks[0].conditioningBouts.every(bout => !days.includes(bout.weekday as never))).toBe(true)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.weeks[0].strengthSessions[0].exercises[0].setIds)).toBe(true)
    for (const movementPattern of patterns) {
      const instances = result.weeks.flatMap(week => week.strengthSessions)
        .flatMap(session => session.exercises)
        .filter(exercise => exercise.movementPattern === movementPattern)
      expect(new Set(instances.map(exercise => exercise.progression.progressionSeriesId)))
        .toEqual(new Set([`strength-slot:${movementPattern}`]))
      expect(instances.every(exercise => (
        exercise.progression.side === 'bilateral'
        && exercise.progression.rom === 'catalog_default'
        && exercise.progression.tempo === 'self_selected_controlled'
        && exercise.progression.exposureType === 'standard'
        && exercise.progression.loadEpoch === 1
      ))).toBe(true)
    }
  })

  it('uses goal-specific rep ceilings and stable exercise/set identities on replay', () => {
    const input = { ...baseIds, profile: profile(['monday', 'thursday'], { goal: 'general_fitness' }), catalog: catalog() }
    const first = compileEightWeekProgram(input)
    const replay = compileEightWeekProgram(input)
    expect(replay).toEqual(first)
    expect(first.kind).toBe('draft_program')
    if (first.kind !== 'draft_program') return
    expect(first.weeks[0].strengthSessions[0].exercises[0].repRange).toEqual({ minimum: 8, maximum: 12 })
    const stableKeyLifts = first.weeks.slice(4, 7).map(week => week.strengthSessions.map(session => session.exercises.map(exercise => exercise.exerciseVersionId)))
    expect(stableKeyLifts[1]).toEqual(stableKeyLifts[0])
    expect(stableKeyLifts[2]).toEqual(stableKeyLifts[0])
    expect(new Set(first.weeks.flatMap(week => week.strengthSessions.flatMap(session => session.exercises.flatMap(exercise => exercise.setIds)))).size).toBe(128)
    const allGeneratedIds = first.weeks.flatMap(week => [
      ...week.strengthSessions.flatMap(session => [session.sessionId, ...session.exercises.flatMap(exercise => [exercise.exerciseInstanceId, ...exercise.setIds])]),
      ...week.conditioningBouts.map(bout => bout.boutId),
    ])
    expect(allGeneratedIds.every(id => id.length <= 64)).toBe(true)
    expect(new Set(allGeneratedIds).size).toBe(allGeneratedIds.length)
  })

  it('keeps recalled load history out of the compiled prescription', () => {
    const recalled = profile(['monday', 'thursday'], {
      startingHistory: [{
        exerciseVersionId: 'synthetic-knee_dominant.v1',
        performedAt: null,
        equipmentLoad: { equipmentId: 'synthetic-machine', basis: 'machine_stack', quantity: createLoadQuantity({ value: '60', unit: 'kg' }) },
        reps: 8,
        source: { kind: 'recalled', sourceVersion: 'athlete-recall.v1', capturedAt: '2026-03-01T12:00:00Z' },
        progressionEvidenceEligible: false,
      }],
    })
    const result = compileEightWeekProgram({ ...baseIds, profile: recalled, catalog: catalog() })
    expect(result.kind).toBe('draft_program')
    if (result.kind !== 'draft_program') return
    const knee = result.weeks[0].strengthSessions[0].exercises.find(exercise => exercise.movementPattern === 'knee_dominant')
    expect(knee?.loadSelection).toMatchObject({ status: 'requires_explicit_acceptance', familiarizationHistoryAvailable: true })
    expect(JSON.stringify(knee)).not.toContain('60')
  })

  it('returns schedule alternatives for invalid consecutive days without compiling them', () => {
    const result = compileEightWeekProgram({ ...baseIds, profile: profile(['monday', 'tuesday']), catalog: catalog() })
    expect(result.kind).toBe('schedule_adjustment_required')
    if (result.kind !== 'schedule_adjustment_required') return
    expect(result.reason).toBe('nonconsecutive_schedule_required')
    expect(result.requestedDays).toEqual(['monday', 'tuesday'])
    expect(result.alternatives[0].days.map(day => day.weekday)).toEqual(['monday', 'wednesday'])
  })

  it('returns explicit time-budget insufficiency and a feasible supported budget', () => {
    const result = compileEightWeekProgram({ ...baseIds, profile: profile(['monday', 'thursday']), catalog: catalog(160) })
    expect(result).toMatchObject({
      kind: 'time_budget_insufficient',
      requestedBudgetMinutes: 30,
      feasibleBudgetMinutes: 45,
      requiredDurationSeconds: 2_040,
    })
  })

  it('fails closed when a required compatible reviewed exercise is unavailable', () => {
    const missing = catalog()
    missing.exercises = missing.exercises.filter(exercise => exercise.movementPattern !== 'hinge')
    expect(compileEightWeekProgram({ ...baseIds, profile: profile(['monday', 'thursday']), catalog: missing })).toMatchObject({
      kind: 'needs_template_adjustment',
      reason: 'required_movement_unavailable',
      missingMovementPatterns: ['hinge'],
    })
  })

  it('does not compile an exercise without authored progression defaults', () => {
    const missing = catalog()
    delete missing.exercises[0].progressionDefaults
    expect(compileEightWeekProgram({ ...baseIds, profile: profile(['monday', 'thursday']), catalog: missing }))
      .toMatchObject({
        kind: 'needs_template_adjustment',
        reason: 'required_movement_unavailable',
        missingMovementPatterns: ['knee_dominant'],
      })
  })

  it('does not select an empty or out-of-bounds explicit-load inventory', () => {
    const empty = profile(['monday', 'thursday'], {
      equipmentInventory: [{ kind: 'machine', equipmentId: 'synthetic-machine', unit: 'kg', stackLoads: [] }],
    })
    expect(compileEightWeekProgram({ ...baseIds, profile: empty, catalog: catalog() })).toMatchObject({
      kind: 'needs_template_adjustment', reason: 'required_movement_unavailable',
    })

    const boundedCatalog = catalog()
    boundedCatalog.exercises.forEach((exercise) => {
      exercise.equipmentCompatibility[0].minimumCanonicalKg = '100'
    })
    expect(compileEightWeekProgram({ ...baseIds, profile: profile(['monday', 'thursday']), catalog: boundedCatalog })).toMatchObject({
      kind: 'needs_template_adjustment', reason: 'required_movement_unavailable',
    })
  })

  it('fails closed when the selected conditioning modality is unavailable', () => {
    const result = compileEightWeekProgram({
      ...baseIds,
      conditioningModalityId: 'missing-mode.v1',
      profile: profile(['monday', 'thursday']),
      catalog: catalog(),
    })
    expect(result).toMatchObject({
      kind: 'needs_template_adjustment',
      reason: 'conditioning_modality_unavailable',
      missingMovementPatterns: [],
    })
  })

  it('selects reviewed compatible variants by authored rank then stable version ID', () => {
    const ranked = catalog()
    const originalPush = ranked.exercises.find(exercise => exercise.movementPattern === 'push')!
    ranked.exercises.push(
      { ...originalPush, exerciseId: 'synthetic-z-push', exerciseVersionId: 'synthetic-z-push.v1', preferenceRank: 0 },
      { ...originalPush, exerciseId: 'synthetic-a-push', exerciseVersionId: 'synthetic-a-push.v1', preferenceRank: 0 },
      { ...originalPush, exerciseId: 'synthetic-unreviewed-push', exerciseVersionId: 'synthetic-unreviewed-push.v1', preferenceRank: 0, contentReviewStatus: 'unreviewed' },
    )
    originalPush.preferenceRank = 4
    const result = compileEightWeekProgram({ ...baseIds, profile: profile(['monday', 'thursday']), catalog: ranked })
    expect(result.kind).toBe('draft_program')
    if (result.kind !== 'draft_program') return
    const push = result.weeks[0].strengthSessions[0].exercises.find(exercise => exercise.movementPattern === 'push')
    expect(push?.exerciseVersionId).toBe('synthetic-a-push.v1')
  })

  it('keeps local dates unchanged when only the stored athlete timezone changes', () => {
    const west = compileEightWeekProgram({ ...baseIds, profile: profile(['monday', 'thursday']), catalog: catalog() })
    const east = compileEightWeekProgram({
      ...baseIds,
      profileRevisionId: 'profile-revision-2',
      profile: profile(['monday', 'thursday'], { localTimezone: 'America/New_York' }),
      catalog: catalog(),
    })
    expect(west.kind).toBe('draft_program')
    expect(east.kind).toBe('draft_program')
    if (west.kind !== 'draft_program' || east.kind !== 'draft_program') return
    expect(east.weeks.map(week => week.strengthSessions.map(session => session.scheduledLocalDate)))
      .toEqual(west.weeks.map(week => week.strengthSessions.map(session => session.scheduledLocalDate)))
    expect(east.weeks[0].strengthSessions[0].athleteTimezone).toBe('America/New_York')
  })

  it('returns a structured invalid-anchor result', () => {
    expect(compileEightWeekProgram({ ...baseIds, cycleStartLocalDate: '2026-02-30', profile: profile(['monday', 'thursday']), catalog: catalog() }))
      .toMatchObject({ kind: 'invalid_anchor_date', reason: 'invalid_local_cycle_start', requestedValue: '2026-02-30' })
  })

  it('returns equipment-specific template rejection for every supported cycle without an empty draft', () => {
    const missing = catalog()
    missing.exercises = missing.exercises.filter(exercise => exercise.movementPattern !== 'hinge')
    for (const cycleLengthWeeks of [4, 6, 8, 12] as const) {
      expect(compileTrainingProgram({
        ...baseIds,
        profile: profile(['monday', 'thursday'], { cycleLengthWeeks }),
        catalog: missing,
      })).toMatchObject({
        kind: 'needs_template_adjustment',
        reason: 'required_movement_unavailable',
        missingMovementPatterns: ['hinge'],
      })
    }
  })

  it('rejects malformed catalog runtime input', () => {
    expect(() => compileEightWeekProgram({ ...baseIds, profile: profile(['monday', 'thursday']), catalog: { ...catalog(), exercises: 'forged' } as never }))
      .toThrow('Invalid compiler input')
    expect(() => compileEightWeekProgram({ ...baseIds, profile: profile(['monday', 'thursday']), catalog: catalog(), scanGrade: 'poor' } as never))
      .toThrow('Invalid compiler input')
    const invertedBounds = catalog()
    invertedBounds.exercises[0].equipmentCompatibility[0].minimumCanonicalKg = '100'
    invertedBounds.exercises[0].equipmentCompatibility[0].maximumCanonicalKg = '10'
    expect(() => compileEightWeekProgram({ ...baseIds, profile: profile(['monday', 'thursday']), catalog: invertedBounds }))
      .toThrow('Invalid compiler input')
  })

  it('compiles exact barbell inventory and preserves one- versus two-dumbbell semantics', () => {
    const variants = catalog()
    variants.exercises.forEach((exercise) => {
      if (exercise.movementPattern === 'knee_dominant') {
        exercise.equipmentCompatibility = [{
          kind: 'dumbbell', basis: 'dumbbell_single_implement', implementCount: 1,
          holdingConfiguration: 'two_hands_single_implement', minimumCanonicalKg: '5', maximumCanonicalKg: '20',
        }]
      } else if (exercise.movementPattern === 'hinge') {
        exercise.equipmentCompatibility = [{
          kind: 'dumbbell', basis: 'dumbbell_per_hand', implementCount: 2,
          holdingConfiguration: 'one_per_hand', minimumCanonicalKg: '5', maximumCanonicalKg: '20',
        }]
      } else if (exercise.movementPattern === 'push') {
        exercise.equipmentCompatibility = [{
          kind: 'barbell', basis: 'barbell_total', minimumCanonicalKg: '10', maximumCanonicalKg: '30',
        }]
      }
    })
    const result = compileEightWeekProgram({
      ...baseIds,
      profile: profile(['monday', 'thursday'], {
        equipmentInventory: [
          { kind: 'dumbbell', equipmentId: 'db-set', unit: 'kg', perHandLoads: ['10', '20'] },
          { kind: 'barbell', equipmentId: 'rack', unit: 'kg', barWeight: '10', collarsTotalWeight: '0', plates: [{ value: '5', count: 2 }] },
          { kind: 'machine', equipmentId: 'synthetic-machine', unit: 'kg', stackLoads: ['20'] },
        ],
      }),
      catalog: variants,
    })
    expect(result.kind).toBe('draft_program')
    if (result.kind !== 'draft_program') return
    const exercises = result.weeks[0].strengthSessions[0].exercises
    expect(exercises.find(item => item.movementPattern === 'knee_dominant')).toMatchObject({
      loadBasis: 'dumbbell_single_implement', implementCount: 1, holdingConfiguration: 'two_hands_single_implement',
    })
    expect(exercises.find(item => item.movementPattern === 'hinge')).toMatchObject({
      loadBasis: 'dumbbell_per_hand', implementCount: 2, holdingConfiguration: 'one_per_hand',
    })
    expect(exercises.find(item => item.movementPattern === 'push')).toMatchObject({ loadBasis: 'barbell_total' })
  })

  it('binds generated identities and catalog provenance to the execution context', () => {
    const first = compileEightWeekProgram({ ...baseIds, profile: profile(['monday', 'thursday']), catalog: catalog() })
    const second = compileEightWeekProgram({
      ...baseIds,
      executionContext: { ...baseIds.executionContext, simulationRunId: '44444444-4444-4444-8444-444444444444' },
      profile: profile(['monday', 'thursday']), catalog: catalog(),
    })
    expect(first.kind).toBe('draft_program')
    expect(second.kind).toBe('draft_program')
    if (first.kind !== 'draft_program' || second.kind !== 'draft_program') return
    expect(first.catalogOrigin).toEqual(catalog().origin)
    expect(first.weeks[0].strengthSessions[0].sessionId).not.toBe(second.weeks[0].strengthSessions[0].sessionId)
    expect(first.weeks[0].strengthSessions[0].exercises[0].exerciseInstanceId)
      .not.toBe(second.weeks[0].strengthSessions[0].exercises[0].exerciseInstanceId)
    expect(first.weeks[0].conditioningBouts[0].boutId).not.toBe(second.weeks[0].conditioningBouts[0].boutId)
  })

  it('rejects synthetic profile provenance that does not match the active fixture', () => {
    const mismatched = profile(['monday', 'thursday'])
    mismatched.origin = { kind: 'synthetic_fixture', fixtureId: 'other-fixture', label: 'Synthetic other fixture' }
    expect(() => compileEightWeekProgram({ ...baseIds, profile: mismatched, catalog: catalog() }))
      .toThrow('Invalid compiler input')
  })

})

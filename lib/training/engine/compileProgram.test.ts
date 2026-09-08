import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from '../quantity'
import type { AthleteTrainingProfileV1 } from '../contracts/profile'
import { compileEightWeekProgram } from './compileProgram'
import type { TrainingCatalogV1 } from '../catalog/types'

const patterns = ['knee_dominant', 'hinge', 'push', 'pull'] as const

function catalog(preparationSeconds = 0): TrainingCatalogV1 {
  return {
    schemaVersion: 'training-catalog.v1',
    catalogVersion: 'synthetic-compiler-catalog.v1',
    origin: { kind: 'synthetic_fixture', fixtureId: 'compiler-fixture', label: 'Synthetic compiler fixture catalog' },
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
    origin: { kind: 'synthetic_fixture', fixtureId: 'compiler-profile', label: 'Synthetic compiler fixture profile' },
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
} as const

describe('compileEightWeekProgram', () => {
  it.each([
    ['strength', ['monday', 'thursday']],
    ['strength', ['monday', 'wednesday', 'friday']],
    ['strength', ['monday', 'tuesday', 'thursday', 'friday']],
    ['general_fitness', ['monday', 'thursday']],
    ['general_fitness', ['monday', 'wednesday', 'friday']],
    ['general_fitness', ['monday', 'tuesday', 'thursday', 'friday']],
  ] as const)('returns feasible drafts across the 8-week %s %s schedule and all time tiers', (goal, days) => {
    for (const sessionTimeBudgetMinutes of [30, 45, 60] as const) {
      const result = compileEightWeekProgram({
        ...baseIds,
        profile: profile([...days], { goal, sessionTimeBudgetMinutes }),
        catalog: catalog(),
      })
      expect(result.kind).toBe('draft_program')
    }
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
    expect(knee?.loadSelection).toEqual({ status: 'requires_explicit_acceptance', familiarizationHistoryAvailable: true })
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
    expect(compileEightWeekProgram({ ...baseIds, profile: profile(['monday', 'thursday']), catalog: missing })).toEqual({
      kind: 'needs_template_adjustment',
      reason: 'required_movement_unavailable',
      missingMovementPatterns: ['hinge'],
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
    expect(result).toEqual({
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

  it('rejects unsupported cycle lengths and malformed catalog runtime input', () => {
    expect(() => compileEightWeekProgram({ ...baseIds, profile: profile(['monday', 'thursday'], { cycleLengthWeeks: 6 }), catalog: catalog() }))
      .toThrow('Only the eight-week compiler is supported')
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
})

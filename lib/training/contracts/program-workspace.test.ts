import { describe, expect, it } from 'vitest'
import { TrainingProgramWorkspaceSessionSchema } from './program-workspace'

const base = {
  sessionId: 'session-1', kind: 'strength', state: 'completed', scheduledLocalDate: '2026-09-08', weekNumber: 1,
  athleteTimezone: 'UTC', revision: 2, completedAt: '2026-09-08T12:00:00.000Z', stoppedForSymptoms: false,
  planned: { kind: 'strength', exercises: [{
    exerciseInstanceId: 'exercise-1', label: null, setIds: ['set-1'], targetReps: [8],
    repRange: { minimum: 6, maximum: 8 }, targetRir: { minimum: 2, maximum: 3 }, restSeconds: 120, side: 'bilateral',
    load: { basis: 'dumbbell_single_implement', quantity: { entered: { value: '10', unit: 'kg' }, canonicalKg: '10' } },
  }] },
  actual: { kind: 'strength', prescribedSetCount: 1, recordedSetCount: 1, omittedSetCount: 0, sets: [{
    setId: 'set-1', exerciseInstanceId: 'exercise-1', setKind: 'working', workingSetOrdinal: 1,
    quantity: { entered: { value: '10', unit: 'kg' }, canonicalKg: '10' }, reps: 8, rir: 2, side: 'bilateral',
    symptomState: 'none', occurredAt: '2026-09-08T11:00:00.000Z',
  }] },
} as const

describe('TrainingProgramWorkspaceSessionSchema', () => {
  it('accepts a matching planned and actual strength summary', () => {
    expect(TrainingProgramWorkspaceSessionSchema.parse(base)).toEqual(base)
  })

  it('keeps authored warm-ups visible without counting them as working completion', () => {
    const warmup = {
      setId: 'warmup-1', targetReps: 6,
      load: { basis: 'dumbbell_single_implement', quantity: { entered: { value: '5.0', unit: 'kg' }, canonicalKg: '5' } },
    } as const
    const warmupActual = {
      ...base.actual.sets[0], setId: 'warmup-1', setKind: 'warmup', workingSetOrdinal: null,
      quantity: warmup.load.quantity, reps: 6,
    } as const
    const session = {
      ...base,
      planned: { ...base.planned, exercises: [{ ...base.planned.exercises[0], warmupSets: [warmup] }] },
      actual: { ...base.actual, recordedSetCount: 0, omittedSetCount: 1, sets: [warmupActual] },
    }

    expect(TrainingProgramWorkspaceSessionSchema.parse(session)).toEqual(session)
  })

  it('accepts mixed warm-up and working history while counting only the working set', () => {
    const warmup = {
      setId: 'warmup-1', targetReps: 6,
      load: { basis: 'dumbbell_single_implement', quantity: { entered: { value: '5', unit: 'kg' }, canonicalKg: '5' } },
    } as const
    const session = {
      ...base,
      planned: { ...base.planned, exercises: [{ ...base.planned.exercises[0], warmupSets: [warmup] }] },
      actual: { ...base.actual, sets: [{
        ...base.actual.sets[0], setId: warmup.setId, setKind: 'warmup', workingSetOrdinal: null,
        quantity: warmup.load.quantity, reps: 6,
      }, ...base.actual.sets] },
    }

    expect(TrainingProgramWorkspaceSessionSchema.parse(session).actual).toMatchObject({
      recordedSetCount: 1, omittedSetCount: 0, sets: [{ setKind: 'warmup' }, { setKind: 'working' }],
    })
  })

  it('rejects cross-exercise actuals and dishonest recorded or omitted counts', () => {
    expect(TrainingProgramWorkspaceSessionSchema.safeParse({ ...base, actual: { ...base.actual, sets: [{ ...base.actual.sets[0], exerciseInstanceId: 'other' }] } }).success).toBe(false)
    expect(TrainingProgramWorkspaceSessionSchema.safeParse({ ...base, actual: { ...base.actual, recordedSetCount: 0 } }).success).toBe(false)
    expect(TrainingProgramWorkspaceSessionSchema.safeParse({ ...base, actual: { ...base.actual, omittedSetCount: 1 } }).success).toBe(false)
  })

  it('rejects mismatched set kinds, ordinals, duplicate actuals, and planned ID collisions', () => {
    const warmup = {
      setId: 'warmup-1', targetReps: 6,
      load: { basis: 'dumbbell_single_implement', quantity: { entered: { value: '5', unit: 'kg' }, canonicalKg: '5' } },
    } as const
    const planned = { ...base.planned, exercises: [{ ...base.planned.exercises[0], warmupSets: [warmup] }] }
    const warmupActual = {
      ...base.actual.sets[0], setId: warmup.setId, setKind: 'warmup', workingSetOrdinal: null,
      quantity: warmup.load.quantity, reps: 6,
    } as const

    expect(TrainingProgramWorkspaceSessionSchema.safeParse({
      ...base, planned,
      actual: { ...base.actual, recordedSetCount: 0, omittedSetCount: 1, sets: [{ ...warmupActual, setKind: 'working', workingSetOrdinal: 1 }] },
    }).success).toBe(false)
    expect(TrainingProgramWorkspaceSessionSchema.safeParse({
      ...base, planned,
      actual: { ...base.actual, recordedSetCount: 0, omittedSetCount: 1, sets: [{ ...warmupActual, workingSetOrdinal: 1 }] },
    }).success).toBe(false)
    expect(TrainingProgramWorkspaceSessionSchema.safeParse({
      ...base, planned,
      actual: { ...base.actual, sets: [{ ...base.actual.sets[0], workingSetOrdinal: 2 }] },
    }).success).toBe(false)
    expect(TrainingProgramWorkspaceSessionSchema.safeParse({
      ...base, planned,
      actual: { ...base.actual, recordedSetCount: 0, omittedSetCount: 1, sets: [warmupActual, warmupActual] },
    }).success).toBe(false)
    expect(TrainingProgramWorkspaceSessionSchema.safeParse({
      ...base,
      planned: { ...base.planned, exercises: [{ ...base.planned.exercises[0], warmupSets: [{ ...warmup, setId: 'set-1' }] }] },
    }).success).toBe(false)
  })

  it.each([
    [1_320, '20 to 22 minute progression'],
    [1_800, '29 to 30 minute progression'],
  ] as const)('projects a %s second conditioning plan after %s', (durationSeconds, description) => {
    void description
    const session = {
      ...base,
      sessionId: 'conditioning-bout-1',
      kind: 'conditioning',
      planned: {
        kind: 'conditioning', boutId: 'conditioning-bout-1', label: 'Walking',
        durationSeconds, effortCue: 'Comfortable effort.',
      },
      actual: { kind: 'conditioning', recorded: null },
    }
    expect(TrainingProgramWorkspaceSessionSchema.parse(session).planned)
      .toMatchObject({ kind: 'conditioning', durationSeconds })
  })

  it('rejects a projected conditioning plan above 30 minutes', () => {
    expect(TrainingProgramWorkspaceSessionSchema.safeParse({
      ...base,
      sessionId: 'conditioning-bout-1',
      kind: 'conditioning',
      planned: {
        kind: 'conditioning', boutId: 'conditioning-bout-1', label: null,
        durationSeconds: 1_801, effortCue: 'Comfortable effort.',
      },
      actual: { kind: 'conditioning', recorded: null },
    }).success).toBe(false)
  })
})

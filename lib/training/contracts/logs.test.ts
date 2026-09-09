import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from '../quantity'
import { TrainingSetLogEventV1Schema } from './logs'

const base = {
  schemaVersion: 'training-set-log-event.v1', eventId: 'event-1', eventType: 'set_actual_recorded', eventRevision: 1,
  replacesEventId: null, subjectId: 'subject-1', sessionId: 'session-1', exerciseInstanceId: 'exercise-1', setId: 'set-1',
  setKind: 'working', workingSetOrdinal: 1, executionContext: { kind: 'live' }, equipmentId: 'db-set-1',
  loadBasis: 'dumbbell_single_implement', quantity: createLoadQuantity({ value: '10', unit: 'kg' }), reps: 10, rir: 2,
  side: 'bilateral', symptomState: 'none', actor: { kind: 'athlete', userId: 'athlete-1' },
  occurredAt: '2026-09-08T01:05:00Z', serverAt: '2026-09-08T01:05:01Z',
} as const

describe('set log contracts', () => {
  it('records exact entered load, reps and RIR without a client validity or sync enum', () => {
    expect(TrainingSetLogEventV1Schema.parse(base)).toEqual(base)
    expect(() => TrainingSetLogEventV1Schema.parse({ ...base, validity: 'qualifying' })).toThrow()
    expect(() => TrainingSetLogEventV1Schema.parse({ ...base, syncState: 'acknowledged' })).toThrow()
  })

  it('requires correction linkage and working-set ordinals', () => {
    expect(TrainingSetLogEventV1Schema.parse({
      ...base, eventId: 'event-2', eventType: 'set_actual_corrected', eventRevision: 2, replacesEventId: 'event-1',
    }).replacesEventId).toBe('event-1')
    expect(() => TrainingSetLogEventV1Schema.parse({ ...base, eventType: 'set_actual_corrected' })).toThrow()
    expect(() => TrainingSetLogEventV1Schema.parse({ ...base, setKind: 'warmup' })).toThrow()
    expect(TrainingSetLogEventV1Schema.parse({
      ...base, setId: 'warmup-set-1', setKind: 'warmup', workingSetOrdinal: null,
    })).toMatchObject({ setKind: 'warmup', workingSetOrdinal: null })
  })

  it('keeps synthetic logs bound to an explicit simulation run', () => {
    const synthetic = {
      ...base,
      executionContext: {
        kind: 'synthetic_simulation', simulationRunId: '11111111-1111-4111-8111-111111111111', fixtureId: 'starter-v1',
        fixtureHash: 'c'.repeat(64), label: 'Practice data',
      },
    }
    expect(TrainingSetLogEventV1Schema.parse(synthetic).executionContext.kind).toBe('synthetic_simulation')
  })

  it('records external bodyweight and assistance as distinct exact nonnegative bases', () => {
    expect(TrainingSetLogEventV1Schema.parse({
      ...base,
      equipmentId: 'bodyweight-station',
      loadBasis: 'bodyweight_external',
      quantity: createLoadQuantity({ value: '0', unit: 'kg' }),
    })).toMatchObject({
      loadBasis: 'bodyweight_external',
      quantity: { entered: { value: '0', unit: 'kg' }, canonicalKg: '0' },
    })
    expect(TrainingSetLogEventV1Schema.parse({
      ...base,
      equipmentId: 'assisted-pullup-a',
      loadBasis: 'machine_assistance',
      quantity: createLoadQuantity({ value: '20', unit: 'kg' }),
    })).toMatchObject({ loadBasis: 'machine_assistance', quantity: { canonicalKg: '20' } })
    expect(TrainingSetLogEventV1Schema.safeParse({
      ...base,
      equipmentId: 'assisted-pullup-a',
      loadBasis: 'machine_assistance',
      quantity: { entered: { value: '-5', unit: 'kg' }, canonicalKg: '-5' },
    }).success).toBe(false)
  })
})

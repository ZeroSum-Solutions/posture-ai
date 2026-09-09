import { describe, expect, it } from 'vitest'
import { createLoadQuantity } from '../quantity'
import { TrainingPreviousPerformanceV1Schema } from './previous-performance'

const request = { sessionId: 'session-current', exerciseInstanceId: 'press-current' }
const liveContext = { kind: 'live' as const }

function available() {
  return {
    schemaVersion: 'training-previous-performance.v1',
    request,
    result: {
      kind: 'available' as const,
      source: {
        sessionId: 'session-prior', exerciseInstanceId: 'press-prior', sessionRevision: 4,
        sourceRevisionId: `session-evidence:${'a'.repeat(64)}`,
        prescriptionSourceRevisionId: `training-session-prescription.v1:sha256:${'b'.repeat(64)}`,
        progressionSeriesId: 'strength-slot:push', scheduledLocalDate: '2026-09-01',
        completedAt: '2026-09-01T17:30:00.000Z', executionContext: liveContext,
        effectiveEvents: [
          { eventId: '11111111-1111-4111-8111-111111111111', eventRevision: 2 },
          { eventId: '22222222-2222-4222-8222-222222222222', eventRevision: 1 },
        ],
      },
      sets: [
        {
          ordinal: 1,
          load: {
            equipmentId: 'dumbbells-1', basis: 'dumbbell_per_hand',
            quantity: createLoadQuantity({ value: '22.50', unit: 'lb' }),
          },
          reps: 8, rir: 2, side: 'bilateral',
        },
        {
          ordinal: 2,
          load: {
            equipmentId: 'dumbbells-1', basis: 'dumbbell_per_hand',
            quantity: createLoadQuantity({ value: '22.50', unit: 'lb' }),
          },
          reps: 7, rir: 'unknown', side: 'bilateral',
        },
      ],
    },
  }
}

describe('TrainingPreviousPerformanceV1Schema', () => {
  it('preserves exact entered load, reps, RIR, source revisions, and completion date', () => {
    const parsed = TrainingPreviousPerformanceV1Schema.parse(available())
    expect(parsed.result.kind).toBe('available')
    if (parsed.result.kind !== 'available') throw new Error('Expected available previous performance')
    expect(parsed.result.sets[0].load.quantity.entered).toEqual({ value: '22.50', unit: 'lb' })
    expect(parsed.result.sets.map(set => ({ reps: set.reps, rir: set.rir })))
      .toEqual([{ reps: 8, rir: 2 }, { reps: 7, rir: 'unknown' }])
    expect(parsed.result.source).toMatchObject({
      sessionRevision: 4, scheduledLocalDate: '2026-09-01',
      completedAt: '2026-09-01T17:30:00.000Z',
      effectiveEvents: [{ eventRevision: 2 }, { eventRevision: 1 }],
    })
  })

  it.each([
    { kind: 'none', reason: 'no_comparable_completed_exposure' },
    { kind: 'unavailable', reason: 'current_comparator_unavailable' },
    { kind: 'unavailable', reason: 'historical_evidence_unavailable' },
    { kind: 'unavailable', reason: 'persistence_unavailable' },
  ] as const)('represents $kind without inventing performance values', (result) => {
    expect(TrainingPreviousPerformanceV1Schema.parse({
      schemaVersion: 'training-previous-performance.v1', request, result,
    }).result).toEqual(result)
  })

  it('rejects invented, malformed, or mismatched source data', () => {
    const value = available()
    expect(TrainingPreviousPerformanceV1Schema.safeParse({
      ...value, result: { ...value.result, e1rm: 40 },
    }).success).toBe(false)
    expect(TrainingPreviousPerformanceV1Schema.safeParse({
      ...value, result: { ...value.result, source: { ...value.result.source, completedAt: 'not-a-date' } },
    }).success).toBe(false)
    expect(TrainingPreviousPerformanceV1Schema.safeParse({
      ...value, result: { ...value.result, sets: [{ ...value.result.sets[0], ordinal: 2 }, value.result.sets[1]] },
    }).success).toBe(false)
    expect(TrainingPreviousPerformanceV1Schema.safeParse({
      ...value, result: { ...value.result, sets: [{ ...value.result.sets[0], load: {
        ...value.result.sets[0].load, equipmentId: 'other',
      } }, value.result.sets[1]] },
    }).success).toBe(false)
  })

  it('binds bodyweight and assistance history to its exact dedicated policy', () => {
    const value = available()
    const policy = { policyId: 'synthetic-assistance-rep-only.v1', policyVersion: '1' }
    const assistance = {
      ...value,
      result: {
        ...value.result,
        source: { ...value.result.source, bodyweightAssistancePolicy: policy },
        sets: value.result.sets.map(set => ({
          ...set,
          load: {
            equipmentId: 'assisted-pullup-a', basis: 'machine_assistance' as const,
            quantity: createLoadQuantity({ value: '20', unit: 'kg' }),
          },
        })),
      },
    }

    expect(TrainingPreviousPerformanceV1Schema.parse(assistance).result)
      .toMatchObject({ source: { bodyweightAssistancePolicy: policy } })
    expect(TrainingPreviousPerformanceV1Schema.safeParse({
      ...assistance,
      result: { ...assistance.result, source: { ...assistance.result.source, bodyweightAssistancePolicy: undefined } },
    }).success).toBe(false)
    expect(TrainingPreviousPerformanceV1Schema.safeParse({
      ...value,
      result: { ...value.result, source: { ...value.result.source, bodyweightAssistancePolicy: policy } },
    }).success).toBe(false)
  })
})

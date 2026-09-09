import { describe, expect, it } from 'vitest'
import { createRecalledStartingSet, type StartingHistoryExerciseOption } from './StartingHistory.model'

const options: StartingHistoryExerciseOption[] = [{
  exerciseVersionId: 'floor-press.v1', label: 'Floor press',
  equipmentOptions: [{ equipmentId: 'db', basis: 'dumbbell_per_hand', unit: 'lb' }],
}]
const input = {
  options, exerciseVersionId: 'floor-press.v1', equipmentId: 'db',
  basis: 'dumbbell_per_hand' as const, load: '4.125', reps: '7',
  performedAt: null, capturedAt: '2026-09-09T07:00:00Z',
}

describe('recalled starting sets', () => {
  it('preserves exact entered microloads and marks recall as ineligible for progression', () => {
    const entry = createRecalledStartingSet(input)
    expect(entry.equipmentLoad.quantity.entered).toEqual({ value: '4.125', unit: 'lb' })
    expect(entry.reps).toBe(7)
    expect(entry.performedAt).toBeNull()
    expect(entry.source.kind).toBe('recalled')
    expect(entry.progressionEvidenceEligible).toBe(false)
  })
  it.each(['', '0', '-1', '1.5', '101', '1e1', ' '])('rejects invalid repetitions %j', reps => {
    expect(() => createRecalledStartingSet({ ...input, reps })).toThrow()
  })
  it('rejects stale exercise IDs and incompatible equipment or load basis', () => {
    expect(() => createRecalledStartingSet({ ...input, exerciseVersionId: 'old.v1' })).toThrow()
    expect(() => createRecalledStartingSet({ ...input, equipmentId: 'other' })).toThrow()
    expect(() => createRecalledStartingSet({ ...input, basis: 'barbell_total' })).toThrow()
  })
  it('rejects ambiguous option lists instead of selecting the first match', () => {
    expect(() => createRecalledStartingSet({ ...input, options: [...options, ...options] })).toThrow()
    expect(() => createRecalledStartingSet({ ...input, options: [{ ...options[0], equipmentOptions: [...options[0].equipmentOptions, ...options[0].equipmentOptions] }] })).toThrow()
  })
  it('preserves an explicit timestamp and rejects malformed dates or imprecise loads', () => {
    expect(createRecalledStartingSet({ ...input, performedAt: '2026-09-08T18:00:00-07:00' }).performedAt).toBe('2026-09-08T18:00:00-07:00')
    expect(() => createRecalledStartingSet({ ...input, performedAt: 'yesterday' })).toThrow()
    expect(() => createRecalledStartingSet({ ...input, performedAt: '2026-09-10T18:00:00Z' })).toThrow()
    expect(() => createRecalledStartingSet({ ...input, load: '4.1255' })).toThrow()
  })
})

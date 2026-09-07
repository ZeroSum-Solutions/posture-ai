import { describe, expect, it } from 'vitest'
import { createSampleScan } from './scan'
import { DEFAULT_WORKOUT_PREFERENCES, itemDuration, selectWorkoutItems, withWorkoutItems, workoutCandidates, workoutRequestSchema } from './workout'

describe('prototype workout selection', () => {
  const findings = createSampleScan().result.findings
  it('builds playable authored movements from the real engine sample', () => {
    const candidates = workoutCandidates(findings, DEFAULT_WORKOUT_PREFERENCES)
    expect(candidates).not.toBeNull()
    expect(candidates!.items.length).toBeGreaterThan(0)
    expect(candidates!.items.every((item) => item.instructions.length >= 80)).toBe(true)
    expect(candidates!.items.some((item) => /\b(band|roller|dumbbell|lacrosse ball)\b/i.test(`${item.name} ${item.instructions}`))).toBe(false)
  })
  it('rejects an invented, duplicated or empty AI selection', () => {
    const candidates = workoutCandidates(findings, DEFAULT_WORKOUT_PREFERENCES)!
    expect(() => selectWorkoutItems(candidates, DEFAULT_WORKOUT_PREFERENCES, ['invented-movement'])).toThrow()
    expect(() => selectWorkoutItems(candidates, DEFAULT_WORKOUT_PREFERENCES, [])).toThrow()
    expect(() => selectWorkoutItems(candidates, DEFAULT_WORKOUT_PREFERENCES, [candidates.items[0].slug, candidates.items[0].slug])).toThrow()
  })
  it('enforces available time and preserves authored sequencing and dosing', () => {
    const preferences = { ...DEFAULT_WORKOUT_PREFERENCES, minutes: 10 as const }
    const candidates = workoutCandidates(findings, preferences)!
    const snapshot = selectWorkoutItems(candidates, preferences, candidates.items.map((item) => item.slug).reverse())
    expect(snapshot.estimatedDurationSec).toBeLessThanOrEqual(600)
    expect(snapshot.items.length).toBeGreaterThan(0)
    expect(snapshot.items.map((item) => item.slug)).toEqual(candidates.items.filter((item) => snapshot.items.some((selected) => selected.slug === item.slug)).map((item) => item.slug))
    for (const item of snapshot.items) expect(item.timing).toEqual(candidates.items.find((candidate) => candidate.slug === item.slug)!.timing)
  })
  it('keeps unreliable/maintain findings out and recalculates removal timing without mutation', () => {
    expect(workoutCandidates(findings.map((finding) => ({ ...finding, reliable: false, zone: 'unreliable' })), DEFAULT_WORKOUT_PREFERENCES)).toBeNull()
    const candidates = workoutCandidates(findings, DEFAULT_WORKOUT_PREFERENCES)!
    const priorCount = candidates.items.length
    const trimmed = withWorkoutItems(candidates, [candidates.items.at(-1)!])
    expect(trimmed.items[0].index).toBe(0)
    expect(trimmed.priorities.every((priority) => priority.primaryKey === trimmed.items[0].priorityKey)).toBe(true)
    expect(trimmed.estimatedDurationSec).toBe(itemDuration(trimmed.items[0]))
    expect(candidates.items.length).toBe(priorCount)
  })
  it('rejects unbounded customization payloads', () => {
    expect(workoutRequestSchema.safeParse({ findings, preferences: { ...DEFAULT_WORKOUT_PREFERENCES, minutes: 999 } }).success).toBe(false)
    expect(workoutRequestSchema.safeParse({ findings, preferences: DEFAULT_WORKOUT_PREFERENCES, photos: ['private-image'] }).success).toBe(false)
  })
})

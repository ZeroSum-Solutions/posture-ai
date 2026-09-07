import { describe, expect, it } from 'vitest'
import type { SessionItem, SessionSnapshot } from './generateWorkoutSession'
import {
  DEFAULT_WORKOUT_PREFERENCES,
  personalizeWorkout,
  removeWorkoutItem,
  workoutPreferencesSchema,
} from './personalize'

function item(
  slug: string,
  category: SessionItem['category'],
  priorityKey: string,
  instructions = 'Use a wall for support and move with control.',
): SessionItem {
  return {
    index: 0,
    slug,
    baseSlug: slug,
    name: slug.replaceAll('-', ' '),
    category,
    stepLabel: category === 'strengthen' ? 'Strengthen' : 'Lengthen',
    priorityKey,
    priorityLabel: priorityKey.replaceAll('_', ' '),
    isIntegrative: false,
    instructions,
    timing: category === 'strengthen'
      ? { kind: 'reps', sets: 2, repsPerSet: 8, restSeconds: 20 }
      : { kind: 'hold', sets: 2, secondsPerSet: 30, restSeconds: 10 },
  }
}

const items = [
  item('neck-mobility', 'mobility', 'forward_head'),
  item('band-row', 'strengthen', 'rounded_shoulders', 'Use a resistance band and keep the ribs quiet.'),
  item('wall-slide', 'strengthen', 'rounded_shoulders'),
].map((value, index) => ({ ...value, index }))

const candidates: SessionSnapshot = {
  version: 1,
  week: 1,
  capability: 'standard',
  disclaimer: 'Screening support only.',
  priorities: [
    { primaryKey: 'forward_head', label: 'Forward head', zone: 'warning', severityWord: 'moderate' },
    { primaryKey: 'rounded_shoulders', label: 'Rounded shoulders', zone: 'warning', severityWord: 'moderate' },
  ],
  items,
  estimatedDurationSec: 250,
}

describe('workout personalization', () => {
  it('keeps only available equipment and preserves authored order and dosage', () => {
    const result = personalizeWorkout(candidates, {
      ...DEFAULT_WORKOUT_PREFERENCES,
      goal: 'strength',
      minutes: 10,
      equipment: [],
    })

    expect(result.items.map((entry) => entry.slug)).toEqual(['neck-mobility', 'wall-slide'])
    expect(result.items.map((entry) => entry.index)).toEqual([0, 1])
    expect(result.items[1]?.timing).toEqual(items[2]?.timing)
    expect(result.priorities.map((priority) => priority.primaryKey)).toEqual(['forward_head', 'rounded_shoulders'])
  })

  it('rejects invented, duplicated, and empty selected-slug lists', () => {
    expect(() => personalizeWorkout(candidates, DEFAULT_WORKOUT_PREFERENCES, ['invented'])).toThrow(/outside/i)
    expect(() => personalizeWorkout(candidates, DEFAULT_WORKOUT_PREFERENCES, [])).toThrow(/outside/i)
    expect(() => personalizeWorkout(candidates, DEFAULT_WORKOUT_PREFERENCES, ['wall-slide', 'wall-slide'])).toThrow(/outside/i)
  })

  it('removes one item without mutating the candidate snapshot and recalculates duration', () => {
    const result = removeWorkoutItem(candidates, 'band-row')

    expect(result.items.map((entry) => entry.slug)).toEqual(['neck-mobility', 'wall-slide'])
    expect(result.items.map((entry) => entry.index)).toEqual([0, 1])
    expect(result.estimatedDurationSec).toBeGreaterThan(0)
    expect(candidates.items).toHaveLength(3)
  })

  it('rejects unbounded preference payloads', () => {
    expect(workoutPreferencesSchema.safeParse({
      ...DEFAULT_WORKOUT_PREFERENCES,
      minutes: 999,
    }).success).toBe(false)
    expect(workoutPreferencesSchema.safeParse({
      ...DEFAULT_WORKOUT_PREFERENCES,
      photos: ['private-image'],
    }).success).toBe(false)
  })
})

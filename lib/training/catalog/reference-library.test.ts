import { describe, expect, it } from 'vitest'
import {
  REFERENCE_EXERCISE_LIBRARY,
  filterReferenceExercises,
} from './reference-library'

describe('reference exercise library', () => {
  it('contains at least 250 distinct attributable instruction records', () => {
    expect(REFERENCE_EXERCISE_LIBRARY.length).toBeGreaterThanOrEqual(250)
    expect(new Set(REFERENCE_EXERCISE_LIBRARY.map(item => item.id)).size)
      .toBe(REFERENCE_EXERCISE_LIBRARY.length)
    expect(new Set(REFERENCE_EXERCISE_LIBRARY.map(item => item.normalizedName)).size)
      .toBe(REFERENCE_EXERCISE_LIBRARY.length)

    for (const item of REFERENCE_EXERCISE_LIBRARY) {
      expect(item.reviewStatus).toBe('reference_unreviewed')
      expect(item.instructions.length).toBeGreaterThanOrEqual(80)
      expect(item.source.provider).toBe('wger')
      expect(item.source.recordUrl).toMatch(/^https:\/\/wger\.de\/api\/v2\/exerciseinfo\/\d+\/$/)
      expect(item.source.author.trim()).not.toBe('')
      expect(['CC-BY-SA 3', 'CC-BY-SA 4']).toContain(item.source.license.shortName)
      expect(item.source.license.url).toMatch(/^https:\/\/creativecommons\.org\/licenses\/by-sa\/(3\.0|4\.0)\/deed\.en$/)
      expect(item.instructions).not.toMatch(/<[^>]+>|https?:\/\//i)
      expect(item.instructions).not.toMatch(/\b(?:diagnos\w*|treat\w*|cure\w*|patient\w*|prescri\w*)\b/i)
      expect(item.media).toBeNull()
      expect(item.compilerEligible).toBe(false)
    }
  })

  it('filters by name, category and equipment without changing source records', () => {
    const source = REFERENCE_EXERCISE_LIBRARY
    const result = filterReferenceExercises(source, {
      query: 'squat',
      category: 'legs',
      equipment: 'Dumbbell',
    })

    expect(result.length).toBeGreaterThan(0)
    expect(result.every(item => item.searchText.includes('squat'))).toBe(true)
    expect(result.every(item => item.category === 'legs')).toBe(true)
    expect(result.every(item => item.equipment.includes('Dumbbell'))).toBe(true)
    expect(REFERENCE_EXERCISE_LIBRARY).toBe(source)
  })

  it('returns no result for an unmatched filter combination', () => {
    expect(filterReferenceExercises(REFERENCE_EXERCISE_LIBRARY, {
      query: 'definitely-not-an-exercise',
      category: 'all',
      equipment: 'all',
    })).toEqual([])
  })
})

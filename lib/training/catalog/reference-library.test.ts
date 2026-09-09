import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  REFERENCE_EXERCISE_LIBRARY,
  filterReferenceExercises,
} from './reference-library'

describe('reference exercise library', () => {
  it('contains at least 250 distinct attributable instruction records', () => {
    expect(REFERENCE_EXERCISE_LIBRARY).toHaveLength(280)
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
      expect(item.compilerEligible).toBe(false)
    }
  })

  it('allows media only for the exact unreviewed Wger 1652 reference record', () => {
    const withMedia = REFERENCE_EXERCISE_LIBRARY.filter(item => item.media !== null)
    expect(withMedia).toHaveLength(1)

    const rdl = withMedia[0]
    expect(rdl.id).toBe('wger:65d12ecf-54b8-466d-a412-e55c396cad69')
    expect(rdl.source.recordId).toBe(1652)
    expect(rdl.reviewStatus).toBe('reference_unreviewed')
    expect(rdl.compilerEligible).toBe(false)
    expect(rdl.media).toMatchObject({
      posterUrl: '/training/reference/wger-1652-dumbbell-romanian-deadlift.webp',
      width: 1200,
      height: 630,
      sha256: '434e5dad93148deff622079705db41b250dae8908f844d92a01349d1cd4361ef',
      source: {
        exerciseRecordId: 1652,
        assetId: 590,
        assetUuid: '0306c8c0-70cc-45d4-92de-6fa72ceaa834',
        author: 'AlucardEvil40',
        license: { shortName: 'CC-BY-SA 4' },
        isAiGenerated: false,
        modifications: 'none',
      },
    })

    const asset = readFileSync(new URL('../../../public/training/reference/wger-1652-dumbbell-romanian-deadlift.webp', import.meta.url))
    expect(createHash('sha256').update(asset).digest('hex')).toBe(rdl.media?.sha256)
    expect(REFERENCE_EXERCISE_LIBRARY
      .filter(item => item.id !== rdl.id)
      .every(item => item.media === null)).toBe(true)
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

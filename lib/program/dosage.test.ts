import { describe, it, expect } from 'vitest'
import { computeDose, resolveDosageType, renderDose } from './dosage'
import type { ExerciseContent } from '../../content/muscles/types'

const ex = (over: Partial<ExerciseContent> & Pick<ExerciseContent, 'slug' | 'category'>): ExerciseContent => ({
  name: over.slug!,
  primaryDeviationKeys: ['forward_head_posture'],
  minZone: 'warning',
  instructions: 'x'.repeat(80),
  sets: 3,
  holdSeconds: 20,
  muscles: [{ muscleSlug: 'deep-cervical-flexors', role: 'strengthen', progressionLevel: 2 }],
  ...over,
})

describe('resolveDosageType', () => {
  it('treats stretches as holds', () => {
    expect(resolveDosageType(ex({ slug: 'doorway-pec-stretch', category: 'stretch' }))).toBe('hold')
  })
  it('treats isometric strengthen drills as holds', () => {
    expect(resolveDosageType(ex({ slug: 'front-plank', category: 'strengthen' }))).toBe('hold')
  })
  it('does NOT mislabel a dynamic press as a hold despite holdSeconds', () => {
    expect(resolveDosageType(ex({ slug: 'pallof-press', category: 'strengthen', holdSeconds: 10 }))).toBe('dynamic')
  })
})

describe('computeDose', () => {
  it('stretch honors the authored hold and ramps sets, never seconds past W2', () => {
    const s = ex({ slug: 'suboccipital-release', category: 'stretch', holdSeconds: 60 })
    expect(computeDose(s, 1)).toMatchObject({ sets: 2, seconds: 60, type: 'hold', reps: null })
    expect(computeDose(s, 2)).toMatchObject({ sets: 3, seconds: 60 })
    expect(computeDose(s, 3)).toMatchObject({ sets: 3, seconds: 60 })
  })

  it('dynamic strengthen ramps reps and adds the single set in week 3', () => {
    const s = ex({ slug: 'chin-tucks', category: 'strengthen' })
    expect(computeDose(s, 1)).toMatchObject({ sets: 2, reps: 10 })
    expect(computeDose(s, 2)).toMatchObject({ sets: 2, reps: 12 })
    expect(computeDose(s, 3)).toMatchObject({ sets: 3, reps: 15 })
  })

  it('activation holds at 2 sets and ramps reps', () => {
    const s = ex({ slug: 'supine-chin-nod', category: 'activation' })
    expect([1, 2, 3].map((w) => computeDose(s, w as 1 | 2 | 3)?.reps)).toEqual([10, 12, 15])
    expect([1, 2, 3].every((w) => computeDose(s, w as 1 | 2 | 3)?.sets === 2)).toBe(true)
  })

  it('isometric strengthen ramps hold seconds, capped at the authored value', () => {
    const s = ex({ slug: 'front-plank', category: 'strengthen', holdSeconds: 30 })
    expect(computeDose(s, 1)?.seconds).toBe(20)
    expect(computeDose(s, 2)?.seconds).toBe(30)
    expect(computeDose(s, 3)?.seconds).toBe(30) // capped at min(40, authored 30)
  })

  it('integrative items appear only in week 3', () => {
    const s = ex({ slug: 'single-leg-rdl', category: 'strengthen' })
    expect(computeDose(s, 1, true)).toBeNull()
    expect(computeDose(s, 2, true)).toBeNull()
    expect(computeDose(s, 3, true)).toMatchObject({ sets: 2, reps: 10 })
  })
})

describe('renderDose', () => {
  it('renders holds and dynamic cells', () => {
    expect(renderDose({ sets: 2, reps: null, seconds: 30, type: 'hold' })).toBe('Hold 30s ×2')
    expect(renderDose({ sets: 3, reps: 15, seconds: null, type: 'dynamic' })).toBe('3×15')
    expect(renderDose(null)).toBe('—')
  })
})

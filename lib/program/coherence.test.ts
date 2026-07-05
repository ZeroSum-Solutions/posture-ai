import { describe, it, expect } from 'vitest'
import { ALL_EXERCISES, ALL_MUSCLES } from '../../content'

// Scored tight/weak muscle slugs for an imbalance key, derived from the graded
// links on each muscle (the link's muscle is its parent MuscleContent.slug).
function scoredSets(key: string) {
  const tight = new Set<string>()
  const weak = new Set<string>()
  for (const m of ALL_MUSCLES) {
    for (const l of m.links) {
      if (l.imbalanceKey !== key || l.scored === false) continue
      if (l.role === 'tight') tight.add(m.slug)
      else if (l.role === 'weak') weak.add(m.slug)
    }
  }
  return { tight, weak }
}

describe('exercise coherence gate (Plan 2 §5.1)', () => {
  const failures: string[] = []
  for (const ex of ALL_EXERCISES) {
    if (ex.category === 'informational') continue
    for (const key of ex.primaryDeviationKeys) {
      const { tight, weak } = scoredSets(key)
      const targets = ex.muscles ?? []
      const hitsTight = targets.some(m => m.role === 'stretch' && tight.has(m.muscleSlug))
      const hitsWeak = targets.some(m => m.role === 'strengthen' && weak.has(m.muscleSlug))
      let ok = false
      if (ex.category === 'stretch') ok = hitsTight
      else if (ex.category === 'strengthen' || ex.category === 'activation') ok = hitsWeak
      else if (ex.category === 'mobility')
        ok = targets.some(m => tight.has(m.muscleSlug) || weak.has(m.muscleSlug))
      if (!ok) failures.push(`${ex.slug} [${ex.category}] × ${key}`)
    }
  }

  it('every exercise targets a coherent muscle for each of its findings', () => {
    expect(failures).toEqual([])
  })
})

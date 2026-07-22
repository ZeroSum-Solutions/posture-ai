import { ALL_MUSCLES } from '../../content'
import type { ExerciseContent } from '../../content/muscles/types'
import { clinicalLinkId } from '../clinical-content/policy'

export interface ScoredSet {
  tight: Set<string>
  weak: Set<string>
}

/**
 * Scored tight/weak muscle slugs per imbalance key, derived from the graded
 * links on each muscle (a link's muscle is its parent MuscleContent.slug).
 * Display-only links (`scored === false`) are excluded, matching the muscle map.
 */
export const SCORED_SETS: Map<string, ScoredSet> = (() => {
  const map = new Map<string, ScoredSet>()
  for (const m of ALL_MUSCLES) {
    for (const l of m.links) {
      if (l.scored === false) continue
      let s = map.get(l.imbalanceKey)
      if (!s) {
        s = { tight: new Set(), weak: new Set() }
        map.set(l.imbalanceKey, s)
      }
      if (l.role === 'tight') s.tight.add(m.slug)
      else if (l.role === 'weak') s.weak.add(m.slug)
    }
  }
  return map
})()

/**
 * Does this exercise act on `key` in the correct DIRECTION — stretch a tight
 * muscle, strengthen a weak one? This is the single definition of exercise↔link
 * coherence, enforced two ways: the content gate (coherence.test.ts) fails
 * authoring-time on any incoherent pair, and candidatesFor() applies it at
 * runtime so a tight link can never credit a strengthen exercise (or vice
 * versa). Informational items are never coherent — they are never programmed.
 */
export function isCoherentForKey(
  ex: ExerciseContent,
  key: string,
  approvedLinkIds?: ReadonlySet<string>,
): boolean {
  if (ex.category === 'informational') return false
  const s = approvedLinkIds
    ? (() => {
        const scoped: ScoredSet = { tight: new Set(), weak: new Set() }
        for (const muscle of ALL_MUSCLES) {
          for (const link of muscle.links) {
            if (
              link.imbalanceKey !== key
              || link.scored === false
              || !approvedLinkIds.has(clinicalLinkId(muscle.slug, link.imbalanceKey, link.role))
            ) continue
            scoped[link.role].add(muscle.slug)
          }
        }
        return scoped
      })()
    : SCORED_SETS.get(key)
  if (!s) return false
  const hitsTight = ex.muscles.some((m) => m.role === 'stretch' && s.tight.has(m.muscleSlug))
  const hitsWeak = ex.muscles.some((m) => m.role === 'strengthen' && s.weak.has(m.muscleSlug))
  if (ex.category === 'stretch') return hitsTight
  if (ex.category === 'strengthen' || ex.category === 'activation') return hitsWeak
  if (ex.category === 'mobility')
    return ex.muscles.some((m) => s.tight.has(m.muscleSlug) || s.weak.has(m.muscleSlug))
  return false
}

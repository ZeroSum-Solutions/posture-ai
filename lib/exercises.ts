/**
 * Which exercises a set of findings warrants.
 *
 * An exercise is recommended when at least one of its `primary_deviation_keys` matches a
 * finding whose zone is reliable and at or above the exercise's `min_zone`. Unreliable
 * findings never recommend anything — a measurement we do not trust must not drive movement.
 */

export const ZONE_ORDER: Record<string, number> = { maintain: 0, warning: 1, danger: 2, unreliable: -1 }

export function zoneAtOrAbove(findingZone: string, minZone: string): boolean {
  return (ZONE_ORDER[findingZone] ?? -1) >= (ZONE_ORDER[minZone] ?? 0)
}

export interface RecommendableExercise {
  primary_deviation_keys: string[]
  min_zone: string
}

export interface ZonedFinding {
  imbalance_key: string
  zone: string
}

export function deriveExerciseRecommendations<E extends RecommendableExercise, F extends ZonedFinding>(
  exercises: E[],
  findings: F[],
): E[] {
  const reliableFindings = findings.filter(f => f.zone !== 'unreliable')
  return exercises.filter(ex =>
    ex.primary_deviation_keys.some(key => {
      const finding = reliableFindings.find(f => f.imbalance_key === key)
      return finding && zoneAtOrAbove(finding.zone, ex.min_zone)
    })
  )
}

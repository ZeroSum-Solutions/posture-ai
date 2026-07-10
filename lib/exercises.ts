/**
 * Which exercises a set of findings warrants.
 *
 * An exercise is recommended when at least one of its `primaryDeviationKeys` matches a
 * finding whose zone is reliable and at or above the exercise's `minZone`. Unreliable
 * findings never recommend anything — a measurement we do not trust must not drive movement.
 *
 * Reads authored `content/` exercises, the same source lib/program/buildProgram.ts builds
 * from, and enforces the same two exclusions it does: informational items are reference
 * reading rather than movement, and an exercise is withheld when any of its
 * `contraindicatedDeviationKeys` is screened in the client. Selection ORs over the
 * client's finding keys, so a match on finding A says nothing about a concurrent
 * finding B that makes the exercise unsafe.
 */

export const ZONE_ORDER: Record<string, number> = { maintain: 0, warning: 1, danger: 2, unreliable: -1 }

export function zoneAtOrAbove(findingZone: string, minZone: string): boolean {
  return (ZONE_ORDER[findingZone] ?? -1) >= (ZONE_ORDER[minZone] ?? 0)
}

export interface RecommendableExercise {
  category: string
  primaryDeviationKeys: string[]
  contraindicatedDeviationKeys?: string[]
  minZone: string
}

export interface ZonedFinding {
  imbalance_key: string
  zone: string
}

/**
 * The client's finding keys that can veto an exercise: reliable, and in an actionable
 * zone. `maintain` is a negative screen (measured within normal range) and `unreliable`
 * means not measurable — neither is evidence the deviation is present. Mirrors
 * screenedKeysFor in lib/program/buildProgram.ts, where `reliable` is `zone !== 'unreliable'`.
 */
function screenedKeysFor(findings: ZonedFinding[]): string[] {
  return findings.filter(f => f.zone === 'warning' || f.zone === 'danger').map(f => f.imbalance_key)
}

export function deriveExerciseRecommendations<E extends RecommendableExercise, F extends ZonedFinding>(
  exercises: E[],
  findings: F[],
): E[] {
  const reliableFindings = findings.filter(f => f.zone !== 'unreliable')
  const screenedKeys = screenedKeysFor(findings)
  return exercises.filter(ex =>
    ex.category !== 'informational' &&
    ex.primaryDeviationKeys.some(key => {
      const finding = reliableFindings.find(f => f.imbalance_key === key)
      return finding && zoneAtOrAbove(finding.zone, ex.minZone)
    }) &&
    !(ex.contraindicatedDeviationKeys ?? []).some(k => screenedKeys.includes(k))
  )
}

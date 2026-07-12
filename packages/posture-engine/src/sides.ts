import type { Finding, SideObservation } from './types'

/** Project one side's Finding into a display observation (spec §11.2). */
export function toObservation(f: Finding, profileSide: 'left' | 'right'): SideObservation {
  return {
    profileSide,
    deviation: f.deviation,
    direction: f.direction,
    severityPct: f.severityPct,
    zone: f.zone,
    confidence: f.confidence,
    reliable: f.reliable,
    ...(f.stabilityScore !== undefined ? { stabilityScore: f.stabilityScore } : {}),
    ...(f.uncertaintyDeg !== undefined ? { uncertaintyDeg: f.uncertaintyDeg } : {}),
    ...(f.borderline ? { borderline: true } : {}),
  }
}

/**
 * Total order for "worst" (spec §11.2): returns <0 when `a` is worse (should
 * win) than `b`. reliable > unreliable; both-unreliable short-circuits to left;
 * then higher severityPct, then higher |deviation|, then left before right.
 */
export function compareSide(a: SideObservation, b: SideObservation): number {
  if (a.reliable !== b.reliable) return a.reliable ? -1 : 1
  // Both unreliable → left deterministically (unreliable severityPct is 0 and
  // unreliable deviations aren't meaningfully comparable).
  if (!a.reliable && !b.reliable)
    return a.profileSide === 'left' ? -1 : b.profileSide === 'left' ? 1 : 0
  if (a.severityPct !== b.severityPct) return b.severityPct - a.severityPct
  const ad = Math.abs(a.deviation), bd = Math.abs(b.deviation)
  if (ad !== bd) return bd - ad
  return a.profileSide === b.profileSide ? 0 : a.profileSide === 'left' ? -1 : 1
}

/**
 * Pick the worst of two ALREADY-AGGREGATED per-side findings (each produced by
 * the engine's existing aggregate(), so per-side burst stability is preserved).
 * The aggregate copies the driving finding's scored fields verbatim and attaches
 * both sides as `observations` + the winning `drivingProfileSide` (spec §11.2).
 */
export function aggregateSagittal(
  left: { finding: Finding; side: 'left' } | null,
  right: { finding: Finding; side: 'right' } | null,
): Finding | null {
  const parts = [left, right].filter(Boolean) as { finding: Finding; side: 'left' | 'right' }[]
  if (parts.length === 0) return null
  const observations = parts.map(p => toObservation(p.finding, p.side))
  const winnerIdx = observations
    .map((o, i) => [o, i] as const)
    .sort(([a], [b]) => compareSide(a, b))[0][1]
  const driver = parts[winnerIdx].finding
  return { ...driver, observations, drivingProfileSide: parts[winnerIdx].side }
}

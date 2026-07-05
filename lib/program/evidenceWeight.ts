export type LinkEvidence = 'high' | 'medium' | 'low'
const WEIGHT: Record<LinkEvidence, number> = { high: 1.0, medium: 0.7, low: 0.4 }
/** Evidence weight for a link grade; ungraded defaults to medium-equivalent. */
export function evidenceWeight(confidence?: LinkEvidence): number {
  return WEIGHT[confidence as LinkEvidence] ?? 0.7
}
/** Max evidence an exercise carries for a finding: the best-graded link among
 * the finding's muscles that the exercise targets. 0 if it targets none. */
export function exerciseEvidenceForKey(
  targetSlugs: string[],
  keyLinks: Array<{ muscleSlug: string; confidence?: LinkEvidence }>,
): number {
  let best = 0
  for (const l of keyLinks) {
    if (targetSlugs.includes(l.muscleSlug)) best = Math.max(best, evidenceWeight(l.confidence))
  }
  return best
}

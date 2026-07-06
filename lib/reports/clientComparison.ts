/**
 * Plain-language "since last time" comparison for the CLIENT-facing report.
 * Pure + deterministic so it's unit-tested in isolation; the route feeds it the
 * current vs prior assessment data and hands the result to the PDF.
 *
 * Engine conventions it relies on (asserted by the tests):
 *   overallScore 0-100, HIGHER = worse  → a decrease is an improvement
 *   severity_pct HIGHER = worse         → a decrease is an improvement
 *   grade rank S > A > B > C > D > E
 *
 * Framing is intentionally non-diagnostic: this describes screening-score
 * movement, not a clinical change.
 */
export type OverallDirection = 'improved' | 'steady' | 'slipped' | 'not_comparable'
export type AreaDirection = 'improving' | 'steady' | 'attention'

export interface ClientComparison {
  priorDateStr: string
  priorGrade: string
  currentGrade: string
  overall: OverallDirection
  /** imbalance_key → direction, only for areas present in BOTH screenings. */
  byKey: Record<string, AreaDirection>
}

interface FindingSeverity {
  key: string
  severityPct: number
}

const GRADE_RANK: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4, E: 5, F: 6 }
// Lower-is-better signals; movements smaller than these read as "about the same"
// so normal capture-to-capture noise isn't dressed up as real change.
const SCORE_DEADBAND = 3
const SEVERITY_DEADBAND = 5

export function buildClientComparison(args: {
  priorDateStr: string
  current: { grade: string; score: number }
  prior: { grade: string; score: number }
  currentFindings: FindingSeverity[]
  priorFindings: FindingSeverity[]
}, opts?: { engineVersionMismatch?: boolean }): ClientComparison {
  const { priorDateStr, current, prior, currentFindings, priorFindings } = args

  const priorByKey = new Map(priorFindings.map((f) => [f.key, f.severityPct]))
  const byKey: Record<string, AreaDirection> = {}
  for (const f of currentFindings) {
    const before = priorByKey.get(f.key)
    if (before === undefined) continue // no prior reading for this area — nothing to compare
    const d = f.severityPct - before
    byKey[f.key] = d <= -SEVERITY_DEADBAND ? 'improving' : d >= SEVERITY_DEADBAND ? 'attention' : 'steady'
  }

  if (opts?.engineVersionMismatch) {
    return { priorDateStr, priorGrade: prior.grade, currentGrade: current.grade, overall: 'not_comparable', byKey }
  }

  // Overall: a grade change is unambiguous, so it decides direction. Within the
  // same grade, the (lower-is-better) score breaks the tie against a deadband.
  let overall: OverallDirection
  const cr = GRADE_RANK[current.grade]
  const pr = GRADE_RANK[prior.grade]
  if (cr !== undefined && pr !== undefined && cr !== pr) {
    overall = cr < pr ? 'improved' : 'slipped'
  } else {
    const d = current.score - prior.score
    overall = d <= -SCORE_DEADBAND ? 'improved' : d >= SCORE_DEADBAND ? 'slipped' : 'steady'
  }

  return { priorDateStr, priorGrade: prior.grade, currentGrade: current.grade, overall, byKey }
}

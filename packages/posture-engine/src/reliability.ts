// Test-retest reliability statistics for the screening/tracking positioning
// (docs/plans/2026-07-17-reliability-baseline.md §2).
//
// Input: a repeated-measures matrix — one row per case (a stable true posture:
// subject×pose×device under golden/protocol.md), one column per re-positioned
// capture. This quantifies RE-SHOOT repeatability, which within-burst
// stabilityScore (types.ts) explicitly cannot see.

export interface ReliabilityStats {
  nCases: number
  kRepeats: number
  /** ICC(2,1): two-way random effects, single measures, absolute agreement. */
  icc21: number
  /** Standard error of measurement: SD·√(1−ICC), in metric units (degrees). */
  sem: number
  /** Minimal detectable change, 95%: 1.96·√2·SEM. Deltas below this are noise. */
  mdc95: number
  mean: number
  /** Sample SD of all measurements (pooled across cases and repeats). */
  sd: number
}

export interface RepeatMatrix {
  /** Rows = cases with the full repeat count, in first-seen order. */
  matrix: number[][]
  /** Cases excluded for having fewer than kRepeats values (complete-case analysis). */
  droppedCases: string[]
  /** Max repeat count observed across cases; 0 when there are no records. */
  kRepeats: number
}

/**
 * Groups per-capture values into the repeated-measures matrix
 * testRetestReliability expects. Values sharing a caseKey are that case's
 * repeats, in insertion order; cases missing repeats are dropped and reported.
 */
export function buildRepeatMatrix(
  records: Array<{ caseKey: string; value: number }>,
): RepeatMatrix {
  const byCase = new Map<string, number[]>()
  for (const { caseKey, value } of records) {
    const values = byCase.get(caseKey) ?? []
    values.push(value)
    byCase.set(caseKey, values)
  }
  const kRepeats = Math.max(0, ...[...byCase.values()].map((v) => v.length))
  const matrix: number[][] = []
  const droppedCases: string[] = []
  for (const [caseKey, values] of byCase) {
    if (values.length === kRepeats) matrix.push(values)
    else droppedCases.push(caseKey)
  }
  return { matrix, droppedCases, kRepeats }
}

/**
 * Returns null below the minimum sample (fewer than 3 cases or 2 repeats) —
 * the statistics are meaningless there. Throws on a ragged matrix.
 */
export function testRetestReliability(matrix: number[][]): ReliabilityStats | null {
  const n = matrix.length
  if (n === 0) return null
  const k = matrix[0].length
  for (const row of matrix) {
    if (row.length !== k) {
      throw new Error(`ragged matrix: expected ${k} repeats, got ${row.length}`)
    }
  }
  if (n < 3 || k < 2) return null

  const flat = matrix.flat()
  const grand = flat.reduce((s, v) => s + v, 0) / (n * k)
  const rowMeans = matrix.map((row) => row.reduce((s, v) => s + v, 0) / k)
  const colMeans = Array.from({ length: k }, (_, j) =>
    matrix.reduce((s, row) => s + row[j], 0) / n,
  )

  const ssr = k * rowMeans.reduce((s, m) => s + (m - grand) ** 2, 0)
  const ssc = n * colMeans.reduce((s, m) => s + (m - grand) ** 2, 0)
  const sst = flat.reduce((s, v) => s + (v - grand) ** 2, 0)
  if (sst === 0) return null // zero variance everywhere — ICC is undefined
  const sse = sst - ssr - ssc
  const msr = ssr / (n - 1)
  const msc = ssc / (k - 1)
  const mse = sse / ((n - 1) * (k - 1))

  const icc21 = (msr - mse) / (msr + (k - 1) * mse + (k / n) * (msc - mse))

  const sd = Math.sqrt(flat.reduce((s, v) => s + (v - grand) ** 2, 0) / (n * k - 1))
  const sem = sd * Math.sqrt(Math.max(0, 1 - icc21))
  const mdc95 = 1.96 * Math.SQRT2 * sem

  return { nCases: n, kRepeats: k, icc21, sem, mdc95, mean: grand, sd }
}

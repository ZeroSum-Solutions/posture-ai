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
  /** Cases excluded for missing one or more expected repeat labels. */
  droppedCases: string[]
  /** Repeat labels defining the matrix columns, in canonical order. */
  repeatIds: string[]
  /** Number of labeled repeat columns; 0 when there are no records or expected labels. */
  kRepeats: number
}

/**
 * Groups per-capture values into the repeated-measures matrix
 * testRetestReliability expects. Repeat labels, not record insertion order,
 * define the columns. Cases missing an expected repeat are dropped and
 * reported; duplicate or unexpected case/repeat cells fail loudly.
 */
export function buildRepeatMatrix(
  records: Array<{ caseKey: string; repeatId: string; value: number }>,
  expectedRepeatIds?: readonly string[],
): RepeatMatrix {
  const inferredRepeatIds = [...new Set(records.map((record) => record.repeatId))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const repeatIds = expectedRepeatIds ? [...expectedRepeatIds] : inferredRepeatIds
  if (new Set(repeatIds).size !== repeatIds.length) {
    throw new Error('duplicate repeat label in expectedRepeatIds')
  }

  const expected = new Set(repeatIds)
  const byCase = new Map<string, Map<string, number>>()
  for (const { caseKey, repeatId, value } of records) {
    if (!Number.isFinite(value)) {
      throw new Error(`repeat value must be finite for case ${caseKey}, repeat ${repeatId}`)
    }
    if (!expected.has(repeatId)) {
      throw new Error(`unexpected repeat label ${repeatId} for case ${caseKey}`)
    }
    const values = byCase.get(caseKey) ?? new Map<string, number>()
    if (values.has(repeatId)) {
      throw new Error(`duplicate repeat ${repeatId} for case ${caseKey}`)
    }
    values.set(repeatId, value)
    byCase.set(caseKey, values)
  }

  const kRepeats = repeatIds.length
  const matrix: number[][] = []
  const droppedCases: string[] = []
  for (const [caseKey, values] of byCase) {
    if (repeatIds.every((repeatId) => values.has(repeatId))) {
      matrix.push(repeatIds.map((repeatId) => values.get(repeatId)!))
    }
    else droppedCases.push(caseKey)
  }
  return { matrix, droppedCases, repeatIds, kRepeats }
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
    if (row.some((value) => !Number.isFinite(value))) {
      throw new Error('reliability matrix values must be finite')
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
  // icc21 is reported as computed (a negative value is itself informative),
  // but for SEM it is clamped into [0,1] (Weir 2005): a negative ICC would
  // otherwise yield SEM > SD, which is nonsensical — SEM saturates at SD.
  const sem = sd * Math.sqrt(1 - Math.min(1, Math.max(0, icc21)))
  const mdc95 = 1.96 * Math.SQRT2 * sem

  return { nCases: n, kRepeats: k, icc21, sem, mdc95, mean: grand, sd }
}

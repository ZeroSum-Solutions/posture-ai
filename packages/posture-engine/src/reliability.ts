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
  /** ICC(A,1), equivalently ICC(2,1): two-way random, single-measure absolute agreement. */
  icc21: number
  /** Two-way ANOVA mean squares used by ICC(A,1). */
  meanSquares: {
    cases: number
    occasions: number
    error: number
  }
  /** Signed method-of-moments components. Negative values remain diagnostic. */
  varianceComponents: {
    cases: number
    occasions: number
    error: number
  }
  /** Variance components floored at zero for error-bound calculations. */
  nonnegativeVarianceComponents: {
    cases: number
    occasions: number
    error: number
  }
  /** Consistency SEM: √MSE, excluding systematic repeat-to-repeat offsets. */
  semConsistency: number
  /** Absolute-agreement SEM: √(MSE + max(0, occasion variance)). */
  semAgreement: number
  /**
   * @deprecated Use semAgreement. Retained for stored-report compatibility.
   */
  sem: number
  /** Minimal detectable change, 95%: 1.96·√2·SEM_agreement. */
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
  // Compute residuals directly. `sst - ssr - ssc` can become a tiny negative
  // number for an exactly additive matrix because of cancellation.
  const sse = matrix.reduce((sum, row, i) =>
    sum + row.reduce((rowSum, value, j) =>
      rowSum + (value - rowMeans[i] - colMeans[j] + grand) ** 2, 0), 0)
  const msr = ssr / (n - 1)
  const msc = ssc / (k - 1)
  const mse = sse / ((n - 1) * (k - 1))

  const denominator = msr + (k - 1) * mse + (k / n) * (msc - mse)
  if (denominator === 0) return null
  const icc21 = (msr - mse) / denominator

  const sd = Math.sqrt(flat.reduce((s, v) => s + (v - grand) ** 2, 0) / (n * k - 1))
  const varianceComponents = {
    cases: (msr - mse) / k,
    occasions: (msc - mse) / n,
    error: mse,
  }
  const nonnegativeVarianceComponents = {
    cases: Math.max(0, varianceComponents.cases),
    occasions: Math.max(0, varianceComponents.occasions),
    error: Math.max(0, varianceComponents.error),
  }
  const semConsistency = Math.sqrt(mse)
  const semAgreement = Math.sqrt(mse + nonnegativeVarianceComponents.occasions)
  const mdc95 = 1.96 * Math.SQRT2 * semAgreement

  return {
    nCases: n,
    kRepeats: k,
    icc21,
    meanSquares: { cases: msr, occasions: msc, error: mse },
    varianceComponents,
    nonnegativeVarianceComponents,
    semConsistency,
    semAgreement,
    sem: semAgreement,
    mdc95,
    mean: grand,
    sd,
  }
}

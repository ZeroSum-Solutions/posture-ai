// Pure comparison logic for the Moti-Physio validation harness:
// agreement statistics (per the rebuild plan's methodology: ICC,
// Bland–Altman limits of agreement, MAE), ground-truth angle extraction
// from Moti debug landmarks, and debug-record → session pairing.

import { debugTimeToIsoDate, type DebugRecord } from './decode'
import type { SessionData } from './walk'

export interface AgreementStats {
  n: number
  mae: number
  bias: number
  loaLow: number
  loaHigh: number
  pearson: number
  icc21: number
}

/**
 * Agreement between paired measurements (engine vs ground truth).
 * ICC(2,1): two-way random effects, single measures, absolute agreement.
 * Returns null below 3 pairs — the statistics are meaningless there.
 */
export function agreementStats(engine: number[], truth: number[]): AgreementStats | null {
  if (engine.length !== truth.length) {
    throw new Error(`length mismatch: ${engine.length} vs ${truth.length}`)
  }
  const n = engine.length
  if (n < 3) return null
  const k = 2

  const diffs = engine.map((value, i) => value - truth[i])
  const mae = diffs.reduce((sum, d) => sum + Math.abs(d), 0) / n
  const bias = diffs.reduce((sum, d) => sum + d, 0) / n
  const sdDiff = Math.sqrt(
    diffs.reduce((sum, d) => sum + (d - bias) ** 2, 0) / (n - 1),
  )

  const meanEngine = engine.reduce((s, v) => s + v, 0) / n
  const meanTruth = truth.reduce((s, v) => s + v, 0) / n
  const cov = engine.reduce((s, v, i) => s + (v - meanEngine) * (truth[i] - meanTruth), 0)
  const varEngine = engine.reduce((s, v) => s + (v - meanEngine) ** 2, 0)
  const varTruth = truth.reduce((s, v) => s + (v - meanTruth) ** 2, 0)
  const pearson = cov / Math.sqrt(varEngine * varTruth)

  const grand = (meanEngine + meanTruth) / 2
  const rowMeans = engine.map((v, i) => (v + truth[i]) / 2)
  const ssr = k * rowMeans.reduce((s, m) => s + (m - grand) ** 2, 0)
  const ssc = n * ((meanEngine - grand) ** 2 + (meanTruth - grand) ** 2)
  const sst = [...engine, ...truth].reduce((s, v) => s + (v - grand) ** 2, 0)
  const sse = sst - ssr - ssc
  const msr = ssr / (n - 1)
  const msc = ssc / (k - 1)
  const mse = sse / ((n - 1) * (k - 1))
  const icc21 = (msr - mse) / (msr + (k - 1) * mse + (k / n) * (msc - mse))

  return {
    n,
    mae,
    bias,
    loaLow: bias - 1.96 * sdDiff,
    loaHigh: bias + 1.96 * sdDiff,
    pearson,
    icc21,
  }
}

/**
 * Shoulder-line tilt in degrees from the Moti debug acromial landmarks,
 * mirror-invariant (same convention as the engine's shoulder imbalance:
 * atan2(|Δy|, |Δx|)). Pixel coordinates, so no aspect correction needed.
 */
export function shoulderAngleFromDebug(record: DebugRecord): number | null {
  const left = record.points['acromialEnd[0]']
  const right = record.points['acromialEnd[1]']
  if (!left || !right) return null
  return (
    Math.atan2(Math.abs(left.y - right.y), Math.abs(left.x - right.x)) *
    (180 / Math.PI)
  )
}

/**
 * Pair per-client debug records with capture sessions, keyed on capture
 * timestamps: each record's date must match the session's screening date,
 * and a date shared by multiple sessions or records pairs nothing (no
 * guessing). When dates are unavailable on both sides, falls back to
 * positional pairing for equal counts, or a lone record ↔ lone session.
 */
export function pairDebugRecords(
  records: DebugRecord[],
  sessions: SessionData[],
): (DebugRecord | null)[] {
  const paired: (DebugRecord | null)[] = Array(sessions.length).fill(null)

  const anyDates = sessions.some((s) => s.date !== null)
  if (anyDates) {
    // Group by date. Within a date, record file order and session index
    // order are both chronological, so equal-count groups pair positionally
    // (covers same-day re-screenings); unequal counts pair nothing.
    const dates = new Set(sessions.map((s) => s.date).filter((d) => d !== null))
    for (const date of dates) {
      const sessionIdxs = sessions
        .map((s, i) => (s.date === date ? i : -1))
        .filter((i) => i >= 0)
      const dateRecords = records.filter((r) => debugTimeToIsoDate(r.time) === date)
      if (dateRecords.length !== sessionIdxs.length) continue
      sessionIdxs.forEach((sessionIdx, k) => {
        paired[sessionIdx] = dateRecords[k]
      })
    }
    return paired
  }

  if (records.length === sessions.length) return [...records]
  return paired
}

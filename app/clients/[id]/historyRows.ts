import { compareOverallScores } from '@/lib/comparison/policy'
import { deltaIcon, formatDelta, type DeltaArrow, type SeverityBand } from '@/components/array/severity'
import { formatClientDate, formatClientTime } from './clientDate'

/**
 * Scan-history rows, newest first, each carrying its movement against the scan
 * before it.
 *
 * The delta is the shared comparison policy's, so version, chronology, and
 * missing-value checks stay consistent with the Compare workspace:
 *
 * - comparable → signed recorded magnitude in a neutral tone
 * - not comparable → "new engine", neutral, no number
 *
 * The oldest scan has nothing to compare against and reads "baseline", not "0".
 */

export interface HistoryRowInput {
  id: string
  assessedAt: string
  overallGrade: string | null
  overallScore: number | null
  scoringEngineVersion: string | null
}

export interface HistoryRow {
  id: string
  href: string
  grade: string | null
  dateLabel: string
  /** `Deviation 46 / 100`, or the reason there is no score. */
  meta: string
  delta: string | null
  deltaBand: SeverityBand
  deltaIcon: DeltaArrow | null
  /** Shown when there is no signed magnitude to show. */
  deltaWord: string | null
}

function dateLabel(iso: string): string {
  return formatClientDate(iso, 'day-month-short')
}

function timeLabel(iso: string): string | null {
  return formatClientTime(iso)
}

/**
 * `history` must be chronological (oldest first) — the same order the route
 * holds it in. The returned rows are reversed to newest first for display.
 */
export function buildHistoryRows(history: readonly HistoryRowInput[]): HistoryRow[] {
  // Two scans on one day are common — a re-capture after a failed attempt, or a
  // morning and afternoon reading. Rows labelled with the date alone would be
  // indistinguishable while carrying different scores, so a repeated day gets
  // the time as well. Days that occur once stay uncluttered.
  const dayCounts = new Map<string, number>()
  for (const scan of history) {
    const label = dateLabel(scan.assessedAt)
    dayCounts.set(label, (dayCounts.get(label) ?? 0) + 1)
  }

  return history
    .map((scan, index) => {
      const prior = index > 0 ? history[index - 1] : null
      const decision = prior
        ? compareOverallScores({
          current: scan.overallScore,
          prior: prior.overallScore,
          currentEngineVersion: scan.scoringEngineVersion,
          priorEngineVersion: prior.scoringEngineVersion,
          currentAssessedAt: scan.assessedAt,
          priorAssessedAt: prior.assessedAt,
        })
        : null

      const comparable = decision !== null
        && decision.status !== 'not_comparable'
        && decision.delta !== null

      const day = dateLabel(scan.assessedAt)
      const time = (dayCounts.get(day) ?? 0) > 1 ? timeLabel(scan.assessedAt) : null

      return {
        id: scan.id,
        href: `/assessments/${scan.id}`,
        grade: scan.overallGrade,
        dateLabel: time ? `${day} · ${time}` : day,
        meta: scan.overallScore === null
          ? 'No screening score recorded'
          : `Deviation ${Math.round(scan.overallScore)} / 100`,
        delta: comparable ? formatDelta(decision.delta) : null,
        deltaBand: 'neutral' as SeverityBand,
        deltaIcon: comparable ? deltaIcon(decision.delta) : null,
        deltaWord: comparable
          ? null
          : decision === null
            ? 'baseline'
            : decision.status === 'not_comparable'
              ? 'new engine'
              : 'flat',
      }
    })
    .reverse()
}

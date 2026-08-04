import { compareOverallScores } from '@/lib/comparison/policy'
import { deltaIcon, formatDelta, type DeltaArrow, type SeverityBand } from '@/components/array/severity'

/**
 * Scan-history rows, newest first, each carrying its movement against the scan
 * before it.
 *
 * The delta is the shared comparison policy's, so a row cannot claim a direction
 * the Compare workspace would refuse. Three outcomes are drawn differently on
 * purpose:
 *
 * - directional  → signed magnitude in the movement's tone
 * - inside tolerance or unchanged → "flat", neutral, no number
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
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return 'Date unavailable'
  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

function timeLabel(iso: string): string | null {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  })
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

      const directional = decision?.status === 'improved' || decision?.status === 'regressed'

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
        delta: directional && decision?.delta != null ? formatDelta(decision.delta) : null,
        deltaBand: (decision?.status === 'improved'
          ? 'maintain'
          : decision?.status === 'regressed'
            ? 'review'
            : 'neutral') as SeverityBand,
        deltaIcon: directional && decision ? deltaIcon(decision.delta) : null,
        deltaWord: directional
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

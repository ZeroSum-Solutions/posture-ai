import {
  compareOverallScores,
  comparisonDecisionText,
  comparisonStatusText,
  FIXED_COMPARISON_TOLERANCE,
  type ComparisonDecision,
} from '@/lib/comparison/policy'
import {
  bandFromGrade,
  deltaIcon,
  formatDelta,
  SCORE_BAND_STOPS,
  type DeltaArrow,
  type SeverityBand,
} from '@/components/array/severity'

/**
 * Geometry and copy for the client-detail deviation-score chart.
 *
 * Everything here is derived: the maintain band comes from the engine's grade
 * thresholds, the tolerance band from the shared comparison policy, and the
 * verdict from `compareOverallScores` — the same decision the Compare workspace
 * and both PDF variants render. This module invents no clinical meaning; if the
 * policy says two scans are not comparable, the chart says so and draws no
 * verdict, no tolerance band, and no line between them.
 *
 * The score domain is pinned to 0–100 rather than fitted to the data. An
 * auto-scaled axis would make a two-point wobble look like a cliff, which on a
 * screening trend is a clinical misread, not a cosmetic one.
 */

/* ── Plot box, in the SVG's own user units ──────────────────────────────── */

export const CHART_VIEWBOX = { width: 330, height: 180 } as const
const PLOT = { left: 22, right: 308, top: 20, bottom: 152 } as const
const SCORE_DOMAIN = 100
/** Grid lines are reference scores, not pixel offsets. */
const GRID_SCORES = [25, 50, 75] as const
/** Above this many points, per-point labels collide on a 390px viewport. */
const MAX_POINT_LABELS = 5
const MAX_DATE_LABELS = 3

function yForScore(score: number): number {
  const clamped = Math.min(Math.max(score, 0), SCORE_DOMAIN)
  return PLOT.bottom - (clamped / SCORE_DOMAIN) * (PLOT.bottom - PLOT.top)
}

function xForIndex(index: number, count: number): number {
  if (count <= 1) return (PLOT.left + PLOT.right) / 2
  return PLOT.left + (index / (count - 1)) * (PLOT.right - PLOT.left)
}

/**
 * Which indexes carry a visible label. Always the first and last — the baseline
 * and the current reading are the two a practitioner reads off the chart — then
 * an even spread between them up to the cap.
 */
function labelledIndexes(count: number, cap: number): ReadonlySet<number> {
  if (count <= cap) return new Set(Array.from({ length: count }, (_, index) => index))
  const step = (count - 1) / (cap - 1)
  const kept = new Set<number>()
  for (let slot = 0; slot < cap; slot += 1) kept.add(Math.round(slot * step))
  return kept
}

/* ── Inputs and outputs ─────────────────────────────────────────────────── */

export interface TrendInputPoint {
  id: string
  assessedAt: string
  score: number | null
  grade: string | null
  scoringEngineVersion: string | null
  /** Contiguous scoring-version run, from segmentTrendHistory. */
  segmentId: string
}

export interface TrendChartPoint {
  id: string
  x: number
  y: number
  score: number
  grade: string | null
  band: SeverityBand
  /** `46 · C`, or `46` when the grade is missing. */
  valueLabel: string
  showValueLabel: boolean
  dateLabel: string
  showDateLabel: boolean
  isLatest: boolean
}

export interface TrendVerdict {
  /** Policy wording, never re-phrased here. */
  text: string
  /** `−16 pts`, or null when the policy reports no directional movement. */
  magnitude: string | null
  band: SeverityBand
  icon: DeltaArrow
  decision: ComparisonDecision
}

export interface TrendChartModel {
  points: TrendChartPoint[]
  /** One polyline per scoring-version run; runs are never joined. */
  runs: Array<{ segmentId: string; polyline: string }>
  /** Filled area under the most recent run only, as a reading aid. */
  areaPath: string | null
  gridLines: Array<{ y: number; score: number }>
  maintainBand: { y: number; height: number; label: string }
  /**
   * The measurement tolerance around the latest reading, drawn to the same scale
   * as the data and spanning the interval the comparison covers.
   *
   * It is a band rather than a whisker on the point because ±3 of a 0–100 domain
   * is about eight user units — shorter than the diameter of the dot it would sit
   * behind. A band the width of the compared interval is the same quantity, drawn
   * where it can actually be seen, and never inflated to make it visible.
   */
  tolerance: { x1: number; x2: number; y1: number; y2: number; points: number } | null
  verdict: TrendVerdict | null
  /** Sentence under the chart. Explains the tolerance band, or why there is none. */
  footnote: string
  /** Sentence read by assistive technology in place of the drawing. */
  description: string
}

const MAINTAIN_MAX = SCORE_BAND_STOPS.maintain

function scoreLabel(score: number, grade: string | null): string {
  const rounded = String(Math.round(score))
  const letter = (grade ?? '').trim()
  return letter ? `${rounded} · ${letter}` : rounded
}

function dateLabel(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return '—'
  // UTC, matching every other calendar-date projection on this route, so a
  // server render and a later browser render name the same stored day.
  return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/**
 * Build the verdict from the latest two readings.
 *
 * `compareOverallScores` owns comparability: it rejects a version mismatch, a
 * non-chronological pair, and a missing reading on its own, so this function
 * does not re-check any of them.
 */
function buildVerdict(points: readonly TrendInputPoint[]): TrendVerdict | null {
  if (points.length < 2) return null
  const current = points[points.length - 1]
  const prior = points[points.length - 2]
  const decision = compareOverallScores({
    current: current.score,
    prior: prior.score,
    currentEngineVersion: current.scoringEngineVersion,
    priorEngineVersion: prior.scoringEngineVersion,
    currentAssessedAt: current.assessedAt,
    priorAssessedAt: prior.assessedAt,
  })

  const band: SeverityBand = decision.status === 'improved'
    ? 'maintain'
    : decision.status === 'regressed'
      ? 'review'
      : 'neutral'

  // Only a directional decision earns an arrow and a magnitude. "Within
  // measurement tolerance" is a statement that the movement means nothing, so
  // showing its size next to the words would argue against them.
  const directional = decision.status === 'improved' || decision.status === 'regressed'

  return {
    text: comparisonStatusText(decision.status, 'overall'),
    magnitude: directional && decision.delta !== null
      ? `${formatDelta(decision.delta)} pts`
      : null,
    band,
    icon: directional ? deltaIcon(decision.delta) : ('arrow-right-linear' as DeltaArrow),
    decision,
  }
}

function buildFootnote(verdict: TrendVerdict | null, tolerancePoints: number): string {
  if (!verdict) {
    return `A second scan starts the trend. Movements smaller than ${tolerancePoints} screening-score points count as measurement noise.`
  }
  if (verdict.decision.status === 'not_comparable') {
    return comparisonDecisionText(verdict.decision, 'overall')
  }
  const band = `The shaded band on the latest reading is the ±${tolerancePoints}-point measurement tolerance.`
  if (verdict.decision.status === 'improved' || verdict.decision.status === 'regressed') {
    return `${band} This movement clears it, so the change is directional rather than noise.`
  }
  if (verdict.decision.status === 'within_tolerance') {
    return `${band} This movement sits inside it, so it is not read as a change.`
  }
  return `${band} The score is unchanged.`
}

function buildDescription(points: readonly TrendChartPoint[], verdict: TrendVerdict | null): string {
  if (points.length === 0) return 'No screening scores recorded yet.'
  const first = points[0]
  const last = points[points.length - 1]
  const span = points.length === 1
    ? `One screening score: ${scoreLabel(last.score, last.grade)} on ${last.dateLabel}.`
    : `${points.length} screening scores from ${scoreLabel(first.score, first.grade)} on ${first.dateLabel} to ${scoreLabel(last.score, last.grade)} on ${last.dateLabel}.`
  const reading = `Deviation score out of 100; lower is better. Maintain is ${MAINTAIN_MAX} or lower.`
  return verdict ? `${span} ${reading} Latest against previous: ${verdict.text}.` : `${span} ${reading}`
}

/**
 * Turn a chronological history into the chart's geometry and copy.
 *
 * Readings with no score are dropped rather than plotted at zero — a missing
 * measurement is not a perfect one. Dropping them can leave a run with a single
 * member, which draws as a lone dot with no connecting line, correctly.
 */
export function buildTrendChart(history: readonly TrendInputPoint[]): TrendChartModel {
  const plottable = history.filter((point): point is TrendInputPoint & { score: number } => (
    typeof point.score === 'number' && Number.isFinite(point.score)
  ))
  const count = plottable.length
  const valueLabels = labelledIndexes(count, MAX_POINT_LABELS)
  const dateLabels = labelledIndexes(count, MAX_DATE_LABELS)

  const points: TrendChartPoint[] = plottable.map((point, index) => ({
    id: point.id,
    x: xForIndex(index, count),
    y: yForScore(point.score),
    score: point.score,
    grade: point.grade,
    band: bandFromGrade(point.grade),
    valueLabel: scoreLabel(point.score, point.grade),
    showValueLabel: valueLabels.has(index),
    dateLabel: dateLabel(point.assessedAt),
    showDateLabel: dateLabels.has(index),
    isLatest: index === count - 1,
  }))

  // One polyline per scoring-version run. A line between runs would assert that
  // two engine versions produce comparable scores, which is exactly what
  // segmentTrendHistory exists to deny.
  const runs: TrendChartModel['runs'] = []
  plottable.forEach((point, index) => {
    const open = runs[runs.length - 1]
    if (open && open.segmentId === point.segmentId) {
      runs[runs.length - 1] = {
        segmentId: open.segmentId,
        polyline: `${open.polyline} ${points[index].x},${points[index].y}`,
      }
      return
    }
    runs.push({ segmentId: point.segmentId, polyline: `${points[index].x},${points[index].y}` })
  })

  const lastRun = runs[runs.length - 1]
  const lastRunPoints = lastRun
    ? points.filter((_, index) => plottable[index].segmentId === lastRun.segmentId)
    : []
  const areaPath = lastRunPoints.length >= 2
    ? [
      `M${lastRunPoints[0].x} ${lastRunPoints[0].y}`,
      ...lastRunPoints.slice(1).map(point => `L${point.x} ${point.y}`),
      `L${lastRunPoints[lastRunPoints.length - 1].x} ${PLOT.bottom}`,
      `L${lastRunPoints[0].x} ${PLOT.bottom}`,
      'Z',
    ].join(' ')
    : null

  const verdict = buildVerdict(plottable)
  const tolerancePoints = FIXED_COMPARISON_TOLERANCE.overallScorePoints
  const latest = points[points.length - 1] ?? null

  // The band is a claim about the latest reading's precision, so it is drawn
  // only where the policy actually applied that tolerance to a comparison.
  const showTolerance = latest !== null
    && verdict !== null
    && verdict.decision.status !== 'not_comparable'

  return {
    points,
    runs,
    areaPath,
    gridLines: GRID_SCORES.map(score => ({ y: yForScore(score), score })),
    maintainBand: {
      y: yForScore(MAINTAIN_MAX),
      height: PLOT.bottom - yForScore(MAINTAIN_MAX),
      label: `MAINTAIN — ${MAINTAIN_MAX} OR LOWER`,
    },
    tolerance: showTolerance && latest
      ? {
        x1: points[points.length - 2]?.x ?? PLOT.left,
        x2: latest.x,
        y1: yForScore(Math.min(latest.score + tolerancePoints, SCORE_DOMAIN)),
        y2: yForScore(Math.max(latest.score - tolerancePoints, 0)),
        points: tolerancePoints,
      }
      : null,
    verdict,
    footnote: buildFootnote(verdict, tolerancePoints),
    description: buildDescription(points, verdict),
  }
}

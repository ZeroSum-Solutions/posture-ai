import {
  compareOverallScores,
  comparisonDecisionText,
  REPEAT_CAPTURE_LIMITATION_COPY,
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
import { formatClientDate } from './clientDate'

/**
 * Geometry and copy for the client-detail deviation-score chart.
 *
 * Everything here is derived: the maintain band comes from the engine's grade
 * thresholds and the verdict from `compareOverallScores` — the same decision the Compare workspace
 * and both PDF variants render. This module invents no clinical meaning; if the
 * policy says two scans are not comparable, the chart says so and draws no
 * verdict and no line between them.
 *
 * The score domain is pinned to 0–100 rather than fitted to the data. An
 * auto-scaled axis would make a two-point wobble look like a cliff, which on a
 * screening trend is a clinical misread, not a cosmetic one.
 */

/* ── Plot box, in the SVG's own user units ──────────────────────────────── */

export const CHART_VIEWBOX = { width: 330, height: 60 } as const
const PLOT = { left: 12, right: 318, top: 5, bottom: 54 } as const
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
  /** Signed recorded difference, or null when the pair is not comparable. */
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
   * Retained shape for component compatibility. Null until a version-specific
   * repeat-capture profile establishes a defensible uncertainty interval.
   */
  tolerance: { x1: number; x2: number; y1: number; y2: number; points: number } | null
  verdict: TrendVerdict | null
  /** Sentence under the chart. States comparability and repeat-capture limits. */
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
  const formatted = formatClientDate(iso, 'day-month-short-no-year')
  return formatted === 'Date unavailable' ? '—' : formatted
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

  const comparable = decision.status !== 'not_comparable' && decision.delta !== null
  const magnitude = comparable ? formatDelta(decision.delta) : null

  return {
    text: comparisonDecisionText(decision, 'overall'),
    // `formatDelta` intentionally returns null for zero. Interpolate only an
    // actual formatted value so an unchanged scan can never render "null pts".
    magnitude: magnitude ? `${magnitude} pts` : null,
    band: 'neutral',
    icon: comparable ? deltaIcon(decision.delta) : ('arrow-right-linear' as DeltaArrow),
    decision,
  }
}

function buildFootnote(verdict: TrendVerdict | null): string {
  if (!verdict) {
    return `A second recorded score enables a numeric comparison. ${REPEAT_CAPTURE_LIMITATION_COPY}`
  }
  if (verdict.decision.status === 'not_comparable') {
    return `${comparisonDecisionText(verdict.decision, 'overall')} ${REPEAT_CAPTURE_LIMITATION_COPY}`
  }
  return REPEAT_CAPTURE_LIMITATION_COPY
}

function buildDescription(points: readonly TrendChartPoint[], verdict: TrendVerdict | null): string {
  if (points.length === 0) return 'No screening scores recorded yet.'
  const first = points[0]
  const last = points[points.length - 1]
  const span = points.length === 1
    ? `One screening score: ${scoreLabel(last.score, last.grade)} on ${last.dateLabel}.`
    : `${points.length} screening scores from ${scoreLabel(first.score, first.grade)} on ${first.dateLabel} to ${scoreLabel(last.score, last.grade)} on ${last.dateLabel}.`
  const reading = `Deviation score out of 100; lower values indicate less recorded deviation. Maintain is ${MAINTAIN_MAX} or lower.`
  const comparison = verdict ? ` Latest against previous: ${verdict.text}.` : ''
  return `${span} ${reading}${comparison} ${REPEAT_CAPTURE_LIMITATION_COPY}`
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
    tolerance: null,
    verdict,
    footnote: buildFootnote(verdict),
    description: buildDescription(points, verdict),
  }
}

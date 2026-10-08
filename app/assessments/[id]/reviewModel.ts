import {
  compareOverallScores,
  compareSeverityPercentages,
  comparisonDecisionText,
  REPEAT_CAPTURE_LIMITATION_COPY,
  type ComparisonDecision,
} from '@/lib/comparison/policy'
import {
  bandFromGrade,
  bandFromZone,
  deltaIcon,
  FINDING_BAND_STOPS,
  formatDelta,
  SCORE_BAND_STOPS,
  type DeltaArrow,
  type SeverityBand,
} from '@/components/array/severity'

/**
 * Everything the review screen states, derived from the assessment it was given.
 *
 * On-screen band colour comes from `components/array/severity`, which follows the
 * design contract (S, A, B → Maintain). `lib/scoring/grade-display` still owns the
 * PDF report's palette and maps B to a warning tone; the two disagree about grade
 * B on purpose and the divergence is tracked in the redesign plan. The engine
 * remains the sole owner of which grade a score is — neither module decides that.
 *
 * Every comparison routes through the shared policy so the review screen, the
 * Compare workspace, client detail and both PDF variants apply the same version,
 * chronology, reliability, and unit guards.
 */

/* ── Inputs ─────────────────────────────────────────────────────────────── */

export interface ReviewFindingInput {
  id: string
  imbalance_key: string
  label: string
  region: string
  severity_pct: number | null
  zone: 'maintain' | 'warning' | 'danger' | 'unreliable'
  deviation: number | null
  direction: string
  standard?: number | null
  unit?: string | null
  borderline?: boolean | null
  causes_text?: string
  tight_muscles?: string[]
  weak_muscles?: string[]
  tight_muscle_links?: MuscleLink[]
  weak_muscle_links?: MuscleLink[]
}

export interface MuscleLink {
  slug: string
  name: string
  confidence?: 'high' | 'medium' | 'low'
}

export interface ReviewAssessmentInput {
  overall_score: number
  overall_grade: string
  scoring_engine_version: string | null
  assessed_at: string
}

/** The immediately prior approved scan, when one has been loaded. */
export interface ReviewPriorInput {
  overall_score: number | null
  scoring_engine_version: string | null
  assessed_at: string
  findings: readonly Pick<ReviewFindingInput, 'imbalance_key' | 'severity_pct' | 'zone' | 'unit'>[]
}

/* ── Outputs ────────────────────────────────────────────────────────────── */

export interface ReviewVerdict {
  kicker: string
  /** Two-tone headline: the grade, then what drives it at 45% white. */
  headline: { lead: string; tail: string | null }
}

export interface GradeRailStop {
  /** Percentage across the rail where this band ends. */
  end: number
  band: SeverityBand
  label: string
}

export interface GradeRailModel {
  grade: string
  score: number
  band: SeverityBand
  /** Left offset of the current reading, as a percentage of the rail. */
  position: number
  /** The prior reading's position, drawn faded. Null when not comparable. */
  priorPosition: number | null
  priorLabel: string | null
  stops: GradeRailStop[]
  delta: { text: string; band: SeverityBand; icon: DeltaArrow } | null
  /** Why the rail looks the way it does, in one sentence. */
  note: string
  /** Read in place of the rail by assistive technology. */
  description: string
}

export interface ReviewFindingRow {
  id: string
  key: string
  label: string
  region: string
  zoneLabel: string
  band: SeverityBand
  /** Severity as a percentage; also the value dot's position on the bar. */
  severity: number
  /** Recorded measurement, e.g. `12.4°`. Null when the unit is unknown. */
  measurement: string | null
  /** The recorded deviation and its stored unit, for readouts that format their own value. */
  deviation: number | null
  unit: string | null
  /** In-range reference, e.g. `ref 0–2°`. Null when no standard was recorded. */
  reference: string | null
  delta: string | null
  deltaBand: SeverityBand
  deltaIcon: DeltaArrow | null
  /** Shown instead of a delta when the policy declines to give one. */
  deltaWord: string | null
  /** Whether the reading is usable at all. */
  reliable: boolean
  borderline: boolean
  /** Practitioner-facing explanation of likely contributors, when one exists. */
  causes: string | null
  tightMuscles: string[]
  weakMuscles: string[]
  tightLinks: MuscleLink[]
  weakLinks: MuscleLink[]
}

export interface ReviewModel {
  verdict: ReviewVerdict
  rail: GradeRailModel
  rows: ReviewFindingRow[]
  counts: { review: number; maintain: number; unreliable: number }
}

/* ── Rail geometry ──────────────────────────────────────────────────────── */

/**
 * The rail is the 0–100 deviation scale split at the engine's own grade
 * boundaries, so the dot always sits in the band its letter names. Percentages
 * are the scale — no separate pixel mapping to drift out of step.
 */
export const GRADE_RAIL_STOPS: readonly GradeRailStop[] = [
  { end: SCORE_BAND_STOPS.maintain, band: 'maintain', label: 'Maintain' },
  { end: SCORE_BAND_STOPS.monitor, band: 'monitor', label: 'Monitor' },
  { end: 100, band: 'review', label: 'Review' },
]

/** Reference tick on a finding bar: the published warn cut-point. */
export const FINDING_REFERENCE_TICK = FINDING_BAND_STOPS.warn

const ZONE_LABELS: Record<ReviewFindingInput['zone'], string> = {
  maintain: 'Maintain',
  warning: 'Monitor',
  danger: 'Review',
  unreliable: 'Not scored',
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function formatMeasurement(
  deviation: number | null,
  unit: string | null | undefined,
): string | null {
  if (!unit || typeof deviation !== 'number' || !Number.isFinite(deviation)) return null
  return `${deviation.toFixed(1)}${unit}`
}

function formatReference(
  standard: number | null | undefined,
  unit: string | null | undefined,
): string | null {
  if (standard == null || !Number.isFinite(standard) || !unit) return null
  return `ref ${standard.toFixed(1)}${unit}`
}

/* ── Verdict ────────────────────────────────────────────────────────────── */

const SMALL_NUMBERS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']

function countWord(n: number): string {
  return SMALL_NUMBERS[n] ?? String(n)
}

function buildVerdict(
  assessment: ReviewAssessmentInput,
  overall: ComparisonDecision | null,
  flagged: number,
  scanLabel: string,
): ReviewVerdict {
  // Describe comparable engineering-score changes without claiming a health outcome.
  const direction = overall?.status === 'improved'
    ? ', score decreased'
    : overall?.status === 'regressed'
      ? ', score increased'
      : ''

  const lead = `Grade ${assessment.overall_grade}${direction}.`
  const tail = flagged === 0
    ? 'No findings are outside range.'
    : flagged === 1
      ? 'One finding drives the score.'
      : `${countWord(flagged)} findings drive the score.`

  return { kicker: scanLabel, headline: { lead, tail } }
}

/* ── Rail ───────────────────────────────────────────────────────────────── */

function buildRail(
  assessment: ReviewAssessmentInput,
  prior: ReviewPriorInput | null,
  overall: ComparisonDecision | null,
  priorLabel: string | null,
): GradeRailModel {
  const band = bandFromGrade(assessment.overall_grade)
  const position = clampPercent(assessment.overall_score)
  const comparable = overall !== null && overall.status !== 'not_comparable'
  const priorScore = prior?.overall_score ?? null
  const priorPosition = comparable && priorScore !== null ? clampPercent(priorScore) : null

  const hasComparableDelta = overall !== null
    && overall.status !== 'not_comparable'
    && overall.delta !== null
  const delta = hasComparableDelta
    ? {
      text: overall.delta === 0 ? 'No change vs last scan' : `${formatDelta(overall.delta)} vs last scan`,
      band: 'neutral' as SeverityBand,
      icon: deltaIcon(overall.delta),
    }
    : null

  const currentBandLabel = GRADE_RAIL_STOPS.find(stop => stop.band === band)?.label ?? 'Not scored'

  const note = priorPosition === null
    ? overall?.status === 'not_comparable'
      ? `This scan sits in ${currentBandLabel}. The previous scan is not comparable, so it is not drawn.`
      : `This scan sits in ${currentBandLabel}. A second scan adds the previous reading to this rail.`
    : `The faded dot is the previous scan. This one sits in ${currentBandLabel}. ${REPEAT_CAPTURE_LIMITATION_COPY}`

  const description = [
    `Deviation score ${Math.round(assessment.overall_score)} out of 100, grade ${assessment.overall_grade}, in ${currentBandLabel}.`,
    'Lower is better.',
    priorPosition !== null && priorScore !== null
      ? `Previous scan ${Math.round(priorScore)}.`
      : null,
    overall
      ? `${comparisonDecisionText(overall, 'overall')}. ${REPEAT_CAPTURE_LIMITATION_COPY}`
      : null,
  ].filter(Boolean).join(' ')

  return {
    grade: assessment.overall_grade,
    score: assessment.overall_score,
    band,
    position,
    priorPosition,
    priorLabel: priorPosition === null ? null : priorLabel,
    stops: [...GRADE_RAIL_STOPS],
    delta,
    note,
    description,
  }
}

/* ── Finding rows ───────────────────────────────────────────────────────── */

function buildRows(
  findings: readonly ReviewFindingInput[],
  assessment: ReviewAssessmentInput,
  prior: ReviewPriorInput | null,
): ReviewFindingRow[] {
  const priorByKey = new Map(
    (prior?.findings ?? []).map(finding => [finding.imbalance_key, finding]),
  )

  const rows = findings.map<ReviewFindingRow>(finding => {
    const reliable = finding.zone !== 'unreliable'
    const priorFinding = priorByKey.get(finding.imbalance_key) ?? null
    const decision = prior && priorFinding
      ? compareSeverityPercentages({
        current: finding.severity_pct,
        prior: priorFinding.severity_pct,
        currentEngineVersion: assessment.scoring_engine_version,
        priorEngineVersion: prior.scoring_engine_version,
        currentAssessedAt: assessment.assessed_at,
        priorAssessedAt: prior.assessed_at,
        currentReliable: reliable,
        priorReliable: priorFinding.zone !== 'unreliable',
        currentUnit: finding.unit ?? null,
        priorUnit: priorFinding.unit ?? null,
      })
      : null

    const comparable = decision !== null
      && decision.status !== 'not_comparable'
      && decision.delta !== null

    return {
      id: finding.id,
      key: finding.imbalance_key,
      label: finding.label,
      region: finding.region,
      zoneLabel: ZONE_LABELS[finding.zone],
      band: bandFromZone(finding.zone),
      severity: typeof finding.severity_pct === 'number' && Number.isFinite(finding.severity_pct)
        ? clampPercent(finding.severity_pct)
        : 0,
      measurement: reliable ? formatMeasurement(finding.deviation, finding.unit) : null,
      deviation: reliable && typeof finding.deviation === 'number' && Number.isFinite(finding.deviation) ? finding.deviation : null,
      unit: finding.unit ?? null,
      reference: reliable ? formatReference(finding.standard, finding.unit) : null,
      delta: comparable ? formatDelta(decision.delta, 1) : null,
      deltaBand: 'neutral' as SeverityBand,
      deltaIcon: comparable ? deltaIcon(decision.delta) : null,
      deltaWord: decision?.status === 'not_comparable' ? 'not comparable' : null,
      reliable,
      borderline: finding.borderline === true,
      causes: finding.causes_text?.trim() || null,
      tightMuscles: finding.tight_muscles ?? [],
      weakMuscles: finding.weak_muscles ?? [],
      tightLinks: finding.tight_muscle_links ?? [],
      weakLinks: finding.weak_muscle_links ?? [],
    }
  })

  // Worst first. An unusable reading sorts last: it is a task to redo, not a
  // finding to act on, and it must never head a clinical list.
  return rows.sort((left, right) => {
    if (left.reliable !== right.reliable) return left.reliable ? -1 : 1
    if (left.severity !== right.severity) return right.severity - left.severity
    return left.label.localeCompare(right.label)
  })
}

/* ── Entry point ────────────────────────────────────────────────────────── */

export function buildReviewModel({
  assessment,
  findings,
  prior,
  scanLabel,
  priorLabel,
}: {
  assessment: ReviewAssessmentInput
  findings: readonly ReviewFindingInput[]
  prior: ReviewPriorInput | null
  /** `Scan · 12 Jul 2026` — the kicker above the headline. */
  scanLabel: string
  /** How the prior scan is named on the rail, e.g. `4 Jun`. */
  priorLabel: string | null
}): ReviewModel {
  const overall = prior
    ? compareOverallScores({
      current: assessment.overall_score,
      prior: prior.overall_score,
      currentEngineVersion: assessment.scoring_engine_version,
      priorEngineVersion: prior.scoring_engine_version,
      currentAssessedAt: assessment.assessed_at,
      priorAssessedAt: prior.assessed_at,
    })
    : null

  const flagged = findings.filter(
    finding => finding.zone === 'warning' || finding.zone === 'danger',
  ).length

  return {
    verdict: buildVerdict(assessment, overall, flagged, scanLabel),
    rail: buildRail(assessment, prior, overall, priorLabel),
    rows: buildRows(findings, assessment, prior),
    counts: {
      review: flagged,
      maintain: findings.filter(finding => finding.zone === 'maintain').length,
      unreliable: findings.filter(finding => finding.zone === 'unreliable').length,
    },
  }
}

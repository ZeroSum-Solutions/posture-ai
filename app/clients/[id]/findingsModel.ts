import {
  compareSeverityPercentages,
  comparisonStatusText,
  type ComparisonDecision,
} from '@/lib/comparison/policy'
import {
  bandFromZone,
  deltaIcon,
  formatDelta,
  type DeltaArrow,
  type SeverityBand,
} from '@/components/array/severity'

/**
 * Per-finding severity over time, as one sparkline per finding.
 *
 * The chart this replaced drew every finding as a line in one 0–100% plot, with
 * a legend and a line per scoring-version run per finding — on a 390px viewport
 * that is a dozen near-identical strokes and no readable answer to "is this
 * finding getting better". Small multiples answer it per row and still share one
 * time axis, so two rows remain comparable to each other.
 *
 * Comparability rules are the shared policy's, not this module's:
 * `compareSeverityPercentages` rejects version mismatches, non-chronological
 * pairs, unreliable readings and unit changes, and this module draws no line
 * across a scoring-version boundary or across a gap in the readings.
 */

export const SPARK_VIEWBOX = { width: 96, height: 30 } as const
const SPARK_PAD = 4
const SEVERITY_DOMAIN = 100

export interface FindingReading {
  key: string
  label: string | null
  severityPct: number | string | null
  zone: string | null
  unit: string | null
}

export interface FindingsTrendAssessment {
  id: string
  assessedAt: string
  scoringEngineVersion: string | null
  /** Contiguous scoring-version run, from segmentTrendHistory. */
  segmentId: string
  findings: readonly FindingReading[]
}

export interface FindingSeriesPoint {
  assessmentId: string
  x: number
  y: number
  severity: number
}

export interface FindingSeries {
  key: string
  label: string
  points: FindingSeriesPoint[]
  /** Polylines split at scoring-version boundaries and at missing readings. */
  runs: string[]
  latest: { severity: number; zone: string | null; band: SeverityBand } | null
  verdict: {
    text: string
    magnitude: string | null
    band: SeverityBand
    icon: DeltaArrow
    decision: ComparisonDecision
  } | null
  description: string
}

function severityValue(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** An unreliable reading is not a measurement; it is the absence of one. */
function isReliable(zone: string | null): boolean {
  return zone !== null && zone !== 'unreliable'
}

function xForIndex(index: number, count: number): number {
  if (count <= 1) return SPARK_VIEWBOX.width / 2
  return SPARK_PAD + (index / (count - 1)) * (SPARK_VIEWBOX.width - SPARK_PAD * 2)
}

function yForSeverity(severity: number): number {
  const clamped = Math.min(Math.max(severity, 0), SEVERITY_DOMAIN)
  const usable = SPARK_VIEWBOX.height - SPARK_PAD * 2
  return SPARK_VIEWBOX.height - SPARK_PAD - (clamped / SEVERITY_DOMAIN) * usable
}

/**
 * Build one series per finding key seen anywhere in the history.
 *
 * Series are ordered by the latest severity, worst first: the list exists to
 * answer which findings need attention, and alphabetical order buries that.
 * Findings with no usable reading at all sort last and carry no verdict.
 */
export function buildFindingsTrend(
  assessments: readonly FindingsTrendAssessment[],
): FindingSeries[] {
  const labels = new Map<string, string>()
  const order: string[] = []
  for (const assessment of assessments) {
    for (const finding of assessment.findings) {
      if (!labels.has(finding.key)) {
        order.push(finding.key)
        labels.set(finding.key, finding.label?.trim() || finding.key)
      } else if (finding.label?.trim() && labels.get(finding.key) === finding.key) {
        labels.set(finding.key, finding.label.trim())
      }
    }
  }

  const count = assessments.length

  const series = order.map<FindingSeries>(key => {
    const label = labels.get(key) ?? key
    const points: FindingSeriesPoint[] = []
    const runs: string[] = []
    let openRunSegment: string | null = null
    let openRunIndex: number | null = null

    // Readings in chronological order, carrying their assessment's version run
    // so a break in either dimension breaks the drawn line.
    const readings = assessments.map(assessment => {
      const finding = assessment.findings.find(candidate => candidate.key === key)
      const severity = finding ? severityValue(finding.severityPct) : null
      const usable = finding !== undefined && severity !== null && isReliable(finding.zone)
      return { assessment, finding: finding ?? null, severity: usable ? severity : null }
    })

    readings.forEach((reading, index) => {
      if (reading.severity === null) {
        // A gap ends the run: joining across it would draw a measurement that
        // was never taken.
        openRunSegment = null
        openRunIndex = null
        return
      }
      const spot = {
        assessmentId: reading.assessment.id,
        x: xForIndex(index, count),
        y: yForSeverity(reading.severity),
        severity: reading.severity,
      }
      points.push(spot)

      const continues = openRunSegment === reading.assessment.segmentId
        && openRunIndex === index - 1
      if (continues && runs.length > 0) {
        runs[runs.length - 1] = `${runs[runs.length - 1]} ${spot.x},${spot.y}`
      } else {
        runs.push(`${spot.x},${spot.y}`)
      }
      openRunSegment = reading.assessment.segmentId
      openRunIndex = index
    })

    const usableReadings = readings.filter(reading => reading.severity !== null)
    const latestReading = usableReadings[usableReadings.length - 1] ?? null
    const priorReading = usableReadings[usableReadings.length - 2] ?? null

    const latest = latestReading
      ? {
        severity: latestReading.severity as number,
        zone: latestReading.finding?.zone ?? null,
        band: bandFromZone(latestReading.finding?.zone ?? null),
      }
      : null

    const verdict = latestReading && priorReading
      ? decide(latestReading, priorReading)
      : null

    return {
      key,
      label,
      points,
      runs,
      latest,
      verdict,
      description: describe(label, latest, verdict, points.length),
    }
  })

  return series.sort((left, right) => {
    const leftSeverity = left.latest?.severity ?? -1
    const rightSeverity = right.latest?.severity ?? -1
    if (leftSeverity !== rightSeverity) return rightSeverity - leftSeverity
    return left.label.localeCompare(right.label)
  })
}

type Reading = {
  assessment: FindingsTrendAssessment
  finding: FindingReading | null
  severity: number | null
}

function decide(latest: Reading, prior: Reading): FindingSeries['verdict'] {
  const decision = compareSeverityPercentages({
    current: latest.severity,
    prior: prior.severity,
    currentEngineVersion: latest.assessment.scoringEngineVersion,
    priorEngineVersion: prior.assessment.scoringEngineVersion,
    currentAssessedAt: latest.assessment.assessedAt,
    priorAssessedAt: prior.assessment.assessedAt,
    currentReliable: isReliable(latest.finding?.zone ?? null),
    priorReliable: isReliable(prior.finding?.zone ?? null),
    currentUnit: latest.finding?.unit ?? null,
    priorUnit: prior.finding?.unit ?? null,
  })
  const directional = decision.status === 'improved' || decision.status === 'regressed'
  return {
    text: comparisonStatusText(decision.status, 'finding'),
    magnitude: directional && decision.delta !== null
      ? `${formatDelta(decision.delta, 1)} pts`
      : null,
    band: decision.status === 'improved'
      ? 'maintain'
      : decision.status === 'regressed'
        ? 'review'
        : 'neutral',
    icon: directional ? deltaIcon(decision.delta) : ('arrow-right-linear' as DeltaArrow),
    decision,
  }
}

function describe(
  label: string,
  latest: FindingSeries['latest'],
  verdict: FindingSeries['verdict'],
  pointCount: number,
): string {
  if (!latest) return `${label}: no reliable severity reading recorded.`
  const current = `${label}: latest severity ${latest.severity.toFixed(1)} percent`
  const reading = pointCount === 1
    ? `${current}, from one reading.`
    : `${current}, across ${pointCount} readings.`
  return verdict ? `${reading} Against the previous reading: ${verdict.text}.` : reading
}

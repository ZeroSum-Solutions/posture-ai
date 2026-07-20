/**
 * One comparison policy for every progress surface.
 *
 * Both engine signals are lower-is-better. The thresholds below are temporary
 * engineering fallbacks, not validated minimum detectable change values. They
 * remain in force only until an eligible, version-matched reliability profile
 * is available (see docs/ROADMAP.md).
 */

export const FIXED_COMPARISON_TOLERANCE = Object.freeze({
  id: 'fixed-fallback-v1',
  source: 'fixed_fallback' as const,
  overallScorePoints: 3,
  severityPercentagePoints: 5,
})

export const MEASUREMENT_TOLERANCE_COPY =
  'Temporary fixed measurement tolerance: movements of at least 3 screening-score points or at least 5 severity percentage points are directional; smaller nonzero movements are within tolerance. This is an engineering fallback, not a validated clinical-change threshold.'

export const ENGINE_VERSION_COMPARISON_COPY =
  'Not comparable: these assessments use different or missing scoring versions. Values are shown separately without an improvement or regression claim.'

export const CHRONOLOGY_COMPARISON_COPY =
  'Not comparable: a valid earlier-to-later assessment order could not be confirmed.'

export const MISSING_VALUE_COMPARISON_COPY =
  'Not comparable: a required score or finding reading is unavailable.'

export type ComparisonStatus =
  | 'improved'
  | 'regressed'
  | 'unchanged'
  | 'within_tolerance'
  | 'not_comparable'

export type ComparisonReason =
  | 'outside_tolerance'
  | 'same_value'
  | 'inside_tolerance'
  | 'missing_version'
  | 'different_version'
  | 'missing_value'
  | 'missing_timestamp'
  | 'non_chronological'
  | 'unreliable'
  | 'unit_mismatch'

export type ComparisonMetric = 'overall_score' | 'severity_pct'

export interface ComparisonDecision {
  status: ComparisonStatus
  reason: ComparisonReason
  metric: ComparisonMetric
  /** Current minus prior. Negative is better for both supported metrics. */
  delta: number | null
  tolerance: number
  unit: 'score_points' | 'percentage_points'
  policyId: typeof FIXED_COMPARISON_TOLERANCE.id
}

export interface LowerIsBetterComparisonInput {
  current: unknown
  prior: unknown
  currentEngineVersion: string | null | undefined
  priorEngineVersion: string | null | undefined
  currentAssessedAt: string | null | undefined
  priorAssessedAt: string | null | undefined
  currentReliable?: boolean | null | undefined
  priorReliable?: boolean | null | undefined
  currentUnit?: string | null | undefined
  priorUnit?: string | null | undefined
}

function usableVersion(version: string | null | undefined): string | null {
  if (typeof version !== 'string') return null
  const normalized = version.trim()
  return normalized.length > 0 ? normalized : null
}

function finiteValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function chronologyReason(input: LowerIsBetterComparisonInput): 'comparable' | 'missing_timestamp' | 'non_chronological' {
  if (!input.currentAssessedAt || !input.priorAssessedAt) return 'missing_timestamp'
  const current = Date.parse(input.currentAssessedAt)
  const prior = Date.parse(input.priorAssessedAt)
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return 'missing_timestamp'
  return current > prior ? 'comparable' : 'non_chronological'
}

export function engineVersionComparisonReason(
  currentEngineVersion: string | null | undefined,
  priorEngineVersion: string | null | undefined,
): 'comparable' | 'missing_version' | 'different_version' {
  const current = usableVersion(currentEngineVersion)
  const prior = usableVersion(priorEngineVersion)
  if (current === null || prior === null) return 'missing_version'
  return current === prior ? 'comparable' : 'different_version'
}

export function areEngineVersionsComparable(
  currentEngineVersion: string | null | undefined,
  priorEngineVersion: string | null | undefined,
): boolean {
  return engineVersionComparisonReason(currentEngineVersion, priorEngineVersion) === 'comparable'
}

export function comparisonVersionOptionNote(
  currentEngineVersion: string | null | undefined,
  priorEngineVersion: string | null | undefined,
): string {
  return areEngineVersionsComparable(currentEngineVersion, priorEngineVersion)
    ? ''
    : ' (different or missing scoring version)'
}

function compareLowerIsBetter(
  input: LowerIsBetterComparisonInput,
  metric: ComparisonMetric,
  tolerance: number,
  unit: ComparisonDecision['unit'],
): ComparisonDecision {
  const versionReason = engineVersionComparisonReason(
    input.currentEngineVersion,
    input.priorEngineVersion,
  )
  const base = { metric, tolerance, unit, policyId: FIXED_COMPARISON_TOLERANCE.id } as const

  if (versionReason !== 'comparable') {
    return { ...base, status: 'not_comparable', reason: versionReason, delta: null }
  }

  const timeReason = chronologyReason(input)
  if (timeReason !== 'comparable') {
    return { ...base, status: 'not_comparable', reason: timeReason, delta: null }
  }

  const current = finiteValue(input.current)
  const prior = finiteValue(input.prior)
  if (current === null || prior === null) {
    return { ...base, status: 'not_comparable', reason: 'missing_value', delta: null }
  }

  const delta = current - prior
  if (delta === 0) return { ...base, status: 'unchanged', reason: 'same_value', delta }

  // Preserve the existing fallback boundary behavior byte-for-byte: a movement
  // exactly equal to the fallback threshold is directional; only smaller
  // non-zero movements are inside the tolerance band.
  if (Math.abs(delta) < tolerance) {
    return { ...base, status: 'within_tolerance', reason: 'inside_tolerance', delta }
  }

  return {
    ...base,
    status: delta < 0 ? 'improved' : 'regressed',
    reason: 'outside_tolerance',
    delta,
  }
}

export function compareOverallScores(input: LowerIsBetterComparisonInput): ComparisonDecision {
  return compareLowerIsBetter(
    input,
    'overall_score',
    FIXED_COMPARISON_TOLERANCE.overallScorePoints,
    'score_points',
  )
}

export function compareSeverityPercentages(input: LowerIsBetterComparisonInput): ComparisonDecision {
  const versionReason = engineVersionComparisonReason(input.currentEngineVersion, input.priorEngineVersion)
  const base = {
    metric: 'severity_pct' as const,
    tolerance: FIXED_COMPARISON_TOLERANCE.severityPercentagePoints,
    unit: 'percentage_points' as const,
    policyId: FIXED_COMPARISON_TOLERANCE.id,
  }
  if (versionReason !== 'comparable') {
    return { ...base, status: 'not_comparable', reason: versionReason, delta: null }
  }
  const timeReason = chronologyReason(input)
  if (timeReason !== 'comparable') {
    return { ...base, status: 'not_comparable', reason: timeReason, delta: null }
  }
  if (input.currentReliable === false || input.priorReliable === false) {
    return { ...base, status: 'not_comparable', reason: 'unreliable', delta: null }
  }
  const currentUnit = typeof input.currentUnit === 'string' && input.currentUnit.trim() ? input.currentUnit.trim() : null
  const priorUnit = typeof input.priorUnit === 'string' && input.priorUnit.trim() ? input.priorUnit.trim() : null
  if ((currentUnit !== null || priorUnit !== null) && currentUnit !== priorUnit) {
    return { ...base, status: 'not_comparable', reason: 'unit_mismatch', delta: null }
  }
  return compareLowerIsBetter(
    input,
    'severity_pct',
    FIXED_COMPARISON_TOLERANCE.severityPercentagePoints,
    'percentage_points',
  )
}

/** Shared words used verbatim by responsive web and both PDF variants. */
export function comparisonStatusText(
  status: ComparisonStatus,
  metric: 'overall' | 'finding',
): string {
  if (status === 'improved') return metric === 'overall' ? 'Improved — lower screening score' : 'Improved — lower severity'
  if (status === 'regressed') return metric === 'overall' ? 'Regressed — higher screening score' : 'Regressed — higher severity'
  if (status === 'unchanged') return metric === 'overall' ? 'Unchanged screening score' : 'Unchanged severity'
  if (status === 'within_tolerance') return 'Within measurement tolerance'
  return 'Not comparable'
}

/** Full explanation for a decision; presenters must not invent reason copy. */
export function comparisonDecisionText(
  decision: ComparisonDecision,
  metric: 'overall' | 'finding',
): string {
  if (decision.status !== 'not_comparable') return comparisonStatusText(decision.status, metric)
  if (decision.reason === 'missing_version' || decision.reason === 'different_version') {
    return ENGINE_VERSION_COMPARISON_COPY
  }
  if (decision.reason === 'missing_timestamp' || decision.reason === 'non_chronological') {
    return CHRONOLOGY_COMPARISON_COPY
  }
  if (decision.reason === 'unreliable') {
    return 'Not comparable: one or both readings are unreliable.'
  }
  if (decision.reason === 'unit_mismatch') {
    return 'Not comparable: the recorded measurement units differ.'
  }
  return MISSING_VALUE_COMPARISON_COPY
}

export function comparisonTone(status: ComparisonStatus): 'positive' | 'negative' | 'neutral' {
  if (status === 'improved') return 'positive'
  if (status === 'regressed') return 'negative'
  return 'neutral'
}

/**
 * Report-shaped adapter around the central comparison policy.
 *
 * It retains recorded grades for display, but grades never decide direction.
 * Every status comes from lib/comparison/policy.ts using persisted scores,
 * severity percentages, and both persisted scoring-engine versions.
 */
import {
  compareOverallScores,
  compareSeverityPercentages,
  type ComparisonDecision,
} from '@/lib/comparison/policy'

export interface ClientComparison {
  priorDateStr: string
  priorGrade: string
  currentGrade: string
  overall: ComparisonDecision
  /** imbalance_key → decision; one-sided or invalid readings fail closed. */
  byKey: Record<string, ComparisonDecision>
}

interface FindingSeverity {
  key: string
  severityPct: unknown
  reliable?: boolean | null
  unit?: string | null
}

interface VersionedScore {
  grade: string
  score: unknown
  scoringEngineVersion: string | null
  assessedAt: string | null
}

export function buildClientComparison(args: {
  priorDateStr: string
  current: VersionedScore
  prior: VersionedScore
  currentFindings: FindingSeverity[]
  priorFindings: FindingSeverity[]
}): ClientComparison {
  const { priorDateStr, current, prior, currentFindings, priorFindings } = args
  const versions = {
    currentEngineVersion: current.scoringEngineVersion,
    priorEngineVersion: prior.scoringEngineVersion,
    currentAssessedAt: current.assessedAt,
    priorAssessedAt: prior.assessedAt,
  }

  const currentByKey = new Map(currentFindings.map((finding) => [finding.key, finding]))
  const priorByKey = new Map(priorFindings.map((finding) => [finding.key, finding]))
  const byKey: Record<string, ComparisonDecision> = {}
  const keys = new Set([...currentByKey.keys(), ...priorByKey.keys()])
  for (const key of keys) {
    const finding = currentByKey.get(key)
    const priorFinding = priorByKey.get(key)
    byKey[key] = compareSeverityPercentages({
      current: finding?.severityPct,
      prior: priorFinding?.severityPct,
      currentReliable: finding?.reliable,
      priorReliable: priorFinding?.reliable,
      currentUnit: finding?.unit,
      priorUnit: priorFinding?.unit,
      ...versions,
    })
  }

  return {
    priorDateStr,
    priorGrade: prior.grade,
    currentGrade: current.grade,
    overall: compareOverallScores({
      current: current.score,
      prior: prior.score,
      ...versions,
    }),
    byKey,
  }
}

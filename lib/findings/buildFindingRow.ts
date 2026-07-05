import type { Finding } from '@posture-ai/engine'
import { metricValidity } from '@posture-ai/engine/thresholds'

/** Row shape inserted into assessment_findings by POST /api/assessments. */
export interface FindingRow {
  assessment_id: string
  practitioner_id: string
  imbalance_key: string
  region: string
  label: string
  deviation: number
  standard: number
  unit: string
  direction: string
  severity_pct: number
  zone: string
  view_used: string
  confidence: number
  metric_validity: string
  /** Within-capture stability (engine 1.3.0 bursts); null for single-frame captures — never fabricated. */
  stability_score: number | null
  uncertainty_deg: number | null
  borderline: boolean | null
}

/**
 * Pure mapper from an engine Finding to its persisted row. Stamps metric_validity
 * (the dominant honesty frame) from threshold provenance at storage time — the
 * engine stays frozen and never carries this field on Finding.
 */
export function buildFindingRow(
  f: Finding,
  assessmentId: string,
  practitionerId: string,
): FindingRow {
  return {
    assessment_id: assessmentId,
    practitioner_id: practitionerId,
    imbalance_key: f.key,
    region: f.region,
    label: f.label,
    deviation: f.deviation,
    standard: f.standard,
    unit: f.unit,
    direction: f.direction,
    severity_pct: f.severityPct,
    zone: f.zone,
    view_used: f.viewUsed === 'back' ? 'back' : f.viewUsed,
    confidence: f.confidence,
    metric_validity: metricValidity(f.key),
    stability_score: f.stabilityScore ?? null,
    uncertainty_deg: f.uncertaintyDeg ?? null,
    borderline: f.borderline ?? null,
  }
}

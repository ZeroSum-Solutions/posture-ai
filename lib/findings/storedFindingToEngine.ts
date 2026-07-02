import type { Finding } from '@posture-ai/engine'

/**
 * The subset of a stored assessment_findings row (snake_case) needed to rebuild
 * the engine Finding the program/session builders consume. Both the raw DB row
 * and the enriched results-page finding satisfy this shape structurally.
 */
export interface StoredFinding {
  imbalance_key: string
  label: string
  region: string
  deviation: number
  direction: string
  severity_pct: number
  zone: string
  view_used: string
  confidence: number
}

/**
 * Map a stored (snake_case) finding back onto the engine Finding the program
 * builder expects. `reliable` is derived from the zone exactly as the scoring
 * path does (an unreliable finding never drives a priority); landmarksUsed and
 * the burst-stability fields aren't persisted per-row here and aren't needed to
 * build a program.
 */
export function toEngineFinding(f: StoredFinding): Finding {
  return {
    key: f.imbalance_key,
    label: f.label,
    region: f.region as Finding['region'],
    deviation: f.deviation,
    standard: 0,
    unit: 'deg',
    direction: f.direction,
    severityPct: f.severity_pct,
    zone: f.zone as Finding['zone'],
    viewUsed: f.view_used as Finding['viewUsed'],
    confidence: f.confidence,
    reliable: f.zone !== 'unreliable',
    landmarksUsed: [],
  }
}

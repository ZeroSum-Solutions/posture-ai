import type { Finding } from '@/packages/posture-engine/src/types'

/**
 * Raw `assessment_findings` row shape (as selected from Supabase) needed to
 * rebuild the engine findings for the client program. Mirrors the client-side
 * `toEngineFinding` mapper in the results page so the server renders the exact
 * same program the practitioner sees.
 */
export interface DbFindingRow {
  imbalance_key: string
  label: string
  region: string
  deviation: number | string
  direction: string
  severity_pct: number | string
  zone: string
  view_used: string
  confidence: number | string
}

/** Map persisted assessment-finding rows back into engine `Finding`s. */
export function dbFindingsToEngineFindings(rows: DbFindingRow[]): Finding[] {
  return rows.map((f) => ({
    key: f.imbalance_key,
    label: f.label,
    region: f.region as Finding['region'],
    deviation: Number(f.deviation),
    standard: 0,
    unit: 'deg',
    direction: f.direction,
    severityPct: Number(f.severity_pct),
    zone: f.zone as Finding['zone'],
    viewUsed: f.view_used as Finding['viewUsed'],
    confidence: Number(f.confidence),
    reliable: f.zone !== 'unreliable',
    landmarksUsed: [],
  }))
}

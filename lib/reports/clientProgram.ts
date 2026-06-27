import type { Finding } from '@/packages/posture-engine/src/types'
import type { Capability } from '@/lib/program/selectPriorities'
import type { ProgramReport } from '@/lib/program/buildProgram'

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

/** Narrow an untrusted persisted `capability` value to the validated enum. */
export function isCapability(v: unknown): v is Capability {
  return v === 'regression' || v === 'standard' || v === 'progression'
}

/**
 * What the client report should actually say up top. `monitored` only ever
 * holds warning/danger findings, so an empty plan with a non-empty `monitored`
 * list means the coach demoted real issues — NOT that nothing was found. Those
 * two cases must read differently to the client.
 */
export function clientSummaryMode(report: ProgramReport): 'plan' | 'monitor' | 'clear' {
  if (report.hasPlan) return 'plan'
  return report.monitored.length > 0 ? 'monitor' : 'clear'
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

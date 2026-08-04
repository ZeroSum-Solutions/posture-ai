import { GRADE_BANDS } from '@posture-ai/engine/thresholds'

/**
 * Severity — three bands mapped from the engine grade, plus `info`.
 *
 * | Band     | Colour    | Grades  | Means                     |
 * |----------|-----------|---------|---------------------------|
 * | Maintain | #10B981   | S, A, B | Inside range, keep going  |
 * | Monitor  | #F59E0B   | C       | Outside range, not urgent |
 * | Review   | #EF4444   | D, E    | Flag and address          |
 *
 * A screening grade is a ramp, not a pass/fail — hence three bands rather than
 * the source contract's emerald/red pair. Colour appears as a 16%-tint chip with
 * a 42% ring, a 4px progress fill, or a 7px dot. Never as a filled block behind
 * body text.
 *
 * NOTE: the /DESIGN.md v2 table lists A and B under Maintain. That moves grade B
 * ("mild deviation", score 8–20) out of the warning tone it carried under the v1
 * system in lib/scoring/grade-display.ts, which still owns the PDF report's
 * palette. This module follows the design contract for on-screen band colour;
 * the engine remains the sole owner of which grade a score is. S is not in the
 * contract's table and reads as Maintain — it is the least-deviation grade.
 */

export type SeverityBand = 'maintain' | 'monitor' | 'review' | 'info' | 'neutral'

export const BAND_TONE: Record<SeverityBand, string> = {
  maintain: '#10B981',
  monitor: '#F59E0B',
  review: '#EF4444',
  info: '#0A83C9',
  neutral: 'rgba(255,255,255,0.55)',
}

export const BAND_LABEL: Record<SeverityBand, string> = {
  maintain: 'Maintain',
  monitor: 'Monitor',
  review: 'Review',
  info: 'Info',
  neutral: 'Not scored',
}

/** Map an engine letter grade onto its band. Unknown grades read as neutral. */
export function bandFromGrade(grade: string | null | undefined): SeverityBand {
  switch ((grade ?? '').trim().toUpperCase().charAt(0)) {
    case 'S':
    case 'A':
    case 'B':
      return 'maintain'
    case 'C':
      return 'monitor'
    case 'D':
    case 'E':
      return 'review'
    default:
      return 'neutral'
  }
}

/** Map an engine finding zone onto its band. */
export function bandFromZone(zone: string | null | undefined): SeverityBand {
  switch ((zone ?? '').trim().toLowerCase()) {
    case 'maintain':
      return 'maintain'
    case 'warning':
      return 'monitor'
    case 'danger':
      return 'review'
    default:
      // 'unreliable' and anything unrecognised are not scored, so not coloured.
      return 'neutral'
  }
}

const NEUTRAL_TINT = 'rgba(255,255,255,0.08)'
const NEUTRAL_RING = 'rgba(255,255,255,0.14)'

/** 16% tint background for a chip. */
export function tint(band: SeverityBand): string {
  if (band === 'neutral') return NEUTRAL_TINT
  return `color-mix(in srgb, ${BAND_TONE[band]} 16%, transparent)`
}

/** 42% ring, applied as a 1px inset box-shadow. */
export function ring(band: SeverityBand): string {
  if (band === 'neutral') return NEUTRAL_RING
  return `color-mix(in srgb, ${BAND_TONE[band]} 42%, transparent)`
}

export function tone(band: SeverityBand): string {
  return BAND_TONE[band]
}

/**
 * A delta is good when the deviation moved toward zero. Improvement reads
 * emerald, regression reads red, and no meaningful change stays neutral — a
 * delta is never coloured by direction alone.
 */
export function deltaBand(delta: number | null | undefined, lowerIsBetter = true): SeverityBand {
  if (delta == null || delta === 0) return 'neutral'
  const improved = lowerIsBetter ? delta < 0 : delta > 0
  return improved ? 'maintain' : 'review'
}

export type DeltaArrow = 'arrow-down-linear' | 'arrow-up-linear' | 'arrow-right-linear'

export function deltaIcon(delta: number | null | undefined): DeltaArrow {
  if (delta == null || delta === 0) return 'arrow-right-linear'
  return delta < 0 ? 'arrow-down-linear' : 'arrow-up-linear'
}

/**
 * Signed delta as display text, e.g. `−8` / `+3`. Returns null when there is no
 * change to report: a chip reading "→ 0" is noise, and the absence of a delta
 * says "flat" more clearly than a zero does.
 */
export function formatDelta(delta: number | null | undefined, digits = 0): string | null {
  if (delta == null || delta === 0) return null
  const magnitude = Math.abs(delta).toFixed(digits)
  return `${delta < 0 ? '−' : '+'}${magnitude}`
}

/* ── Bar geometry, derived from the engine — never hardcoded ─────────────── */

/**
 * A finding's `severity_pct` ramps piecewise-linearly: 0–33 inside the warn
 * threshold, 33–66 between warn and danger, 66–100 beyond danger
 * (see toZoneAndPct in the engine's thresholds). The reference tick therefore
 * sits at 33% — the warn boundary is the published reference cut-point.
 */
export const FINDING_BAND_STOPS = { warn: 33, danger: 66 } as const

/**
 * Grade-rail stops as percentages of the 0–100 deviation score, taken straight
 * from GRADE_BANDS so the dot always lands inside the band its grade names.
 * Maintain ends where B ends; Monitor ends where C ends.
 */
function gradeMax(grade: 'B' | 'C'): number {
  const band = GRADE_BANDS.find(candidate => candidate.grade === grade)
  if (!band) throw new Error(`Grade band ${grade} is missing from the engine thresholds`)
  return band.max
}

export const SCORE_BAND_STOPS = {
  get maintain() { return gradeMax('B') },
  get monitor() { return gradeMax('C') },
} as const

/**
 * Age banding for the pre-capture gate (COPPA / minor policy).
 * Pure + isomorphic (no node deps) so both the capture UI and the server can use it.
 *
 * Policy (product-owner decision):
 *  - under_13   → blocked entirely
 *  - minor_13_17 → allowed only with a recorded guardian consent
 *  - adult      → allowed with the subject's own consent
 *  - unknown    → date of birth is required before capture (blocked until provided)
 */
export type AgeBand = 'unknown' | 'under_13' | 'minor_13_17' | 'adult'

/** Whole years between `dob` and now, or null if `dob` is missing/unparseable. */
export function ageFromDob(dob: string | null | undefined, now: Date = new Date()): number | null {
  if (!dob) return null
  // Parse a date-only string (YYYY-MM-DD) as a LOCAL calendar date. `new Date('YYYY-MM-DD')`
  // parses as UTC midnight, which then mis-compares against the local getMonth()/getDate()
  // below — in negative-UTC-offset zones that shifts the computed age by a day at the
  // birthday boundary (a child reads as 13/18 one day early). A birthday is a calendar
  // date, not an instant, so compare calendar components directly.
  // Take the YYYY-MM-DD date prefix (a DOB is a calendar date, not an instant;
  // `new Date('YYYY-MM-DD')` parses as UTC and would mis-compare against the local
  // getMonth()/getDate() below). Reject anything without a valid date prefix and
  // any impossible calendar date (e.g. 2013-99-99, 2013-02-29) by round-tripping.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob.trim())
  if (!m) return null
  const by = Number(m[1]), bm = Number(m[2]) - 1, bd = Number(m[3])
  const probe = new Date(by, bm, bd)
  if (probe.getFullYear() !== by || probe.getMonth() !== bm || probe.getDate() !== bd) return null
  let age = now.getFullYear() - by
  const monthDiff = now.getMonth() - bm
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < bd)) age--
  return age
}

export function ageBand(dob: string | null | undefined, now: Date = new Date()): AgeBand {
  const age = ageFromDob(dob, now)
  if (age === null) return 'unknown'
  if (age < 13) return 'under_13'
  if (age < 18) return 'minor_13_17'
  return 'adult'
}

const GUARDIAN_RELATIONSHIPS = new Set(['parent', 'legal_guardian'])

/**
 * Whether a subject in `band` may be captured given whether a valid guardian
 * consent is on record. `under_13` is never capturable; `unknown` requires a DOB.
 */
export function canCapture(band: AgeBand, hasGuardianConsent: boolean): boolean {
  switch (band) {
    case 'adult':
      return true
    case 'minor_13_17':
      return hasGuardianConsent
    case 'under_13':
    case 'unknown':
    default:
      return false
  }
}

/** A human-readable reason when capture is blocked (null if allowed). */
export function captureBlockReason(band: AgeBand, hasGuardianConsent: boolean): string | null {
  if (canCapture(band, hasGuardianConsent)) return null
  switch (band) {
    case 'under_13':
      return 'Posture AI cannot be used to screen anyone under 13.'
    case 'minor_13_17':
      return 'A parent or legal guardian must provide consent before screening a minor (13–17).'
    case 'unknown':
    default:
      return 'A date of birth is required before screening can begin.'
  }
}

export function isGuardianRelationship(relationship: string | null | undefined): boolean {
  return !!relationship && GUARDIAN_RELATIONSHIPS.has(relationship)
}

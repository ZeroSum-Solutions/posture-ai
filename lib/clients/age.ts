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
  const birth = new Date(dob)
  if (Number.isNaN(birth.getTime())) return null
  let age = now.getFullYear() - birth.getFullYear()
  const m = now.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--
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

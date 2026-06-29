import { createHash } from 'node:crypto'

/**
 * Versioned subject-consent policy. The TEXT is what the subject (or their
 * guardian) sees and affirms before any posture capture. Bump CONSENT_VERSION
 * whenever the wording changes so each `consent_records` row pins the exact
 * version + a hash that binds the signer, relationship, and time of signing.
 *
 * NOTE: this wording is engineering-side scaffolding pending counsel review of
 * the BIPA/MHMD retention & destruction language. See docs/plans.
 */
export const CONSENT_VERSION = '2026-06-28.1'

export const CONSENT_TEXT = `Consent to Posture Screening

I authorize this practitioner and Posture AI to capture posture views of me and
to compute body-position measurements from them, for the purpose of posture
screening and movement guidance.

What is collected: body-position landmark coordinates only. Photos are processed
on this device and are never uploaded or stored — only the position measurements
are saved. No facial-recognition or face-geometry template is created.

How it is used: to produce a screening summary and movement suggestions reviewed
by the practitioner. Posture AI is a screening tool, not a medical diagnosis.

Sharing & sale: your data is not sold and is not shared with advertisers or
third-party trackers. It is stored by the practitioner using Posture AI.

Your rights: you may withdraw this consent and request deletion of your data at
any time by asking the practitioner.

By signing, I confirm I have read and agree to the above. If the person being
screened is under 18, a parent or legal guardian must sign on their behalf.`

/**
 * Deterministic hash binding a consent grant to its exact wording version,
 * signer identity, relationship, and signing time. Stored alongside the record
 * so a later change to wording or signer is detectable.
 */
export function hashConsent(parts: {
  consentVersion: string
  signerName: string
  signerRelationship: string
  signedAt: string
}): string {
  const textHash = createHash('sha256').update(CONSENT_TEXT).digest('hex')
  const canonical = [
    parts.consentVersion,
    parts.signerName.trim().toLowerCase(),
    parts.signerRelationship,
    parts.signedAt,
    textHash,
  ].join('|')
  return createHash('sha256').update(canonical).digest('hex')
}

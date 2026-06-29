import { createHash } from 'node:crypto'
import { CONSENT_TEXT } from './text'

// Re-export the client-safe constants so server code can import everything from
// one place; client code should import from './text' to avoid the node:crypto dep.
export { CONSENT_VERSION, CONSENT_TEXT } from './text'

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

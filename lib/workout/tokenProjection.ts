/**
 * Shapes the public share-link payload. resolve_workout_token() returns internal
 * ids (session/practitioner/client/run) the SERVER needs for audit + rating
 * writes — but those must never reach the client. redactSessionForPublic keeps
 * only the client-safe projection, so a leaked link reveals a first name + the
 * (identifier-free) workout content and nothing that enables an IDOR.
 */
import { canonicalLegalDocumentText, computeLegalDocumentHash } from '../legal/catalog'
import type { LegalSection, LegalSnapshot } from '../legal/types'
import type { SessionSnapshot } from './generateWorkoutSession'

export interface ResolvedSession {
  workout_session_id: string
  practitioner_id: string
  client_id: string
  session_run_id: string | null
  program_snapshot: SessionSnapshot
  estimated_duration_sec: number | null
  client_first_name: string | null
  expires_at: string | null
  share_generation?: number
  legal_document_id: string | null
  legal_document_version: string | null
  legal_document_body_sha256: string | null
  legal_document_effective_at: string | null
  legal_jurisdiction: string | null
  legal_product_scope: string | null
  legal_provenance_state: 'legacy_unverified' | 'governed'
  clinical_content_version: string | null
  clinical_inventory_sha256: string | null
}

export interface PublicSession {
  snapshot: SessionSnapshot
  estimatedDurationSec: number | null
  clientFirstName: string | null
  expiresAt: string | null
}

function timestamp(value: unknown): number | null {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) return null
  const result = Date.parse(value)
  return Number.isFinite(result) ? result : null
}

function isLegalSection(value: unknown): value is LegalSection {
  if (!value || typeof value !== 'object') return false
  const section = value as Record<string, unknown>
  return typeof section.id === 'string'
    && section.id.trim().length > 0
    && (section.heading === null || typeof section.heading === 'string')
    && Array.isArray(section.paragraphs)
    && section.paragraphs.length > 0
    && section.paragraphs.every((paragraph) => typeof paragraph === 'string' && paragraph.trim().length > 0)
    && (section.bullets === undefined || (
      Array.isArray(section.bullets)
      && section.bullets.every((bullet) => typeof bullet === 'string' && bullet.trim().length > 0)
    ))
}

function isBoundGovernedNotice(r: ResolvedSession, value: unknown): value is LegalSnapshot {
  if (!value || typeof value !== 'object') return false
  const notice = value as Record<string, unknown>
  if (
    notice.schemaVersion !== 1
    || notice.kind !== 'screening_notice'
    || notice.audience !== 'public'
    || notice.locale !== 'en-US'
    || typeof notice.documentId !== 'string'
    || typeof notice.version !== 'string'
    || typeof notice.title !== 'string'
    || typeof notice.effectiveAt !== 'string'
    || notice.jurisdiction !== 'US'
    || notice.productScope !== 'us_fitness_wellness_assessment_beta_v1'
    || typeof notice.bodySha256 !== 'string'
    || typeof notice.text !== 'string'
    || typeof notice.isFixture !== 'boolean'
    || !Array.isArray(notice.sections)
    || notice.sections.length === 0
    || !notice.sections.every(isLegalSection)
  ) return false

  const effectiveAt = timestamp(notice.effectiveAt)
  const storedEffectiveAt = timestamp(r.legal_document_effective_at)
  if (
    r.legal_provenance_state !== 'governed'
    || notice.documentId !== r.legal_document_id
    || notice.version !== r.legal_document_version
    || notice.bodySha256 !== r.legal_document_body_sha256
    || effectiveAt === null
    || storedEffectiveAt === null
    || effectiveAt !== storedEffectiveAt
    || notice.jurisdiction !== r.legal_jurisdiction
    || notice.productScope !== r.legal_product_scope
  ) return false

  try {
    const legal = notice as unknown as LegalSnapshot
    return canonicalLegalDocumentText(legal) === legal.text
      && computeLegalDocumentHash(legal) === legal.bodySha256
  } catch {
    return false
  }
}

export function isClinicalSnapshotForRelease(
  value: unknown,
  release: { version: string; inventorySha256: string },
): value is Extract<SessionSnapshot, { version: 3 }> {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Record<string, unknown>
  if (snapshot.version !== 3 || !snapshot.clinicalContent || typeof snapshot.clinicalContent !== 'object') {
    return false
  }
  const clinical = snapshot.clinicalContent as Record<string, unknown>
  return clinical.version === release.version
    && clinical.inventorySha256 === release.inventorySha256
}

export function redactSessionForPublic(
  r: ResolvedSession,
  expectedRelease: { version: string; inventorySha256: string },
): PublicSession | null {
  // Explicit field pick, not a pass-through: program_snapshot is a jsonb blob,
  // so a new snapshot field (refactor, migration, spread) must never widen the
  // public surface without being added here on purpose.
  if (isClinicalSnapshotForRelease(r.program_snapshot, expectedRelease)) {
    const { week, capability, priorities, items, estimatedDurationSec, legalNotice, clinicalContent } = r.program_snapshot
    if (!isBoundGovernedNotice(r, legalNotice)) return null
    if (
      r.clinical_content_version !== expectedRelease.version
      || r.clinical_inventory_sha256 !== expectedRelease.inventorySha256
      || clinicalContent.version !== r.clinical_content_version
      || clinicalContent.inventorySha256 !== r.clinical_inventory_sha256
    ) return null
    return {
      snapshot: { version: 3, week, capability, priorities, items, estimatedDurationSec, legalNotice, clinicalContent },
      estimatedDurationSec: r.estimated_duration_sec,
      clientFirstName: r.client_first_name,
      expiresAt: r.expires_at,
    }
  }

  // v1/v2 lack reviewed clinical-content provenance. They remain parseable for
  // erasure/inventory migration only and can never hydrate a player.
  return null
}

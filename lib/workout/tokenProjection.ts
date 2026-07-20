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
  legal_document_id: string | null
  legal_document_version: string | null
  legal_document_body_sha256: string | null
  legal_document_effective_at: string | null
  legal_jurisdiction: string | null
  legal_product_scope: string | null
  legal_provenance_state: 'legacy_unverified' | 'governed'
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

function isLegacyProvenance(r: ResolvedSession): boolean {
  return r.legal_provenance_state === 'legacy_unverified'
    && r.legal_document_id === null
    && r.legal_document_version === null
    && r.legal_document_body_sha256 === null
    && r.legal_document_effective_at === null
    && r.legal_jurisdiction === null
    && r.legal_product_scope === null
}

export function redactSessionForPublic(r: ResolvedSession): PublicSession | null {
  // Explicit field pick, not a pass-through: program_snapshot is a jsonb blob,
  // so a new snapshot field (refactor, migration, spread) must never widen the
  // public surface without being added here on purpose.
  if (r.program_snapshot.version === 2) {
    const { week, capability, priorities, items, estimatedDurationSec, legalNotice } = r.program_snapshot
    if (!isBoundGovernedNotice(r, legalNotice)) return null
    return {
      snapshot: { version: 2, week, capability, priorities, items, estimatedDurationSec, legalNotice },
      estimatedDurationSec: r.estimated_duration_sec,
      clientFirstName: r.client_first_name,
      expiresAt: r.expires_at,
    }
  }

  if (!isLegacyProvenance(r)) return null
  const { week, capability, priorities, items, estimatedDurationSec, disclaimer } = r.program_snapshot
  return {
    snapshot: { version: 1, week, capability, priorities, items, estimatedDurationSec, disclaimer },
    estimatedDurationSec: r.estimated_duration_sec,
    clientFirstName: r.client_first_name,
    expiresAt: r.expires_at,
  }
}

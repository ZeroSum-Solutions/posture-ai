import { createHash } from 'node:crypto'
import {
  FIXTURE_LEGAL_DOCUMENTS,
  PRODUCTION_LEGAL_DOCUMENTS,
} from '@/lib/legal/catalog'
import { evaluateAcceptance, snapshotLegalDocument } from '@/lib/legal/policy'
import { isLegalFixtureMode, resolveRuntimeLegalDocument } from '@/lib/legal/runtime'
import type { LegalSnapshot } from '@/lib/legal/types'

export type SubmittedConsentDocument = {
  legal_document_id?: unknown
  legal_document_version?: unknown
  legal_document_body_sha256?: unknown
}

export function matchesConsentDocument(
  document: LegalSnapshot,
  submitted: SubmittedConsentDocument,
): boolean {
  return submitted.legal_document_id === document.documentId
    && submitted.legal_document_version === document.version
    && submitted.legal_document_body_sha256 === document.bodySha256
}

export function consentLegalProvenance(document: LegalSnapshot) {
  return {
    legal_document_id: document.documentId,
    legal_document_version: document.version,
    legal_document_body_sha256: document.bodySha256,
    legal_document_effective_at: document.effectiveAt,
    legal_jurisdiction: document.jurisdiction,
    legal_product_scope: document.productScope,
    legal_provenance_state: 'governed' as const,
  }
}

export type StoredConsentDocument = {
  legal_document_id?: unknown
  legal_document_version?: unknown
  legal_document_body_sha256?: unknown
  legal_document_effective_at?: unknown
  legal_jurisdiction?: unknown
  legal_product_scope?: unknown
  legal_provenance_state?: unknown
}

export type PinnedConsentDocumentResolution =
  | { ok: true; document: LegalSnapshot }
  | { ok: false; code: 'legal_unavailable' | 'superseded' }

function sameInstant(left: unknown, right: string): boolean {
  if (typeof left !== 'string') return false
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)
  return Number.isFinite(leftTime) && leftTime === rightTime
}

export function isConsentTokenUsable(
  token: { consumed_at?: unknown; expires_at?: unknown },
  now: Date = new Date(),
): boolean {
  if (token.consumed_at != null || typeof token.expires_at !== 'string') return false
  const expiry = Date.parse(token.expires_at)
  return Number.isFinite(expiry) && expiry > now.getTime()
}

export function resolvePinnedConsentDocument(
  stored: StoredConsentDocument,
  acceptedAt: unknown,
): PinnedConsentDocumentResolution {
  const currentResolution = resolveRuntimeLegalDocument({ kind: 'subject_consent' })
  if (!currentResolution.ok) return { ok: false, code: 'legal_unavailable' }
  if (
    stored.legal_provenance_state !== 'governed'
    || typeof stored.legal_document_id !== 'string'
    || typeof acceptedAt !== 'string'
  ) return { ok: false, code: 'superseded' }

  const pinnedResolution = resolveRuntimeLegalDocument({
    kind: 'subject_consent',
    pinnedDocumentId: stored.legal_document_id,
  })
  if (!pinnedResolution.ok) return { ok: false, code: 'superseded' }
  const pinned = snapshotLegalDocument(pinnedResolution.document)
  if (
    stored.legal_document_version !== pinned.version
    || stored.legal_document_body_sha256 !== pinned.bodySha256
    || !sameInstant(stored.legal_document_effective_at, pinned.effectiveAt)
    || stored.legal_jurisdiction !== pinned.jurisdiction
    || stored.legal_product_scope !== pinned.productScope
  ) return { ok: false, code: 'superseded' }

  const documents = [
    ...PRODUCTION_LEGAL_DOCUMENTS,
    ...(isLegalFixtureMode() ? FIXTURE_LEGAL_DOCUMENTS : []),
  ]
  const decision = evaluateAcceptance({
    requiredDocument: { ...currentResolution.document, acceptanceRequired: true },
    evidence: {
      state: 'accepted',
      documentId: pinned.documentId,
      bodySha256: pinned.bodySha256,
      acceptedAt,
    },
    documents,
  })
  if (decision.state !== 'current') return { ok: false, code: 'superseded' }
  return { ok: true, document: pinned }
}

/**
 * Deterministic hash binding a consent grant to its exact wording version,
 * signer identity, relationship, and signing time. Stored alongside the record
 * so a later change to wording or signer is detectable.
 */
export function hashConsent(parts: {
  document: LegalSnapshot
  signerName: string
  signerRelationship: string
  signedAt: string
}): string {
  const canonical = JSON.stringify([
    'posture-ai-subject-consent-v1',
    parts.document.schemaVersion,
    parts.document.documentId,
    parts.document.kind,
    parts.document.version,
    parts.document.effectiveAt,
    parts.document.jurisdiction,
    parts.document.locale,
    parts.document.productScope,
    parts.document.audience,
    parts.document.bodySha256,
    parts.signerName.trim().toLowerCase(),
    parts.signerRelationship,
    parts.signedAt,
  ])
  return createHash('sha256').update(canonical).digest('hex')
}

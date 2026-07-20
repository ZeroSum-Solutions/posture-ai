import type { SupabaseClient } from '@supabase/supabase-js'
import { ageBand, canCapture, captureBlockReason, isGuardianRelationship } from '@/lib/clients/age'
import {
  FIXTURE_LEGAL_DOCUMENTS,
  PRODUCTION_LEGAL_DOCUMENTS,
} from '@/lib/legal/catalog'
import { evaluateAcceptance, snapshotLegalDocument } from '@/lib/legal/policy'
import { isLegalFixtureMode, resolveRuntimeLegalDocument } from '@/lib/legal/runtime'
import type { LegalAcceptanceState, LegalSnapshot } from '@/lib/legal/types'

export type ConsentStatus = {
  hasConsent: boolean
  signerRelationship: string | null
  legalState: LegalAcceptanceState | 'legal_unavailable'
  document: LegalSnapshot | null
}

function sameInstant(left: unknown, right: string | null): boolean {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)
  return Number.isFinite(leftTime) && leftTime === rightTime
}

/**
 * The latest non-revoked subject-consent record for a client. Accepts either an
 * RLS-scoped client (practitioner reads own) or the service client (server gate).
 */
export async function getConsentStatus(db: SupabaseClient, clientId: string): Promise<ConsentStatus> {
  // Evaluate the LATEST consent EVENT overall (not "latest non-revoked"): if the
  // most recent event is a revocation — or an enrollment that was later revoked —
  // consent is withdrawn. Picking the latest non-revoked row would let a stale
  // earlier enrollment outlive a later revocation event.
  const { data, error } = await db
    .from('consent_records')
    .select('signer_relationship, signed_at, recorded_at, revoked_at, kind, legal_document_id, legal_document_version, legal_document_body_sha256, legal_document_effective_at, legal_jurisdiction, legal_product_scope, legal_provenance_state')
    .eq('client_id', clientId)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    return {
      hasConsent: false,
      signerRelationship: null,
      legalState: 'legal_unavailable',
      document: null,
    }
  }
  if (data && (data.kind === 'revocation' || data.revoked_at)) {
    return {
      hasConsent: false,
      signerRelationship: null,
      legalState: 'withdrawn',
      document: null,
    }
  }

  const resolution = resolveRuntimeLegalDocument({ kind: 'subject_consent' })
  if (!resolution.ok) {
    return {
      hasConsent: false,
      signerRelationship: null,
      legalState: 'legal_unavailable',
      document: null,
    }
  }
  const document = snapshotLegalDocument(resolution.document)
  if (!data) {
    return {
      hasConsent: false,
      signerRelationship: null,
      legalState: 'missing',
      document,
    }
  }

  const legalHistory = [
    ...PRODUCTION_LEGAL_DOCUMENTS,
    ...(isLegalFixtureMode() ? FIXTURE_LEGAL_DOCUMENTS : []),
  ]
  const acceptedDocument = legalHistory.find((candidate) => (
    candidate.id === data.legal_document_id
  ))
  const exactStoredProvenance = data.legal_provenance_state === 'governed'
    && acceptedDocument != null
    && data.legal_document_version === acceptedDocument.version
    && data.legal_document_body_sha256 === acceptedDocument.bodySha256
    && sameInstant(data.legal_document_effective_at, acceptedDocument.effectiveAt)
    && data.legal_jurisdiction === acceptedDocument.context.jurisdiction
    && data.legal_product_scope === acceptedDocument.context.productScope

  if (!exactStoredProvenance) {
    return {
      hasConsent: false,
      signerRelationship: null,
      legalState: 'reconsent_required',
      document,
    }
  }

  const decision = evaluateAcceptance({
    requiredDocument: { ...resolution.document, acceptanceRequired: true },
    evidence: {
      state: 'accepted',
      documentId: data.legal_document_id,
      bodySha256: data.legal_document_body_sha256,
      acceptedAt: data.signed_at,
    },
    documents: legalHistory,
  })
  if (decision.state !== 'current') {
    return {
      hasConsent: false,
      signerRelationship: null,
      legalState: decision.state === 'withdrawn' ? 'withdrawn' : 'reconsent_required',
      document,
    }
  }

  // Preserve the exact document the subject actually signed. A declared
  // non-material successor may keep that acceptance current, but it must never
  // cause a new assessment to claim the subject saw the successor wording.
  const acceptedResolution = resolveRuntimeLegalDocument({
    kind: 'subject_consent',
    pinnedDocumentId: acceptedDocument.id,
  })
  if (!acceptedResolution.ok) {
    return {
      hasConsent: false,
      signerRelationship: null,
      legalState: 'reconsent_required',
      document,
    }
  }
  const acceptedSnapshot = snapshotLegalDocument(acceptedResolution.document)

  return {
    hasConsent: true,
    signerRelationship: data.signer_relationship as string,
    legalState: 'current',
    document: acceptedSnapshot,
  }
}

/**
 * Whether a subject may be captured: requires (a) a valid subject consent and
 * (b) the age gate to pass (under-13 blocked; 13–17 needs a guardian-signed
 * consent; unknown DOB blocked). Returns a human-readable reason when blocked.
 */
export function captureEligibility(
  dob: string | null | undefined,
  consent: ConsentStatus,
  now: Date = new Date(),
): { ok: boolean; reason: string | null } {
  if (!consent.hasConsent) {
    return { ok: false, reason: 'Subject consent is required before screening can begin.' }
  }
  const band = ageBand(dob, now)
  const hasGuardianConsent = isGuardianRelationship(consent.signerRelationship)
  if (!canCapture(band, hasGuardianConsent)) {
    return { ok: false, reason: captureBlockReason(band, hasGuardianConsent) }
  }
  return { ok: true, reason: null }
}

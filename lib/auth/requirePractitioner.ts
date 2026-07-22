import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import {
  FIXTURE_LEGAL_DOCUMENTS,
  PRODUCTION_LEGAL_DOCUMENTS,
} from '@/lib/legal/catalog'
import { evaluateAcceptance } from '@/lib/legal/policy'
import {
  isLegalFixtureMode,
  resolveRuntimeLegalDocument,
} from '@/lib/legal/runtime'
import type {
  LegalDocumentKind,
  ResolvedLegalDocument,
} from '@/lib/legal/types'

export type AdmittedPractitioner = {
  id: string
  organization_id: string | null
  practice_name: string | null
  display_name: string | null
  access_status: string
  role: string
}

export type PractitionerAdmission =
  | { practitioner: AdmittedPractitioner; response: null }
  | { practitioner: null; response: NextResponse }

function forbidden(code: 'mfa_required' | 'practitioner_access_required' | 'compliance' | 'legal_acceptance_required', error: string) {
  return NextResponse.json({ error, code }, { status: 403 })
}

function legalUnavailable() {
  return NextResponse.json(
    { error: 'Legal documents are temporarily unavailable.', code: 'legal_unavailable' },
    { status: 503 },
  )
}

const PRACTITIONER_DOCUMENT_KINDS = [
  'terms',
  'privacy',
  'screening_notice',
] as const satisfies readonly LegalDocumentKind[]

type PractitionerLegalAcceptance = {
  legal_document_id: string | null
  legal_document_version: string | null
  legal_document_body_sha256: string | null
  legal_document_effective_at: string | null
  legal_jurisdiction: string | null
  legal_product_scope: string | null
  accepted_at: string | null
}

function sameInstant(left: unknown, right: string | null): boolean {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const leftTime = Date.parse(left)
  const rightTime = Date.parse(right)
  return Number.isFinite(leftTime) && leftTime === rightTime
}

export type PractitionerLegalAcceptanceStatus =
  | 'current'
  | 'required'
  | 'unavailable'

export async function practitionerLegalAcceptanceStatus(
  supabase: SupabaseClient,
  practitionerId: string,
): Promise<PractitionerLegalAcceptanceStatus> {
  const requiredDocuments: ResolvedLegalDocument[] = []
  for (const kind of PRACTITIONER_DOCUMENT_KINDS) {
    const resolution = resolveRuntimeLegalDocument({ kind })
    if (!resolution.ok) return 'unavailable'
    // Product policy requires affirmative practitioner acceptance of all three
    // launch documents even when catalog copy is also publicly readable.
    requiredDocuments.push({ ...resolution.document, acceptanceRequired: true })
  }

  let acceptanceRows: PractitionerLegalAcceptance[]
  try {
    const { data, error } = await supabase
      .from('practitioner_legal_acceptances')
      .select('legal_document_id, legal_document_version, legal_document_body_sha256, legal_document_effective_at, legal_jurisdiction, legal_product_scope, accepted_at, recorded_at')
      .eq('practitioner_id', practitionerId)
      .order('recorded_at', { ascending: false })
    if (error || !Array.isArray(data)) return 'unavailable'
    acceptanceRows = data as PractitionerLegalAcceptance[]
  } catch {
    return 'unavailable'
  }

  const legalHistory = [
    ...PRODUCTION_LEGAL_DOCUMENTS,
    ...(isLegalFixtureMode() ? FIXTURE_LEGAL_DOCUMENTS : []),
  ]
  const everyDocumentCurrent = requiredDocuments.every((requiredDocument) => (
    acceptanceRows.some((row) => {
      const acceptedDocument = legalHistory.find((document) => (
        document.id === row.legal_document_id
      ))
      if (
        !acceptedDocument
        || row.legal_document_version !== acceptedDocument.version
        || row.legal_document_body_sha256 !== acceptedDocument.bodySha256
        || !sameInstant(row.legal_document_effective_at, acceptedDocument.effectiveAt)
        || row.legal_jurisdiction !== acceptedDocument.context.jurisdiction
        || row.legal_product_scope !== acceptedDocument.context.productScope
      ) return false
      return evaluateAcceptance({
        requiredDocument,
        evidence: {
          state: 'accepted',
          documentId: row.legal_document_id,
          bodySha256: row.legal_document_body_sha256,
          acceptedAt: row.accepted_at,
        },
        documents: legalHistory,
      }).state === 'current'
    })
  ))

  return everyDocumentCurrent ? 'current' : 'required'
}

/**
 * Admission shared by the normal practitioner gate and the organization-settings
 * exception. Authentication (401) remains the caller's responsibility; this
 * function authorizes only sessions that have reached AAL2 and whose practitioner
 * account is explicitly active.
 */
export async function practitionerAdmission(
  supabase: SupabaseClient,
  userId: string,
): Promise<PractitionerAdmission> {
  try {
    const { data: assurance, error: assuranceError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

    if (assuranceError || assurance?.currentLevel !== 'aal2') {
      return {
        practitioner: null,
        response: forbidden('mfa_required', 'Multi-factor authentication is required.'),
      }
    }
  } catch {
    return {
      practitioner: null,
      response: forbidden('mfa_required', 'Multi-factor authentication is required.'),
    }
  }

  try {
    const { data, error } = await supabase
      .from('practitioners')
      .select('id, organization_id, practice_name, display_name, access_status, role')
      .eq('id', userId)
      .maybeSingle()
    const practitioner = data as AdmittedPractitioner | null

    if (
      error ||
      !practitioner ||
      practitioner.access_status !== 'active' ||
      practitioner.role !== 'practitioner'
    ) {
      return {
        practitioner: null,
        response: forbidden(
          'practitioner_access_required',
          'Active practitioner access is required.',
        ),
      }
    }

    return { practitioner, response: null }
  } catch {
    return {
      practitioner: null,
      response: forbidden(
        'practitioner_access_required',
        'Active practitioner access is required.',
      ),
    }
  }
}

/**
 * Practitioner access gate for API routes. Reuses the caller's already-authed
 * Supabase client + user id (no extra session round-trip) and enforces:
 *  1. the session has reached AAL2 — 403 otherwise,
 *  2. the user is an active practitioner — 403 otherwise,
 *  3. the HIPAA org BAA gate: if the practitioner belongs to a covered-entity
 *     organization whose BAA is not signed, access is blocked (403).
 *
 * Returns a NextResponse to short-circuit with, or null when access is allowed.
 * Combined with the 401 the routes already do for unauthenticated requests and
 * with RLS, this honors the FDA consumer NO-GO: only an authenticated
 * practitioner may reach capture, results, or exercise output.
 *
 * Usage (additive, right after the existing `if (!user)` check):
 *   const gate = await practitionerGate(supabase, user.id)
 *   if (gate) return gate
 */
export async function practitionerGate(
  supabase: SupabaseClient,
  userId: string,
): Promise<NextResponse | null> {
  const admission = await practitionerAdmission(supabase, userId)
  if (admission.response) return admission.response
  const prac = admission.practitioner
  const service = createSupabaseServiceClient()

  if (prac.organization_id) {
    // Read the org with service-role: the BAA gate must not depend on the
    // (now own-org-scoped) organizations RLS policy, and this is the caller's own
    // org id (no IDOR).
    const { data: org, error } = await service
      .from('organizations')
      .select('is_covered_entity, baa_status')
      .eq('id', prac.organization_id)
      .maybeSingle()

    // FAIL CLOSED: an org-linked practitioner whose org cannot be read (query
    // error, or a dangling organization_id) is denied. A HIPAA BAA gate must
    // never be skipped just because the compliance check itself failed.
    if (error || !org) {
      return forbidden(
        'compliance',
        'Could not verify your organization’s compliance status. Please try again.',
      )
    }

    if (org.is_covered_entity === true && org.baa_status !== 'signed') {
      return forbidden(
        'compliance',
        'A signed Business Associate Agreement is required before practitioner mode can be used for this organization.',
      )
    }
  }

  const legalStatus = await practitionerLegalAcceptanceStatus(service, userId)
  if (legalStatus === 'unavailable') return legalUnavailable()
  if (legalStatus === 'required') {
    return forbidden(
      'legal_acceptance_required',
      'Review and accept the current legal documents before using practitioner mode.',
    )
  }

  return null
}

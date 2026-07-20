import { NextRequest, NextResponse } from 'next/server'

import { practitionerAdmission } from '@/lib/auth/requirePractitioner'
import { snapshotLegalDocument } from '@/lib/legal/policy'
import { resolveRuntimeLegalDocument } from '@/lib/legal/runtime'
import type { LegalDocumentKind, LegalSnapshot } from '@/lib/legal/types'
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase/server'

const PRACTITIONER_DOCUMENT_KINDS = [
  'terms',
  'privacy',
  'screening_notice',
] as const satisfies readonly LegalDocumentKind[]

type SubmittedDocument = {
  document_id?: unknown
  body_sha256?: unknown
}

function resolveRequiredDocuments(): LegalSnapshot[] | null {
  const snapshots: LegalSnapshot[] = []
  for (const kind of PRACTITIONER_DOCUMENT_KINDS) {
    const resolution = resolveRuntimeLegalDocument({ kind })
    if (!resolution.ok) return null
    snapshots.push(snapshotLegalDocument(resolution.document))
  }
  return snapshots
}

function matchesResolvedDocuments(
  submitted: unknown,
  required: readonly LegalSnapshot[],
): boolean {
  if (!Array.isArray(submitted) || submitted.length !== required.length) return false
  const byId = new Map<string, string>()
  for (const raw of submitted as SubmittedDocument[]) {
    if (
      typeof raw?.document_id !== 'string'
      || typeof raw?.body_sha256 !== 'string'
      || byId.has(raw.document_id)
    ) return false
    byId.set(raw.document_id, raw.body_sha256)
  }
  return required.every((document) => (
    byId.get(document.documentId) === document.bodySha256
  ))
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Deliberately use admission, not practitionerGate: this is the narrow active
  // AAL2 corridor through which the practitioner satisfies that gate.
  const admission = await practitionerAdmission(supabase, user.id)
  if (admission.response) return admission.response

  const required = resolveRequiredDocuments()
  if (!required) {
    return NextResponse.json(
      { error: 'Legal documents are temporarily unavailable.', code: 'legal_unavailable' },
      { status: 503 },
    )
  }

  let body: { documents?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.', code: 'invalid_request' }, { status: 400 })
  }

  if (!matchesResolvedDocuments(body.documents, required)) {
    return NextResponse.json(
      { error: 'The legal documents changed. Review the current documents and try again.', code: 'superseded' },
      { status: 409 },
    )
  }

  const acceptedAt = new Date().toISOString()
  const rows = required.map((document) => ({
    practitioner_id: user.id,
    legal_document_id: document.documentId,
    legal_document_version: document.version,
    legal_document_body_sha256: document.bodySha256,
    legal_document_effective_at: document.effectiveAt,
    legal_jurisdiction: document.jurisdiction,
    legal_product_scope: document.productScope,
    acceptance_context: 'practitioner_onboarding_v1',
    acceptance_method: 'authenticated_checkbox',
    accepted_at: acceptedAt,
  }))

  const service = createSupabaseServiceClient()
  const { error } = await service.from('practitioner_legal_acceptances').upsert(rows, {
    onConflict: 'practitioner_id,legal_document_id,legal_document_version,legal_document_body_sha256,legal_document_effective_at,legal_jurisdiction,legal_product_scope,acceptance_context',
    ignoreDuplicates: true,
  })
  if (error) {
    return NextResponse.json(
      { error: 'Could not record legal acceptance.', code: 'acceptance_failed' },
      { status: 500 },
    )
  }

  return NextResponse.json({ accepted: true })
}

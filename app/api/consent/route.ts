import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { enforceRateLimitStrict } from '@/lib/rate-limit'
import { logEvent, hashUser } from '@/lib/log'
import {
  hashConsent,
  matchesConsentDocument,
  type SubmittedConsentDocument,
} from '@/lib/consent/policy'
import { snapshotLegalDocument } from '@/lib/legal/policy'
import { resolveRuntimeLegalDocument } from '@/lib/legal/runtime'
import { captureEligibility, getConsentStatus } from '@/lib/consent/record'

// In-person subject consent for an existing client (typed-name e-signature on the
// practitioner's device). Writes an immutable consent_record and stamps the
// client's consent_recorded_at. Remote consent uses /api/consent/link + respond.
const RELATIONSHIPS = new Set(['self', 'parent', 'legal_guardian', 'other'])
const ROUTE = 'POST /api/consent'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  const clientId = req.nextUrl.searchParams.get('client_id')
  if (!clientId) {
    return NextResponse.json({ error: 'client_id is required' }, { status: 400, headers: NO_STORE })
  }

  // Use the caller's RLS-scoped client for the ownership lookup and consent read.
  // The browser receives only the decision required to render the gate; the legal
  // catalog, hashes, and server fixture-mode environment never enter client chunks.
  const { data: client, error } = await supabase
    .from('clients')
    .select('id, date_of_birth')
    .eq('id', clientId)
    .eq('practitioner_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    return NextResponse.json({ error: 'Could not verify client consent.' }, { status: 500, headers: NO_STORE })
  }
  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404, headers: NO_STORE })
  }

  const consent = await getConsentStatus(supabase, clientId)
  const eligibility = captureEligibility(client.date_of_birth, consent)
  return NextResponse.json({
    hasConsent: consent.hasConsent,
    legalState: consent.legalState,
    captureAllowed: eligibility.ok,
    reason: eligibility.reason,
  }, { headers: NO_STORE })
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate
  const userHash = hashUser(user.id)

  const service = createSupabaseServiceClient()
  const allowed = await enforceRateLimitStrict(service, { route: 'consent_create', userId: user.id, limit: 20, windowSeconds: 60 })
  if (!allowed) {
    logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429, userHash })
    return NextResponse.json({ error: 'Too many requests — try again shortly' }, { status: 429 })
  }

  let body: {
    client_id?: string
    signer_name?: string
    signer_relationship?: string
  } & SubmittedConsentDocument
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { client_id, signer_name, signer_relationship } = body
  if (!client_id || !signer_name?.trim() || !signer_relationship || !RELATIONSHIPS.has(signer_relationship)) {
    return NextResponse.json({ error: 'Missing or invalid consent fields' }, { status: 400 })
  }

  const resolution = resolveRuntimeLegalDocument({ kind: 'subject_consent' })
  if (!resolution.ok) {
    return NextResponse.json(
      { error: 'Consent terms are temporarily unavailable.', code: 'legal_unavailable' },
      { status: 503 },
    )
  }
  const document = snapshotLegalDocument(resolution.document)
  if (!matchesConsentDocument(document, body)) {
    return NextResponse.json(
      { error: 'The consent terms changed. Review the current terms and try again.', code: 'superseded' },
      { status: 409 },
    )
  }

  const signedAt = new Date().toISOString()
  const consentHash = hashConsent({
    document,
    signerName: signer_name,
    signerRelationship: signer_relationship,
    signedAt,
  })

  // Record atomically via a service-role RPC (authenticated DB writes on regulated
  // tables are revoked). The RPC locks the owned client row and refuses a
  // tombstoned (erased) one, so consent can't be recorded on a client mid/after a
  // right-to-erasure deletion — the same guarantee the remote path gets.
  const { data: result, error } = await service.rpc('record_inperson_consent_governed', {
    p_client_id: client_id,
    p_practitioner_id: user.id,
    p_document_id: document.documentId,
    p_document_version: document.version,
    p_document_body_sha256: document.bodySha256,
    p_document_effective_at: document.effectiveAt,
    p_jurisdiction: document.jurisdiction,
    p_product_scope: document.productScope,
    p_signer_name: signer_name,
    p_signer_relationship: signer_relationship,
    p_consent_hash: consentHash,
    p_signed_at: signedAt,
  })
  if (error) return NextResponse.json({ error: 'Failed to record consent' }, { status: 500 })
  if (result === 'not_found') return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  if (result !== 'ok') return NextResponse.json({ error: 'Failed to record consent' }, { status: 400 })
  return NextResponse.json({ ok: true }, { status: 201 })
}

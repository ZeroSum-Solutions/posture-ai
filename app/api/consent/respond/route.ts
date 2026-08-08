import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { enforceRateLimitStrict } from '@/lib/rate-limit'
import { logEvent, hashIp } from '@/lib/log'
import {
  hashConsent,
  matchesConsentDocument,
  resolvePinnedConsentDocument,
  type SubmittedConsentDocument,
} from '@/lib/consent/policy'
import { hashConsentToken } from '@/lib/consent/token'

// PUBLIC endpoint (allow-listed in proxy.ts): the remote subject completes their
// consent here. The single-use token is the credential, so this runs with the
// service client (no session). Writes an immutable consent_record and stamps the
// client's consent_recorded_at.
const RELATIONSHIPS = new Set(['self', 'parent', 'legal_guardian', 'other'])
const ROUTE = 'POST /api/consent/respond'
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

export async function POST(req: NextRequest) {
  let body: {
    token?: string
    signer_name?: string
    signer_relationship?: string
  } & SubmittedConsentDocument
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { token, signer_name, signer_relationship } = body
  if (!token || !signer_name?.trim() || !signer_relationship || !RELATIONSHIPS.has(signer_relationship)) {
    return NextResponse.json({ error: 'Missing or invalid consent fields' }, { status: 400 })
  }
  if (signer_name.trim().length > 200) {
    return NextResponse.json({ error: 'Signer name is too long.' }, { status: 400 })
  }

  const service = createSupabaseServiceClient()

  // Public endpoint — same IP rate limit as the other token-credential routes.
  const ipHash = hashIp(req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for'))
  const allowed = await enforceRateLimitStrict(service, { route: 'consent_respond', userId: ipHash ?? 'anon', limit: 10, windowSeconds: 60 })
  if (!allowed) {
    logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429, userHash: ipHash ?? 'anon' })
    return NextResponse.json({ error: 'Too many requests — try again shortly.' }, { status: 429 })
  }

  const signedAt = new Date().toISOString()
  const tokenHash = hashConsentToken(token)

  // The consent hash binds to the wording version stored on the token (immutable
  // once minted), so read it first to hash in the app layer. The single-use claim
  // + consent-record insert + client stamp then run atomically in ONE DB
  // transaction (record_remote_consent): it cannot consume the token without also
  // writing the consent record, closing the prior best-effort-rollback gap and the
  // TOCTOU duplicate-consent race in one shot.
  const { data: tok, error: tokenError } = await service
    .from('consent_tokens')
    .select('created_at, legal_document_id, legal_document_version, legal_document_body_sha256, legal_document_effective_at, legal_jurisdiction, legal_product_scope, legal_provenance_state')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (tokenError) {
    return NextResponse.json({ error: 'Failed to verify consent link.' }, { status: 500, headers: NO_STORE })
  }
  if (!tok) return NextResponse.json({ error: 'Invalid consent link.' }, { status: 404, headers: NO_STORE })

  const pinned = resolvePinnedConsentDocument(tok, tok.created_at)
  if (!pinned.ok) {
    const unavailable = pinned.code === 'legal_unavailable'
    return NextResponse.json(
      {
        error: unavailable
          ? 'Consent terms are temporarily unavailable.'
          : 'This consent link refers to terms that are no longer valid.',
        code: pinned.code,
      },
      { status: unavailable ? 503 : 410, headers: NO_STORE },
    )
  }
  if (!matchesConsentDocument(pinned.document, body)) {
    return NextResponse.json(
      { error: 'The consent terms changed. Reload the link and try again.', code: 'superseded' },
      { status: 409, headers: NO_STORE },
    )
  }

  const consentHash = hashConsent({
    document: pinned.document,
    signerName: signer_name,
    signerRelationship: signer_relationship,
    signedAt,
  })

  const { data: result, error } = await service.rpc('record_remote_consent_governed', {
    p_token_hash: tokenHash,
    p_presented_document_id: pinned.document.documentId,
    p_presented_document_version: pinned.document.version,
    p_presented_document_body_sha256: pinned.document.bodySha256,
    p_signer_name: signer_name.trim(),
    p_signer_relationship: signer_relationship,
    p_consent_hash: consentHash,
    p_signed_at: signedAt,
  })
  if (error) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash: ipHash ?? 'anon', detailCode: 'remote_consent_rpc_failed' })
    return NextResponse.json({ error: 'Failed to record consent.' }, { status: 500 })
  }

  switch (result) {
    case 'ok': return NextResponse.json({ ok: true }, { headers: NO_STORE })
    case 'not_found': return NextResponse.json({ error: 'Invalid consent link.' }, { status: 404 })
    case 'consumed': return NextResponse.json({ error: 'This consent link has already been used.' }, { status: 410 })
    case 'expired': return NextResponse.json({ error: 'This consent link has expired.' }, { status: 410 })
    case 'ungoverned':
    case 'document_mismatch':
    case 'not_effective':
      return NextResponse.json(
        { error: 'The consent terms changed. Reload the link and try again.', code: 'superseded' },
        { status: 409, headers: NO_STORE },
      )
    default: return NextResponse.json({ error: 'Failed to record consent.' }, { status: 500 })
  }
}

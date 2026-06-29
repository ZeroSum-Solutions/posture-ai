import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { hashConsent } from '@/lib/consent/policy'

// PUBLIC endpoint (allow-listed in proxy.ts): the remote subject completes their
// consent here. The single-use token is the credential, so this runs with the
// service client (no session). Writes an immutable consent_record and stamps the
// client's consent_recorded_at.
const RELATIONSHIPS = new Set(['self', 'parent', 'legal_guardian', 'other'])

export async function POST(req: NextRequest) {
  let body: { token?: string; signer_name?: string; signer_relationship?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { token, signer_name, signer_relationship } = body
  if (!token || !signer_name?.trim() || !signer_relationship || !RELATIONSHIPS.has(signer_relationship)) {
    return NextResponse.json({ error: 'Missing or invalid consent fields' }, { status: 400 })
  }

  const service = createSupabaseServiceClient()
  const signedAt = new Date().toISOString()

  // Atomically claim the single-use token: the UPDATE only matches an unconsumed,
  // unexpired token, so two concurrent requests can't both succeed (prevents a
  // TOCTOU duplicate-consent race — single-use is enforced by the DB write).
  const { data: claimed } = await service
    .from('consent_tokens')
    .update({ consumed_at: signedAt })
    .eq('token', token)
    .is('consumed_at', null)
    .gt('expires_at', signedAt)
    .select('client_id, practitioner_id, consent_version')
    .maybeSingle()

  if (!claimed) {
    const { data: tok } = await service.from('consent_tokens').select('consumed_at').eq('token', token).maybeSingle()
    if (!tok) return NextResponse.json({ error: 'Invalid consent link.' }, { status: 404 })
    if (tok.consumed_at) return NextResponse.json({ error: 'This consent link has already been used.' }, { status: 410 })
    return NextResponse.json({ error: 'This consent link has expired.' }, { status: 410 })
  }

  const consentHash = hashConsent({
    consentVersion: claimed.consent_version,
    signerName: signer_name,
    signerRelationship: signer_relationship,
    signedAt,
  })

  const { error: insErr } = await service.from('consent_records').insert({
    client_id: claimed.client_id,
    practitioner_id: claimed.practitioner_id,
    kind: 'enrollment',
    consent_version: claimed.consent_version,
    consent_hash: consentHash,
    signer_name: signer_name.trim(),
    signer_relationship,
    method: 'remote_link',
    signed_at: signedAt,
  })
  if (insErr) {
    // Roll back the claim so the subject can retry.
    await service.from('consent_tokens').update({ consumed_at: null }).eq('token', token)
    return NextResponse.json({ error: 'Failed to record consent.' }, { status: 500 })
  }

  await service.from('clients').update({ consent_recorded_at: signedAt }).eq('id', claimed.client_id)
  return NextResponse.json({ ok: true })
}

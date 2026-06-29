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
  const { data: tok } = await service.from('consent_tokens').select('*').eq('token', token).maybeSingle()
  if (!tok) return NextResponse.json({ error: 'Invalid consent link.' }, { status: 404 })
  if (tok.consumed_at) return NextResponse.json({ error: 'This consent link has already been used.' }, { status: 410 })
  if (new Date(tok.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'This consent link has expired.' }, { status: 410 })
  }

  const signedAt = new Date().toISOString()
  const consentHash = hashConsent({
    consentVersion: tok.consent_version,
    signerName: signer_name,
    signerRelationship: signer_relationship,
    signedAt,
  })

  const { error: insErr } = await service.from('consent_records').insert({
    client_id: tok.client_id,
    practitioner_id: tok.practitioner_id,
    kind: 'enrollment',
    consent_version: tok.consent_version,
    consent_hash: consentHash,
    signer_name: signer_name.trim(),
    signer_relationship,
    method: 'remote_link',
    signed_at: signedAt,
  })
  if (insErr) return NextResponse.json({ error: 'Failed to record consent.' }, { status: 500 })

  await service.from('consent_tokens').update({ consumed_at: signedAt }).eq('token', token)
  await service.from('clients').update({ consent_recorded_at: signedAt }).eq('id', tok.client_id)

  return NextResponse.json({ ok: true })
}

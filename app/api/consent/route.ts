import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { CONSENT_VERSION, hashConsent } from '@/lib/consent/policy'

// In-person subject consent for an existing client (typed-name e-signature on the
// practitioner's device). Writes an immutable consent_record and stamps the
// client's consent_recorded_at. Remote consent uses /api/consent/link + respond.
const RELATIONSHIPS = new Set(['self', 'parent', 'legal_guardian', 'other'])

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  let body: { client_id?: string; signer_name?: string; signer_relationship?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { client_id, signer_name, signer_relationship } = body
  if (!client_id || !signer_name?.trim() || !signer_relationship || !RELATIONSHIPS.has(signer_relationship)) {
    return NextResponse.json({ error: 'Missing or invalid consent fields' }, { status: 400 })
  }

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('id', client_id)
    .eq('practitioner_id', user.id)
    .maybeSingle()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const signedAt = new Date().toISOString()
  const consentHash = hashConsent({
    consentVersion: CONSENT_VERSION,
    signerName: signer_name,
    signerRelationship: signer_relationship,
    signedAt,
  })

  const { error } = await supabase.from('consent_records').insert({
    client_id,
    practitioner_id: user.id,
    kind: 'enrollment',
    consent_version: CONSENT_VERSION,
    consent_hash: consentHash,
    signer_name: signer_name.trim(),
    signer_relationship,
    method: 'e_signature',
    signed_at: signedAt,
  })
  if (error) return NextResponse.json({ error: 'Failed to record consent' }, { status: 500 })

  await supabase.from('clients').update({ consent_recorded_at: signedAt }).eq('id', client_id).eq('practitioner_id', user.id)
  return NextResponse.json({ ok: true }, { status: 201 })
}

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
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

  const signedAt = new Date().toISOString()
  const consentHash = hashConsent({
    consentVersion: CONSENT_VERSION,
    signerName: signer_name,
    signerRelationship: signer_relationship,
    signedAt,
  })

  // Record atomically via a service-role RPC (authenticated DB writes on regulated
  // tables are revoked). The RPC locks the owned client row and refuses a
  // tombstoned (erased) one, so consent can't be recorded on a client mid/after a
  // right-to-erasure deletion — the same guarantee the remote path gets.
  const service = createSupabaseServiceClient()
  const { data: result, error } = await service.rpc('record_inperson_consent', {
    p_client_id: client_id,
    p_practitioner_id: user.id,
    p_consent_version: CONSENT_VERSION,
    p_signer_name: signer_name,
    p_signer_relationship: signer_relationship,
    p_consent_hash: consentHash,
    p_signed_at: signedAt,
  })
  if (error) return NextResponse.json({ error: 'Failed to record consent' }, { status: 500 })
  if (result === 'not_found') return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  return NextResponse.json({ ok: true }, { status: 201 })
}

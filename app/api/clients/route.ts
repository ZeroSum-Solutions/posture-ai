import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { CONSENT_VERSION, hashConsent } from '@/lib/consent/policy'
import { NextRequest, NextResponse } from 'next/server'

const SIGNER_RELATIONSHIPS = new Set(['self', 'parent', 'legal_guardian', 'other'])

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  console.log('[api/clients] GET: SELECT from clients via .from().select()')
  const { data, error } = await supabase
    .from('clients')
    .select('id, first_name, last_name, date_of_birth, sex_at_birth, height_cm, weight_kg, notes, created_at')
    .is('archived_at', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[api/clients] GET error:', error.message)
    return NextResponse.json({ error: 'Failed to load clients.' }, { status: 500 })
  }
  console.log('[api/clients] GET: returned ' + data.length + ' rows from clients table')
  return NextResponse.json({ clients: data, count: data.length })
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { first_name, last_name, date_of_birth, sex_at_birth, height_cm, weight_kg, notes, consent_mode, signer_name, signer_relationship } = body as {
    first_name?: string; last_name?: string; date_of_birth?: string
    sex_at_birth?: string; height_cm?: number; weight_kg?: number
    notes?: string; consent_mode?: string; signer_name?: string; signer_relationship?: string
  }
  if (!first_name || !last_name) return NextResponse.json({ error: 'first_name and last_name are required' }, { status: 400 })

  // Consent: capture the subject's e-signature now (in-person), or create the
  // client with consent pending and send a remote link afterward. Either way the
  // subject (not just the practitioner) is the one who consents.
  const remote = consent_mode === 'remote'
  if (!remote && (!signer_name?.trim() || !signer_relationship || !SIGNER_RELATIONSHIPS.has(signer_relationship))) {
    return NextResponse.json({ error: 'Subject consent is required: provide a signer name and relationship, or choose remote consent.' }, { status: 400 })
  }

  const row: Record<string, unknown> = { practitioner_id: user.id, first_name, last_name }
  if (date_of_birth) row.date_of_birth = date_of_birth
  if (sex_at_birth) row.sex_at_birth = sex_at_birth
  if (height_cm != null) row.height_cm = height_cm
  if (weight_kg != null) row.weight_kg = weight_kg
  if (notes) row.notes = notes

  // Writes go through the service-role client: direct DB-write grants on regulated
  // tables are revoked from `authenticated` (regulatory_hardening_v2), so the API
  // is the sole writer and the gates above are the real enforcement. Ownership is
  // set/scoped on every write since service-role bypasses RLS.
  const service = createSupabaseServiceClient()
  const { data, error } = await service.from('clients').insert(row).select().single()
  if (error) {
    console.error('[api/clients] POST error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!remote) {
    const signedAt = new Date().toISOString()
    const consentHash = hashConsent({
      consentVersion: CONSENT_VERSION,
      signerName: signer_name as string,
      signerRelationship: signer_relationship as string,
      signedAt,
    })
    // Atomic via the same locked RPC as /api/consent: consent insert + client
    // stamp in one transaction, with the client row locked + deleted-checked. This
    // also closes the window between the client insert above and the consent write.
    const { data: cResult, error: cErr } = await service.rpc('record_inperson_consent', {
      p_client_id: data.id,
      p_practitioner_id: user.id,
      p_consent_version: CONSENT_VERSION,
      p_signer_name: signer_name as string,
      p_signer_relationship: signer_relationship,
      p_consent_hash: consentHash,
      p_signed_at: signedAt,
    })
    if (cErr || cResult !== 'ok') {
      console.error('[api/clients] POST consent error:', cErr?.message ?? cResult)
      return NextResponse.json({ error: 'Client created but consent could not be recorded. Record consent before screening.', client: data }, { status: 201 })
    }
    ;(data as Record<string, unknown>).consent_recorded_at = signedAt
  }

  return NextResponse.json({ client: data }, { status: 201 })
}

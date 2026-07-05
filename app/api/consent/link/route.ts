import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { CONSENT_VERSION } from '@/lib/consent/policy'
import { consentQrDataUrl } from '@/lib/consent/qr'
import { generateConsentToken } from '@/lib/consent/token'

// Practitioner-initiated remote consent: mints a single-use, 7-day token for a
// client and returns a shareable link + QR. The subject completes it at
// /consent/[token] (public) without needing an account.
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  let body: { client_id?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const clientId = body.client_id
  if (!clientId) return NextResponse.json({ error: 'client_id is required' }, { status: 400 })

  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('practitioner_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  // The consent_tokens_reject_deleted_client trigger is the race-safe hard guard;
  // this check just gives a clean 404 in the common (already-deleted) case.

  const { token, tokenHash } = generateConsentToken()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const service = createSupabaseServiceClient()
  const { error } = await service.from('consent_tokens').insert({
    token_hash: tokenHash,
    client_id: clientId,
    practitioner_id: user.id,
    consent_version: CONSENT_VERSION,
    expires_at: expiresAt,
  })
  if (error) return NextResponse.json({ error: 'Failed to create consent link' }, { status: 500 })

  const url = `${new URL(req.url).origin}/consent/${token}`
  const qr = await consentQrDataUrl(url)
  return NextResponse.json({ url, qr, expires_at: expiresAt })
}

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { enforceRateLimitStrict } from '@/lib/rate-limit'
import { logEvent, hashUser } from '@/lib/log'
import { consentLegalProvenance } from '@/lib/consent/policy'
import { consentQrDataUrl } from '@/lib/consent/qr'
import { generateConsentToken } from '@/lib/consent/token'
import { snapshotLegalDocument } from '@/lib/legal/policy'
import { resolveRuntimeLegalDocument } from '@/lib/legal/runtime'

// Practitioner-initiated remote consent: mints a single-use, 7-day token for a
// client and returns a shareable link + QR. The subject completes it at
// /consent/[token] (public) without needing an account.
const ROUTE = 'POST /api/consent/link'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate
  const userHash = hashUser(user.id)

  const service = createSupabaseServiceClient()
  const allowed = await enforceRateLimitStrict(service, { route: 'consent_link', userId: user.id, limit: 20, windowSeconds: 60 })
  if (!allowed) {
    logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429, userHash })
    return NextResponse.json({ error: 'Too many requests — try again shortly' }, { status: 429 })
  }

  let body: { client_id?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const clientId = body.client_id
  if (!clientId) return NextResponse.json({ error: 'client_id is required' }, { status: 400 })

  const legalResolution = resolveRuntimeLegalDocument({ kind: 'subject_consent' })
  if (!legalResolution.ok) {
    return NextResponse.json(
      { error: 'Consent terms are temporarily unavailable.', code: 'legal_unavailable' },
      { status: 503 },
    )
  }
  const document = snapshotLegalDocument(legalResolution.document)

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

  const { error } = await service.from('consent_tokens').insert({
    token_hash: tokenHash,
    client_id: clientId,
    practitioner_id: user.id,
    consent_version: document.version,
    expires_at: expiresAt,
    ...consentLegalProvenance(document),
  })
  if (error) return NextResponse.json({ error: 'Failed to create consent link' }, { status: 500 })

  // Build the shareable link from the canonical app origin, not the request Host
  // header (which the caller controls) — a PHI consent link must never point off-site.
  // Mirrors the hardened workouts share-link route.
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/+$/, '')
  const url = `${origin}/consent/${token}`
  const qr = await consentQrDataUrl(url)
  return NextResponse.json({ url, qr, expires_at: expiresAt })
}

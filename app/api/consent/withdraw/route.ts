import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { hashResource, hashUser, logEvent } from '@/lib/log'
import { enforceRateLimitStrict } from '@/lib/rate-limit'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

const ROUTE = 'POST /api/consent/withdraw'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

const bodySchema = z.object({
  client_id: z.string().uuid(),
  signer_name: z.string().trim().min(1).max(200),
  signer_relationship: z.enum(['self', 'parent', 'legal_guardian', 'other']),
  reason_code: z.enum(['subject_request', 'guardian_request', 'practitioner_correction']),
}).strict()

function eventHash(input: z.infer<typeof bodySchema>, practitionerId: string, at: string) {
  return createHash('sha256').update(JSON.stringify({
    event: 'consent_withdrawal',
    clientId: input.client_id,
    practitionerId,
    signerName: input.signer_name,
    signerRelationship: input.signer_relationship,
    reasonCode: input.reason_code,
    at,
  })).digest('hex')
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers: NO_STORE })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid withdrawal request' }, { status: 422, headers: NO_STORE })
  }

  const service = createSupabaseServiceClient()
  const allowed = await enforceRateLimitStrict(service, {
    route: 'consent_withdraw', userId: user.id, limit: 10, windowSeconds: 60,
  })
  if (!allowed) return NextResponse.json({ error: 'Too many requests — try again shortly.' }, { status: 429, headers: NO_STORE })

  const withdrawnAt = new Date().toISOString()
  const { data, error } = await service.rpc('withdraw_client_consent', {
    p_client_id: parsed.data.client_id,
    p_practitioner_id: user.id,
    p_signer_name: parsed.data.signer_name,
    p_signer_relationship: parsed.data.signer_relationship,
    p_reason_code: parsed.data.reason_code,
    p_event_hash: eventHash(parsed.data, user.id, withdrawnAt),
    p_withdrawn_at: withdrawnAt,
  })
  const result = data as { status?: string; shares_revoked?: number } | null
  const logBase = {
    route: ROUTE,
    userHash: hashUser(user.id),
    resourceHash: hashResource(parsed.data.client_id),
  }
  if (error || !result?.status) {
    logEvent({ ...logBase, outcome: 'server_error', status: 500, detailCode: 'withdrawal_rpc_failed' })
    return NextResponse.json({ error: 'Could not record consent withdrawal.' }, { status: 500, headers: NO_STORE })
  }
  if (result.status === 'not_found') return NextResponse.json({ error: 'Client not found' }, { status: 404, headers: NO_STORE })
  if (result.status === 'practitioner_unavailable') return NextResponse.json({ error: 'Access unavailable' }, { status: 403, headers: NO_STORE })
  if (result.status === 'no_consent') return NextResponse.json({ error: 'No consent is available to withdraw.' }, { status: 409, headers: NO_STORE })
  if (result.status === 'invalid_input') return NextResponse.json({ error: 'Invalid withdrawal request' }, { status: 422, headers: NO_STORE })
  if (!['withdrawn', 'already_withdrawn'].includes(result.status)) {
    return NextResponse.json({ error: 'Could not record consent withdrawal.' }, { status: 500, headers: NO_STORE })
  }

  logEvent({ ...logBase, outcome: 'ok', status: 200, detailCode: result.status })
  return NextResponse.json({
    status: result.status,
    shares_revoked: result.shares_revoked ?? 0,
  }, { headers: NO_STORE })
}

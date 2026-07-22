import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { enforceRateLimit, enforceRateLimitStrict } from '@/lib/rate-limit'
import { logEvent, hashResource, hashUser } from '@/lib/log'
import { drainStorageDeletionOutbox } from '@/lib/privacy/storageDeletion'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

interface Params { id: string }
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(_req: NextRequest, { params }: { params: Promise<Params> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  const { data, error } = await supabase
    .from('clients')
    .select('id, first_name, last_name, date_of_birth, sex_at_birth, height_cm, weight_kg, notes, consent_recorded_at, created_at')
    .eq('id', id)
    .eq('practitioner_id', user.id)
    .is('archived_at', null)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    logEvent({
      route: 'GET /api/clients/[id]',
      outcome: 'server_error',
      status: 500,
      userHash: hashUser(user.id),
      resourceHash: hashResource(id),
      detailCode: 'client_load_failed',
    })
    return NextResponse.json({ error: 'Failed to load client.' }, { status: 500, headers: NO_STORE })
  }
  if (!data) return NextResponse.json({ error: 'Client not found' }, { status: 404, headers: NO_STORE })
  return NextResponse.json({ client: data }, { headers: NO_STORE })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<Params> }) {
  const ROUTE = 'PATCH /api/clients/[id]'
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate
  const userHash = hashUser(user.id)

  const service = createSupabaseServiceClient()
  const allowed = await enforceRateLimit(service, { route: 'clients_update', userId: user.id, limit: 30, windowSeconds: 60 })
  if (!allowed) {
    logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429, userHash })
    return NextResponse.json({ error: 'Too many requests — try again shortly' }, { status: 429 })
  }

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty body ok */ }

  const SEX_VALUES = ['male', 'female', 'other', 'prefer_not_to_say']
  const bad = (msg: string) => NextResponse.json({ error: msg }, { status: 400 })

  const updates: Record<string, unknown> = {}

  // archived_at: archive / restore (string ISO timestamp or null)
  if (body.archived_at !== undefined) updates.archived_at = body.archived_at

  // first_name / last_name are NOT NULL — if provided they must be non-empty
  for (const k of ['first_name', 'last_name'] as const) {
    if (body[k] !== undefined) {
      const v = body[k]
      if (typeof v !== 'string' || v.trim() === '') return bad(`${k} must be a non-empty string`)
      updates[k] = v.trim()
    }
  }

  // Nullable text fields (empty string is normalized to null to clear them)
  for (const k of ['date_of_birth', 'notes'] as const) {
    if (body[k] !== undefined) {
      const v = body[k]
      if (v !== null && typeof v !== 'string') return bad(`${k} must be a string or null`)
      updates[k] = v === '' ? null : v
    }
  }

  // sex_at_birth: nullable enum
  if (body.sex_at_birth !== undefined) {
    const v = body.sex_at_birth
    if (v !== null && !(typeof v === 'string' && SEX_VALUES.includes(v))) {
      return bad('sex_at_birth must be one of male, female, other, prefer_not_to_say, or null')
    }
    updates.sex_at_birth = v === '' ? null : v
  }

  // Nullable non-negative numeric measurements
  for (const k of ['height_cm', 'weight_kg'] as const) {
    if (body[k] !== undefined) {
      const v = body[k]
      if (v !== null && !(typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
        return bad(`${k} must be a non-negative number or null`)
      }
      updates[k] = v
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  // Service-role write (authenticated DB writes on regulated tables are revoked).
  // Re-confirm ownership and refuse edits to a tombstoned (erased) client so a
  // PATCH can't repopulate PII after a right-to-erasure deletion.
  const { data: existing } = await service
    .from('clients').select('deleted_at').eq('id', id).eq('practitioner_id', user.id).maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  if (existing.deleted_at) {
    return NextResponse.json({ error: 'This client has been deleted and can no longer be edited.' }, { status: 409 })
  }

  const clientHash = hashResource(id)
  const { data, error } = await service
    .from('clients')
    .update(updates)
    .eq('id', id)
    .eq('practitioner_id', user.id)
    .is('deleted_at', null)
    .select()
    .single()

  if (error) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, resourceHash: clientHash, detailCode: 'client_update_failed' })
    return NextResponse.json({ error: 'Failed to update client.' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  logEvent({ route: ROUTE, outcome: 'ok', status: 200, userHash, resourceHash: clientHash, detailCode: 'client_updated' })
  return NextResponse.json({ client: data })
}

const erasureSchema = z.object({
  reason_code: z.enum([
    'subject_request',
    'guardian_request',
    'duplicate_record',
    'practitioner_correction',
  ]),
}).strict()

// Right-to-erasure has two explicit phases. The database phase is a single RPC
// transaction (redaction, relational purge, receipt, and outbox enqueue). The
// storage phase is retried from the durable outbox and may remain visibly pending
// without rolling back or misrepresenting the completed database erasure.
export async function DELETE(req: NextRequest, { params }: { params: Promise<Params> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate
  const userHash = hashUser(user.id)

  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'A controlled erasure reason is required.' }, { status: 422 })
  }
  const parsed = erasureSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'A controlled erasure reason is required.' }, { status: 422 })
  }

  const service = createSupabaseServiceClient()

  // Erasure is a heavy multi-table purge — rate-limit it so an accidental or
  // malicious burst can't hammer the storage/DB layer.
  const allowed = await enforceRateLimitStrict(service, { route: 'clients_delete', userId: user.id, limit: 10, windowSeconds: 60 })
  if (!allowed) {
    logEvent({ route: 'DELETE /api/clients/[id]', outcome: 'rate_limited', status: 429, userHash })
    return NextResponse.json({ error: 'Too many requests — try again shortly.' }, { status: 429 })
  }

  const erasedAt = new Date().toISOString()
  const { data, error } = await service.rpc('erase_client_transactional', {
    p_client_id: id,
    p_practitioner_id: user.id,
    p_reason_code: parsed.data.reason_code,
    p_erased_at: erasedAt,
  })
  const result = data as {
    status?: string
    receipt_id?: string | null
    assessments_purged?: number
    captures_purged?: number
    storage_objects_enqueued?: number
    external_deletion_status?: 'pending' | 'complete'
  } | null
  if (error || !result?.status) {
    logEvent({ route: 'DELETE /api/clients/[id]', outcome: 'server_error', status: 500, userHash, resourceHash: hashResource(id), detailCode: 'erasure_rpc_failed' })
    return NextResponse.json({ error: 'Could not complete database erasure. No erasure was committed.' }, { status: 500 })
  }
  if (result.status === 'not_found') return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  if (result.status === 'practitioner_unavailable') return NextResponse.json({ error: 'Access unavailable' }, { status: 403 })
  if (result.status === 'invalid_input') return NextResponse.json({ error: 'Invalid erasure request' }, { status: 422 })
  if (!['database_erased', 'already_erased'].includes(result.status)) {
    return NextResponse.json({ error: 'Could not complete database erasure.' }, { status: 500 })
  }

  let externalStatus = result.external_deletion_status ?? 'complete'
  if (externalStatus === 'pending' && result.receipt_id) {
    const drained = await drainStorageDeletionOutbox(service, { receiptId: result.receipt_id })
    // The receipt is the authority. A replay may claim only the final due job
    // while earlier jobs are already complete, so comparing this drain's claim
    // count with the lifetime enqueue count would incorrectly remain pending.
    externalStatus = drained.receiptStatus ?? 'pending'
  }

  logEvent({
    route: 'DELETE /api/clients/[id]',
    outcome: 'ok',
    status: externalStatus === 'complete' ? 200 : 202,
    userHash,
    resourceHash: hashResource(id),
    detailCode: externalStatus === 'complete' ? 'erasure_complete' : 'external_deletion_pending',
  })
  return NextResponse.json({
    ok: true,
    status: result.status === 'already_erased' ? 'already_erased' : 'erased',
    receipt_id: result.receipt_id,
    assessments_purged: result.assessments_purged ?? 0,
    captures_purged: result.captures_purged ?? 0,
    storage_objects_enqueued: result.storage_objects_enqueued ?? 0,
    external_deletion_status: externalStatus,
  }, { status: externalStatus === 'complete' ? 200 : 202 })
}

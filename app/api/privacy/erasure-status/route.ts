import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { enforceRateLimitStrict } from '@/lib/rate-limit'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }
const bodySchema = z.object({ receipt_id: z.string().uuid() }).strict()

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid status request' }, { status: 400, headers: NO_STORE })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid status request' }, { status: 422, headers: NO_STORE })
  }

  const service = createSupabaseServiceClient()
  const allowed = await enforceRateLimitStrict(service, {
    route: 'privacy_erasure_status', userId: user.id, limit: 60, windowSeconds: 60,
  })
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests — try again shortly.' }, { status: 429, headers: NO_STORE })
  }

  const { data, error } = await service
    .from('client_deletion_log')
    .select('external_deletion_status, storage_objects_enqueued, storage_objects_deleted, completed_at')
    .eq('id', parsed.data.receipt_id)
    .eq('practitioner_id', user.id)
    .maybeSingle()
  if (error) {
    return NextResponse.json({ error: 'Could not load erasure status.' }, { status: 500, headers: NO_STORE })
  }
  if (!data) {
    return NextResponse.json({ error: 'Erasure receipt not found' }, { status: 404, headers: NO_STORE })
  }

  return NextResponse.json({
    external_deletion_status: data.external_deletion_status === 'complete' ? 'complete' : 'pending',
    storage_objects_enqueued: data.storage_objects_enqueued,
    storage_objects_deleted: data.storage_objects_deleted,
    completed_at: data.completed_at,
  }, { headers: NO_STORE })
}

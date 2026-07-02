import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { logEvent, hashUser } from '@/lib/log'
import { buildRunUpdate, type RunRow } from '@/lib/workout/runState'

const ROUTE = 'PATCH /api/workouts/[id]/run'

const runItemSchema = z.object({
  slug: z.string().min(1),
  completed: z.boolean(),
  skipped: z.boolean(),
  durationMs: z.number().int().min(0).optional(),
}).strict()

const bodySchema = z.object({
  status: z.enum(['started', 'in_progress', 'paused', 'completed', 'abandoned']).optional(),
  current_item_index: z.number().int().min(0).optional(),
  items: z.array(runItemSchema).optional(),
  total_duration_ms: z.number().int().min(0).optional(),
  revision: z.number().int().min(0).optional(),
}).strict()

/**
 * Persist playback/resume state for a session's run. Idempotent and guarded (see
 * buildRunUpdate): completion never regresses, 'completed' is terminal, duration
 * is monotonic — so out-of-order or duplicate writes from a reconnecting client
 * can't corrupt the run. Authenticated + practitioner-scoped; the run seeded at
 * mint is the row updated.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate
  const userHash = hashUser(user.id)

  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }

  let raw: unknown
  try { raw = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: `Invalid payload: ${parsed.error.issues[0]?.message ?? 'malformed'}` }, { status: 422 })
  }

  const service = createSupabaseServiceClient()

  // The run seeded at mint (scoped to this practitioner — service-role bypasses
  // RLS, so the practitioner_id filter is the authorization boundary).
  const { data: existing } = await service
    .from('session_runs')
    .select('id, status, current_item_index, items, total_duration_ms, last_paused_at, completed_at, revision')
    .eq('workout_session_id', id)
    .eq('practitioner_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!existing) {
    return NextResponse.json({ error: 'Session run not found' }, { status: 404 })
  }

  const update = buildRunUpdate(existing as RunRow, parsed.data, new Date().toISOString())
  if (!update) {
    // Stale/duplicate revision — already superseded by a newer write. Not an error.
    return NextResponse.json({ ok: true, stale: true })
  }

  const { error } = await service.from('session_runs').update(update).eq('id', existing.id)
  if (error) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, detail: error.message })
    return NextResponse.json({ error: 'Failed to save progress.' }, { status: 500 })
  }

  logEvent({ route: ROUTE, outcome: 'ok', status: 200, userHash })
  return NextResponse.json({ ok: true })
}

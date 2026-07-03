import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { logEvent, hashUser } from '@/lib/log'
import { validateRating } from '@/lib/workout/rating'

const ROUTE = 'POST /api/workouts/[id]/rate'

/**
 * Record a movement-education rating for a session's run (in-clinic, authenticated
 * path — free-text notes allowed but screening-lint-checked). No symptom/outcome
 * capture: validateRating enforces the education-only field set.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const rating = validateRating(raw, { allowNotes: true })
  if (!rating.ok) {
    return NextResponse.json({ error: rating.error }, { status: 422 })
  }

  const service = createSupabaseServiceClient()

  const { data: session } = await service
    .from('workout_sessions')
    .select('id, client_id')
    .eq('id', id)
    .eq('practitioner_id', user.id)
    .maybeSingle()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const { data: run } = await service
    .from('session_runs')
    .select('id')
    .eq('workout_session_id', id)
    .eq('practitioner_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!run) return NextResponse.json({ error: 'Session run not found' }, { status: 404 })

  // One rating per run (unique index): a retry or re-submit updates in place
  // instead of accumulating duplicate rows.
  const { error } = await service.from('workout_ratings').upsert({
    session_run_id: run.id,
    workout_session_id: id,
    client_id: session.client_id,
    practitioner_id: user.id,
    clarity: rating.value.clarity ?? null,
    pace: rating.value.pace ?? null,
    difficulty: rating.value.difficulty ?? null,
    feedback_tags: rating.value.feedback_tags,
    notes: rating.value.notes ?? null,
  }, { onConflict: 'session_run_id' })
  if (error) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, detail: error.message })
    return NextResponse.json({ error: 'Failed to save rating.' }, { status: 500 })
  }

  logEvent({ route: ROUTE, outcome: 'ok', status: 200, userHash })
  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logEvent, hashIp } from '@/lib/log'
import { hashShareToken } from '@/lib/workout/token'
import { validateRating } from '@/lib/workout/rating'
import type { ResolvedSession } from '@/lib/workout/tokenProjection'

const ROUTE = 'POST /api/workouts/token/[token]/rate'

/**
 * Public, token-scoped rating from the follow-along client. NO free-text notes on
 * this path (allowNotes: false) — only clarity/pace/difficulty/tags. The token
 * resolves via the same single-reader RPC (all gates enforced); the rating
 * attaches to the run seeded at mint.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const service = createSupabaseServiceClient()
  const ipHash = hashIp(req.headers.get('x-forwarded-for'))

  const allowed = await enforceRateLimit(service, { route: 'workouts_token_rate', userId: ipHash ?? 'anon', limit: 10, windowSeconds: 60 })
  if (!allowed) {
    logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429 })
    return NextResponse.json({ error: 'Too many requests — try again shortly.' }, { status: 429 })
  }

  let raw: unknown
  try { raw = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const rating = validateRating(raw, { allowNotes: false })
  if (!rating.ok) {
    return NextResponse.json({ error: rating.error }, { status: 422 })
  }

  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'This session link is not available.' }, { status: 404 })
  }

  const { data, error } = await service.rpc('resolve_workout_token', { p_token_hash: hashShareToken(token) })
  if (error) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, detail: error.message })
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
  const resolved = (Array.isArray(data) ? data[0] : data) as ResolvedSession | undefined
  if (!resolved || !resolved.session_run_id) {
    logEvent({ route: ROUTE, outcome: 'client_error', status: 404 })
    return NextResponse.json({ error: 'This session link is not available.' }, { status: 404 })
  }

  const { error: insErr } = await service.from('workout_ratings').insert({
    session_run_id: resolved.session_run_id,
    workout_session_id: resolved.workout_session_id,
    client_id: resolved.client_id,
    practitioner_id: resolved.practitioner_id,
    clarity: rating.value.clarity ?? null,
    pace: rating.value.pace ?? null,
    difficulty: rating.value.difficulty ?? null,
    feedback_tags: rating.value.feedback_tags,
    notes: null,
  })
  if (insErr) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, detail: insErr.message })
    return NextResponse.json({ error: 'Failed to save rating.' }, { status: 500 })
  }

  logEvent({ route: ROUTE, outcome: 'ok', status: 200 })
  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logEvent, hashIp } from '@/lib/log'
import { hashShareToken } from '@/lib/workout/token'
import { validateRating } from '@/lib/workout/rating'
import type { ResolvedSession } from '@/lib/workout/tokenProjection'
import { clinicalContentAccess } from '@/lib/clinical-content/runtime'
import { verifyClinicalContentAccess } from '@/lib/clinical-content/database'
import { clinicalContentUnavailableResponse } from '@/lib/clinical-content/http'

const ROUTE = 'POST /api/workouts/token/[token]/rate'

/**
 * Public, token-scoped rating from the follow-along client. NO free-text notes on
 * this path (allowNotes: false) — only clarity/pace/difficulty/tags. The token
 * resolves via the same single-reader RPC (all gates enforced); the rating
 * attaches to the run seeded at mint.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const service = createSupabaseServiceClient()
  const clinicalAccess = await verifyClinicalContentAccess(clinicalContentAccess(), service)
  if (!clinicalAccess.surfaces.workouts) return clinicalContentUnavailableResponse(true)
  const { token } = await params
  const ipHash = hashIp(req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for'))

  const allowed = await enforceRateLimit(service, { route: 'workouts_token_rate', userId: ipHash ?? 'anon', limit: 10, windowSeconds: 60 })
  if (!allowed) {
    logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429 })
    return NextResponse.json({ error: 'Too many requests — try again shortly.' }, { status: 429 })
  }

  // Cheapest check first — a blank/short token can't match a 256-bit hash, so
  // reject before spending work on body parsing/validation.
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'This session link is not available.' }, { status: 404 })
  }

  let raw: unknown
  try { raw = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const rating = validateRating(raw, { allowNotes: false })
  if (!rating.ok) {
    return NextResponse.json({ error: rating.error }, { status: 422 })
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

  // One rating per run (unique index): a retry or re-submit updates in place
  // instead of accumulating duplicate rows.
  const { error: insErr } = await service.from('workout_ratings').upsert({
    session_run_id: resolved.session_run_id,
    workout_session_id: resolved.workout_session_id,
    client_id: resolved.client_id,
    practitioner_id: resolved.practitioner_id,
    clarity: rating.value.clarity ?? null,
    pace: rating.value.pace ?? null,
    difficulty: rating.value.difficulty ?? null,
    feedback_tags: rating.value.feedback_tags,
    notes: null,
  }, { onConflict: 'session_run_id' })
  if (insErr) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, detail: insErr.message })
    return NextResponse.json({ error: 'Failed to save rating.' }, { status: 500 })
  }

  logEvent({ route: ROUTE, outcome: 'ok', status: 200 })
  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logEvent, hashIp } from '@/lib/log'
import { hashShareToken } from '@/lib/workout/token'
import { redactSessionForPublic, type ResolvedSession } from '@/lib/workout/tokenProjection'

const ROUTE = 'GET /api/workouts/token/[token]'

/**
 * Public share-link hydration for the follow-along player. No auth cookie — the
 * hashed token is the credential, and resolve_workout_token() (the single reader)
 * enforces every gate (expiry / revocation / approval / tombstone) and returns a
 * redacted projection. A missing/expired/revoked/unapproved link returns a
 * UNIFORM 404 so the endpoint is not an existence oracle. Every successful access
 * appends an audit row (workout_share_events) so the PHI link is accountable.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const service = createSupabaseServiceClient()
  const ipHash = hashIp(req.headers.get('x-forwarded-for'))

  const allowed = await enforceRateLimit(service, { route: 'workouts_token', userId: ipHash ?? 'anon', limit: 30, windowSeconds: 60 })
  if (!allowed) {
    logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429 })
    return NextResponse.json({ error: 'Too many requests — try again shortly.' }, { status: 429 })
  }

  // A blank/short token can't match a 256-bit hash — reject before the DB round-trip.
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'This session link is not available.' }, { status: 404 })
  }

  const { data, error } = await service.rpc('resolve_workout_token', { p_token_hash: hashShareToken(token) })
  if (error) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, detail: error.message })
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
  const resolved = (Array.isArray(data) ? data[0] : data) as ResolvedSession | undefined
  if (!resolved) {
    logEvent({ route: ROUTE, outcome: 'client_error', status: 404 })
    return NextResponse.json({ error: 'This session link is not available.' }, { status: 404 })
  }

  // Best-effort audit — never block the client on the write.
  await service.from('workout_share_events').insert({
    workout_session_id: resolved.workout_session_id,
    practitioner_id: resolved.practitioner_id,
    event: 'accessed',
    actor: 'client',
    ip_hash: ipHash,
  })

  logEvent({ route: ROUTE, outcome: 'ok', status: 200 })
  return NextResponse.json(redactSessionForPublic(resolved))
}

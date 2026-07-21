import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logEvent, hashIp } from '@/lib/log'
import { hashShareToken } from '@/lib/workout/token'
import { redactSessionForPublic, type ResolvedSession } from '@/lib/workout/tokenProjection'

const ROUTE = 'GET /api/workouts/token/[token]'

// This is a public bearer-token endpoint returning PHI-adjacent content: no
// shared or browser cache may retain a response past revocation/expiry.
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' }

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
  // x-real-ip is platform-managed (non-spoofable on Vercel); rightmost XFF hop
  // is the fallback — see hashIp.
  const ipHash = hashIp(req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for'))

  const allowed = await enforceRateLimit(service, { route: 'workouts_token', userId: ipHash ?? 'anon', limit: 30, windowSeconds: 60 })
  if (!allowed) {
    logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429 })
    return NextResponse.json({ error: 'Too many requests — try again shortly.' }, { status: 429, headers: NO_STORE })
  }

  // A blank/short token can't match a 256-bit hash — reject before the DB round-trip.
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'This session link is not available.' }, { status: 404, headers: NO_STORE })
  }

  const { data, error } = await service.rpc('resolve_workout_token', { p_token_hash: hashShareToken(token) })
  if (error) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, detail: error.message })
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500, headers: NO_STORE })
  }
  const resolved = (Array.isArray(data) ? data[0] : data) as ResolvedSession | undefined
  if (!resolved) {
    logEvent({ route: ROUTE, outcome: 'client_error', status: 404 })
    return NextResponse.json({ error: 'This session link is not available.' }, { status: 404, headers: NO_STORE })
  }

  const publicSession = redactSessionForPublic(resolved)
  if (!publicSession) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, detail: 'workout legal provenance mismatch' })
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500, headers: NO_STORE })
  }

  // Do not release the client-safe projection until its access event is durable.
  // A retry can safely create a fresh access event after a transient failure.
  const { error: auditError } = await service.from('workout_share_events').insert({
    workout_session_id: resolved.workout_session_id,
    practitioner_id: resolved.practitioner_id,
    event: 'accessed',
    actor: null,
    actor_code: 'client',
    ip_hash: ipHash,
    reason_code: null,
    operation_id: randomUUID(),
    share_generation: resolved.share_generation ?? 1,
  })
  if (auditError) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, detailCode: 'share_access_audit_failed' })
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500, headers: NO_STORE })
  }

  logEvent({ route: ROUTE, outcome: 'ok', status: 200 })
  return NextResponse.json(publicSession, { headers: NO_STORE })
}

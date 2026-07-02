import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logEvent, hashUser, hashIp } from '@/lib/log'
import { buildSessionFromAssessment } from '@/lib/workout/buildSessionFromAssessment'
import type { StoredFinding } from '@/lib/findings/storedFindingToEngine'
import { generateShareToken } from '@/lib/workout/token'

const ROUTE = 'POST /api/workouts'
const SHARE_TTL_DAYS = 7

const bodySchema = z.object({
  assessment_id: z.string().uuid(),
  week: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  share: z.boolean().optional(),
}).strict()

/**
 * Mint a guided workout session from an APPROVED assessment. The frozen
 * program_snapshot is generated once here (anti-drift); a later coach swap mints
 * a new session, never mutating this one. When `share` is set, a hashed,
 * expiring share token is created so the client can follow the workout via a
 * no-login link (the raw token is returned once and never stored).
 */
export async function POST(req: NextRequest) {
  const started = Date.now()
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate
  const userHash = hashUser(user.id)

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: `Invalid payload: ${parsed.error.issues[0]?.message ?? 'malformed'}` }, { status: 422 })
  }
  const { assessment_id, week = 1, share = false } = parsed.data

  const service = createSupabaseServiceClient()

  const allowed = await enforceRateLimit(service, { route: 'workouts', userId: user.id, limit: 10, windowSeconds: 60 })
  if (!allowed) {
    logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429, userHash })
    return NextResponse.json({ error: 'Too many requests — try again shortly' }, { status: 429 })
  }

  // Assessment must belong to this practitioner and be approved (human-in-the-loop
  // gate — a session can't be minted from an unreviewed screening).
  const { data: assessment } = await service
    .from('assessments')
    .select('id, client_id, overall_grade, capability, priority_keys, exercise_swaps, practitioner_approved')
    .eq('id', assessment_id)
    .eq('practitioner_id', user.id)
    .maybeSingle()
  if (!assessment) return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
  if (!assessment.practitioner_approved) {
    logEvent({ route: ROUTE, outcome: 'client_error', status: 403, userHash, detail: 'not approved' })
    return NextResponse.json({ error: 'Approve the assessment before launching a session.' }, { status: 403 })
  }

  const { data: findings } = await service
    .from('assessment_findings')
    .select('imbalance_key, label, region, deviation, direction, severity_pct, zone, view_used, confidence')
    .eq('assessment_id', assessment_id)

  const snapshot = buildSessionFromAssessment(assessment, (findings ?? []) as StoredFinding[], week)
  if (!snapshot) {
    // Empty-session floor — nothing reliable to build a workout from.
    logEvent({ route: ROUTE, outcome: 'client_error', status: 422, userHash, detail: 'no playable session' })
    return NextResponse.json({ error: 'This screening has no reliable findings to build a workout from — re-capture and try again.' }, { status: 422 })
  }

  const shareToken = share ? generateShareToken() : null
  const expiresAt = share ? new Date(Date.now() + SHARE_TTL_DAYS * 86_400_000).toISOString() : null

  const { data: session, error: insertErr } = await service
    .from('workout_sessions')
    .insert({
      assessment_id,
      client_id: assessment.client_id,
      practitioner_id: user.id,
      week,
      capability: snapshot.capability,
      program_snapshot: snapshot,
      estimated_duration_sec: snapshot.estimatedDurationSec,
      session_token_hash: shareToken?.tokenHash ?? null,
      expires_at: expiresAt,
    })
    .select('id')
    .single()
  if (insertErr || !session) {
    // The workout_sessions_reject_deleted_client trigger raises here if the
    // client was tombstoned — surface a clean 409 rather than a 500.
    const tombstoned = /deleted client/i.test(insertErr?.message ?? '')
    logEvent({ route: ROUTE, outcome: 'server_error', status: tombstoned ? 409 : 500, userHash, detail: insertErr?.message })
    return NextResponse.json(
      { error: tombstoned ? 'Client has been deleted.' : 'Failed to create session.' },
      { status: tombstoned ? 409 : 500 },
    )
  }

  // Start a run so playback state has a row to update immediately.
  await service.from('session_runs').insert({
    workout_session_id: session.id,
    practitioner_id: user.id,
    status: 'started',
  })

  let shareLink: string | undefined
  if (shareToken) {
    // Prefer a configured canonical origin — the request Host header is
    // caller-influenced, and a share link must never point off-site.
    const origin = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/+$/, '')
    shareLink = `${origin}/s/${shareToken.token}`
    await service.from('workout_share_events').insert({
      workout_session_id: session.id,
      practitioner_id: user.id,
      event: 'minted',
      actor: 'practitioner',
      ip_hash: hashIp(req.headers.get('x-forwarded-for')),
    })
  }

  logEvent({ route: ROUTE, outcome: 'ok', status: 200, userHash, assessmentId: assessment_id, durationMs: Date.now() - started })
  return NextResponse.json({ session_id: session.id, share_link: shareLink })
}

import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { hashResource, hashUser, logEvent } from '@/lib/log'
import { enforceRateLimitStrict } from '@/lib/rate-limit'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { generateShareToken } from '@/lib/workout/token'
import { clinicalContentAccess } from '@/lib/clinical-content/runtime'
import { verifyClinicalContentAccess } from '@/lib/clinical-content/database'
import { clinicalContentUnavailableResponse } from '@/lib/clinical-content/http'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }
const SHARE_TTL_DAYS = 7
const SHARE_PAGE_SIZE = 50
const sessionSchema = z.object({ session_id: z.string().uuid() }).strict()

async function authenticated(): Promise<
  | { ok: false; response: NextResponse }
  | { ok: true; user: { id: string } }
> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE }) }
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return { ok: false, response: gate }
  return { ok: true, user }
}

async function parsedSession(req: NextRequest) {
  let body: unknown
  try { body = await req.json() } catch { return null }
  const parsed = sessionSchema.safeParse(body)
  return parsed.success ? parsed.data : null
}

export async function GET(req: NextRequest) {
  const auth = await authenticated()
  if (!auth.ok) return auth.response
  const clientId = req.nextUrl.searchParams.get('client_id')
  if (!clientId || !z.string().uuid().safeParse(clientId).success) {
    return NextResponse.json({ error: 'Invalid client id' }, { status: 400, headers: NO_STORE })
  }
  const cursorValue = req.nextUrl.searchParams.get('cursor') ?? '0'
  if (!/^\d+$/.test(cursorValue)) {
    return NextResponse.json({ error: 'Invalid cursor' }, { status: 400, headers: NO_STORE })
  }
  const cursor = Number(cursorValue)
  if (!Number.isSafeInteger(cursor) || cursor > 100_000) {
    return NextResponse.json({ error: 'Invalid cursor' }, { status: 400, headers: NO_STORE })
  }
  const service = createSupabaseServiceClient()
  const clinicalAccess = await verifyClinicalContentAccess(clinicalContentAccess(), service)
  const allowed = await enforceRateLimitStrict(service, {
    route: 'workout_share_inventory', userId: auth.user.id, limit: 60, windowSeconds: 60,
  })
  if (!allowed) return NextResponse.json({ error: 'Too many requests — try again shortly.' }, { status: 429, headers: NO_STORE })
  const { data, error } = await service
    .from('workout_sessions')
    .select('id, assessment_id, created_at, expires_at, revoked_at, status, session_token_hash, share_generation')
    .eq('client_id', clientId)
    .eq('practitioner_id', auth.user.id)
    .or('session_token_hash.not.is.null,revoked_at.not.is.null')
    .order('created_at', { ascending: false })
    .range(cursor, cursor + SHARE_PAGE_SIZE)
  if (error) return NextResponse.json({ error: 'Could not load share links.' }, { status: 500, headers: NO_STORE })

  const now = Date.now()
  const rows = data ?? []
  const shares = rows.slice(0, SHARE_PAGE_SIZE).map((row) => {
    const live = row.status === 'active' && row.session_token_hash && !row.revoked_at
      && row.expires_at && Date.parse(row.expires_at) > now
    const state = live ? 'active'
      : row.revoked_at ? 'revoked'
        : row.expires_at && Date.parse(row.expires_at) <= now ? 'expired'
          : 'inactive'
    return {
      session_id: row.id,
      assessment_id: row.assessment_id,
      created_at: row.created_at,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at,
      share_generation: row.share_generation,
      state,
    }
  })
  return NextResponse.json({
    shares,
    next_cursor: rows.length > SHARE_PAGE_SIZE ? cursor + SHARE_PAGE_SIZE : null,
    // Inventory and revocation remain available in assessment-only releases so
    // practitioners can shut down old links. Rotation is a clinical-workout
    // action and must fail closed in the UI as well as in POST below.
    rotation_enabled: clinicalAccess.surfaces.workouts,
  }, { headers: NO_STORE })
}

export async function POST(req: NextRequest) {
  const auth = await authenticated()
  if (!auth.ok) return auth.response
  const service = createSupabaseServiceClient()
  const clinicalAccess = await verifyClinicalContentAccess(clinicalContentAccess(), service)
  if (!clinicalAccess.surfaces.workouts) return clinicalContentUnavailableResponse()
  const body = await parsedSession(req)
  if (!body) return NextResponse.json({ error: 'Invalid share request' }, { status: 422, headers: NO_STORE })
  const allowed = await enforceRateLimitStrict(service, { route: 'workout_share_rotate', userId: auth.user.id, limit: 20, windowSeconds: 60 })
  if (!allowed) return NextResponse.json({ error: 'Too many requests — try again shortly.' }, { status: 429, headers: NO_STORE })

  const token = generateShareToken()
  const rotatedAt = new Date()
  const expiresAt = new Date(rotatedAt.getTime() + SHARE_TTL_DAYS * 86_400_000)
  const { data, error } = await service.rpc('rotate_workout_share', {
    p_session_id: body.session_id,
    p_practitioner_id: auth.user.id,
    p_new_token_hash: token.tokenHash,
    p_new_expires_at: expiresAt.toISOString(),
    p_operation_id: randomUUID(),
    p_rotated_at: rotatedAt.toISOString(),
  })
  const result = data as { status?: string; share_generation?: number } | null
  if (error || !result?.status) return NextResponse.json({ error: 'Could not rotate share link.' }, { status: 500, headers: NO_STORE })
  if (result.status === 'not_found') return NextResponse.json({ error: 'Share not found' }, { status: 404, headers: NO_STORE })
  if (result.status === 'consent_unavailable') return NextResponse.json({ error: 'Subject consent is no longer active.' }, { status: 409, headers: NO_STORE })
  if (result.status === 'not_rotatable') return NextResponse.json({ error: 'Only an active share link can be rotated.' }, { status: 409, headers: NO_STORE })
  if (result.status !== 'rotated') return NextResponse.json({ error: 'Could not rotate share link.' }, { status: 422, headers: NO_STORE })

  logEvent({ route: 'POST /api/workouts/shares', outcome: 'ok', status: 200, userHash: hashUser(auth.user.id), resourceHash: hashResource(body.session_id), detailCode: 'rotated' })
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/+$/, '')
  return NextResponse.json({
    status: 'rotated',
    share_link: `${origin}/s/${token.token}`,
    share_generation: result.share_generation,
  }, { headers: NO_STORE })
}

export async function DELETE(req: NextRequest) {
  const auth = await authenticated()
  if (!auth.ok) return auth.response
  const body = await parsedSession(req)
  if (!body) return NextResponse.json({ error: 'Invalid share request' }, { status: 422, headers: NO_STORE })
  const service = createSupabaseServiceClient()
  const allowed = await enforceRateLimitStrict(service, { route: 'workout_share_revoke', userId: auth.user.id, limit: 20, windowSeconds: 60 })
  if (!allowed) return NextResponse.json({ error: 'Too many requests — try again shortly.' }, { status: 429, headers: NO_STORE })

  const { data, error } = await service.rpc('revoke_workout_share', {
    p_session_id: body.session_id,
    p_practitioner_id: auth.user.id,
    p_reason_code: 'practitioner_action',
    p_operation_id: randomUUID(),
    p_revoked_at: new Date().toISOString(),
  })
  const result = data as { status?: string } | null
  if (error || !result?.status) return NextResponse.json({ error: 'Could not revoke share link.' }, { status: 500, headers: NO_STORE })
  if (result.status === 'not_found') return NextResponse.json({ error: 'Share not found' }, { status: 404, headers: NO_STORE })
  if (!['revoked', 'already_revoked'].includes(result.status)) {
    return NextResponse.json({ error: 'Could not revoke share link.' }, { status: 422, headers: NO_STORE })
  }
  logEvent({ route: 'DELETE /api/workouts/shares', outcome: 'ok', status: 200, userHash: hashUser(auth.user.id), resourceHash: hashResource(body.session_id), detailCode: result.status })
  return NextResponse.json({ status: result.status }, { headers: NO_STORE })
}

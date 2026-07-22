import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logEvent, hashUser, hashIp } from '@/lib/log'
import { buildSessionFromAssessment } from '@/lib/workout/buildSessionFromAssessment'
import type { StoredFinding } from '@/lib/findings/storedFindingToEngine'
import { generateShareToken } from '@/lib/workout/token'
import { governSessionSnapshot } from '@/lib/workout/generateWorkoutSession'
import { resolveRuntimeLegalDocument } from '@/lib/legal/runtime'
import { snapshotLegalDocument } from '@/lib/legal/policy'
import { clinicalContentAccess } from '@/lib/clinical-content/runtime'
import { verifyClinicalContentAccess } from '@/lib/clinical-content/database'
import { clinicalContentUnavailableResponse } from '@/lib/clinical-content/http'

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
  const clinicalAccess = await verifyClinicalContentAccess(clinicalContentAccess(), supabase)
  if (!clinicalAccess.surfaces.workouts) return clinicalContentUnavailableResponse()
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

  // A workout snapshot is a new shareable artifact. Resolve the applicable
  // notice before generating or persisting anything so an ungoverned workout
  // can never be minted in production.
  const legalResolution = resolveRuntimeLegalDocument({ kind: 'screening_notice' })
  if (!legalResolution.ok) {
    return NextResponse.json(
      { error: 'The screening notice is unavailable.', code: 'legal_unavailable' },
      { status: 503 },
    )
  }
  const legalNotice = snapshotLegalDocument(legalResolution.document)

  const { data: findings, error: findingsErr } = await service
    .from('assessment_findings')
    .select('imbalance_key, label, region, deviation, direction, severity_pct, zone, view_used, confidence')
    .eq('assessment_id', assessment_id)
  if (findingsErr) {
    // A failed read must not masquerade as "no reliable findings" (422) below.
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, detail: findingsErr.message })
    return NextResponse.json({ error: 'Failed to load findings.' }, { status: 500 })
  }

  const draftSnapshot = buildSessionFromAssessment(
    assessment,
    (findings ?? []) as StoredFinding[],
    week,
    {
      approvedExerciseSlugs: clinicalAccess.approvedExerciseSlugs,
      approvedLinkIds: clinicalAccess.approvedLinkIds,
      approvedReportCopyIds: clinicalAccess.approvedReportCopyIds,
    },
  )
  if (!draftSnapshot) {
    // Empty-session floor — nothing reliable to build a workout from.
    logEvent({ route: ROUTE, outcome: 'client_error', status: 422, userHash, detail: 'no playable session' })
    return NextResponse.json({ error: 'This screening has no reliable findings to build a workout from — re-capture and try again.' }, { status: 422 })
  }
  const snapshot = governSessionSnapshot(draftSnapshot, legalNotice, {
    version: clinicalAccess.contentVersion!,
    inventorySha256: clinicalAccess.inventorySha256,
  })

  const shareToken = share ? generateShareToken() : null
  const expiresAt = share ? new Date(Date.now() + SHARE_TTL_DAYS * 86_400_000).toISOString() : null

  const { data: created, error: createError } = await service.rpc('create_workout_session_clinical_governed', {
    p_assessment_id: assessment_id,
    p_client_id: assessment.client_id,
    p_practitioner_id: user.id,
    p_week: week,
    p_capability: snapshot.capability,
    p_program_snapshot: snapshot,
    p_estimated_duration_sec: snapshot.estimatedDurationSec,
    p_token_hash: shareToken?.tokenHash ?? null,
    p_expires_at: expiresAt,
    p_operation_id: randomUUID(),
    p_ip_hash: hashIp(req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')),
    p_document_id: legalNotice.documentId,
    p_document_version: legalNotice.version,
    p_document_body_sha256: legalNotice.bodySha256,
    p_document_effective_at: legalNotice.effectiveAt,
    p_jurisdiction: legalNotice.jurisdiction,
    p_product_scope: legalNotice.productScope,
    p_clinical_content_version: clinicalAccess.contentVersion,
    p_clinical_inventory_sha256: clinicalAccess.inventorySha256,
  })
  const createResult = created as { status?: string; session_id?: string } | null
  if (createError || !createResult?.status) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, detailCode: 'session_transaction_failed' })
    return NextResponse.json({ error: 'Failed to create session.' }, { status: 500 })
  }
  if (createResult.status === 'not_found') {
    return NextResponse.json({ error: 'Assessment or client is no longer available.' }, { status: 409 })
  }
  if (createResult.status === 'consent_unavailable') {
    return NextResponse.json({ error: 'Subject consent is no longer active.' }, { status: 409 })
  }
  if (createResult.status === 'clinical_content_unavailable') {
    return clinicalContentUnavailableResponse()
  }
  if (createResult.status !== 'created' || !createResult.session_id) {
    return NextResponse.json({ error: 'Failed to create session.' }, { status: 422 })
  }

  let shareLink: string | undefined
  if (shareToken) {
    // Prefer a configured canonical origin — the request Host header is
    // caller-influenced, and a share link must never point off-site.
    const origin = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/+$/, '')
    shareLink = `${origin}/s/${shareToken.token}`
  }

  logEvent({ route: ROUTE, outcome: 'ok', status: 200, userHash, assessmentId: assessment_id, durationMs: Date.now() - started })
  return NextResponse.json({ session_id: createResult.session_id, share_link: shareLink })
}

/**
 * Practitioner-facing list of a client's guided-session runs for one assessment,
 * including whether the pre-session red-flag pain check was recorded. Read-only,
 * authenticated + practitioner-scoped (service-role bypasses RLS, so the
 * practitioner_id filter is the authorization boundary).
 */
export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate
  const clinicalAccess = await verifyClinicalContentAccess(clinicalContentAccess(), supabase)
  if (!clinicalAccess.surfaces.workouts) return clinicalContentUnavailableResponse()

  const assessmentId = req.nextUrl.searchParams.get('assessment_id')
  if (!assessmentId || !z.string().uuid().safeParse(assessmentId).success) {
    return NextResponse.json({ error: 'Invalid assessment id' }, { status: 400 })
  }

  const service = createSupabaseServiceClient()
  const { data, error } = await service
    .from('workout_sessions')
    .select('id, created_at, session_runs(status, red_flag_acknowledged, completed_at)')
    .eq('assessment_id', assessmentId)
    .eq('practitioner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return NextResponse.json({ error: 'Failed to load runs.' }, { status: 500 })

  const runs = (data ?? []).flatMap((s) =>
    (s.session_runs ?? []).map((r) => ({
      session_id: s.id,
      created_at: s.created_at,
      status: r.status,
      red_flag_acknowledged: r.red_flag_acknowledged,
      completed_at: r.completed_at,
    })),
  )
  return NextResponse.json({ runs })
}

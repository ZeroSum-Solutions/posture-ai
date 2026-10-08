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
import { serverClinicalContentAccessForPractitioner } from '@/lib/clinical-content/database'
import { clinicalContentUnavailableResponse } from '@/lib/clinical-content/http'
import {
  SCREENING_CAPTURE_SELECT,
  screenFindingsForDerivedUse,
} from '@/lib/training/screening/derivedUse'
import type {
  PersistedScreeningAssessmentRow,
  PersistedScreeningCaptureRow,
  PersistedScreeningFindingRow,
} from '@/lib/training/screening/screeningContext'
import {
  DEFAULT_WORKOUT_PREFERENCES,
  personalizeWorkout,
  workoutPreferencesSchema,
  WORKOUT_GOALS,
} from '@/lib/workout/personalize'
import { operationForPractitioner } from '@/lib/prototype/runtime'
import { mintPrototypeSessionSnapshot } from '@/lib/workout/operationSnapshot'

const ROUTE = 'POST /api/workouts'
const SHARE_TTL_DAYS = 7

const bodySchema = z.object({
  assessment_id: z.string().uuid(),
  week: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  share: z.boolean().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  preferences: workoutPreferencesSchema.optional(),
  selected_slugs: z.array(z.string().min(1).max(90)).min(1).max(40).optional(),
  generation_source: z.enum(['scan', 'ai']).optional(),
}).strict().superRefine((value, context) => {
  const personalized = value.name !== undefined
    || value.preferences !== undefined
    || value.selected_slugs !== undefined
    || value.generation_source !== undefined
  if (!personalized) return
  if (!value.name || !value.preferences || !value.selected_slugs || !value.generation_source) {
    context.addIssue({
      code: 'custom',
      message: 'Personalized workouts require a name, preferences, selected exercises, and source.',
    })
  }
})

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
  const operation = operationForPractitioner(user.id)
  const clinicalAccess = await serverClinicalContentAccessForPractitioner(user.id)
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
  const {
    assessment_id,
    week = 1,
    share = false,
    name,
    preferences,
    selected_slugs: selectedSlugs,
    generation_source: generationSource,
  } = parsed.data
  if (operation.isPrototype && share) {
    return NextResponse.json({ error: 'Prototype workouts are available in clinic only.' }, { status: 422 })
  }

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
    .select('id, client_id, practitioner_id, assessed_at, status, assessment_type, scoring_engine_version, level_verified, capture_stability, overall_grade, capability, priority_keys, exercise_swaps, practitioner_approved')
    .eq('id', assessment_id)
    .eq('practitioner_id', user.id)
    .maybeSingle()
  if (!assessment) return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
  const { data: client } = await service
    .from('clients')
    .select('id')
    .eq('id', assessment.client_id)
    .eq('practitioner_id', user.id)
    .is('deleted_at', null)
    .is('archived_at', null)
    .maybeSingle()
  if (!client) return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
  if (assessment.status !== 'complete') {
    logEvent({ route: ROUTE, outcome: 'client_error', status: 409, userHash, detail: 'assessment incomplete' })
    return NextResponse.json({ error: 'Assessment analysis is not complete.' }, { status: 409 })
  }
  if (!assessment.practitioner_approved) {
    logEvent({ route: ROUTE, outcome: 'client_error', status: 403, userHash, detail: 'not approved' })
    return NextResponse.json({ error: 'Approve the assessment before launching a session.' }, { status: 403 })
  }

  let legalNotice: ReturnType<typeof snapshotLegalDocument> | null = null
  if (!operation.isPrototype) {
    // Governed snapshots must bind the active notice before content is built.
    const legalResolution = resolveRuntimeLegalDocument({ kind: 'screening_notice' })
    if (!legalResolution.ok) {
      return NextResponse.json(
        { error: 'The screening notice is unavailable.', code: 'legal_unavailable' },
        { status: 503 },
      )
    }
    legalNotice = snapshotLegalDocument(legalResolution.document)
  }

  const { data: findings, error: findingsErr } = await service
    .from('assessment_findings')
    .select('*')
    .eq('assessment_id', assessment_id)
  if (findingsErr) {
    // A failed read must not masquerade as "no reliable findings" (422) below.
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, detail: findingsErr.message })
    return NextResponse.json({ error: 'Failed to load findings.' }, { status: 500 })
  }

  const { data: captures, error: capturesErr } = await service
    .from('captures')
    .select(SCREENING_CAPTURE_SELECT)
    .eq('assessment_id', assessment_id)
  if (capturesErr) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, detail: capturesErr.message })
    return NextResponse.json({ error: 'Failed to load captures.' }, { status: 500 })
  }

  const screened = screenFindingsForDerivedUse({
    expectedSubjectId: assessment.client_id,
    assessment: assessment as PersistedScreeningAssessmentRow,
    captures: (captures ?? []) as unknown as PersistedScreeningCaptureRow[],
    findings: (findings ?? []) as PersistedScreeningFindingRow[],
  })
  if (screened.descriptiveFindings.length === 0) {
    logEvent({ route: ROUTE, outcome: 'client_error', status: 422, userHash, detail: 'screening context unavailable' })
    return NextResponse.json({
      error: 'This assessment has no available screening measurements to build a workout from.',
      code: 'screening_context_unavailable',
    }, { status: 422 })
  }

  const candidateSnapshot = buildSessionFromAssessment(
    preferences ? { ...assessment, capability: preferences.capability } : assessment,
    screened.descriptiveFindings as StoredFinding[],
    week,
    {
      approvedExerciseSlugs: clinicalAccess.approvedExerciseSlugs,
      approvedLinkIds: clinicalAccess.approvedLinkIds,
      approvedReportCopyIds: clinicalAccess.approvedReportCopyIds,
    },
  )
  if (!candidateSnapshot) {
    // Empty-session floor — nothing reliable to build a workout from.
    logEvent({ route: ROUTE, outcome: 'client_error', status: 422, userHash, detail: 'no playable session' })
    return NextResponse.json({ error: 'This screening has no reliable findings to build a workout from — re-capture and try again.' }, { status: 422 })
  }
  let draftSnapshot = candidateSnapshot
  if (preferences && selectedSlugs) {
    try {
      draftSnapshot = personalizeWorkout(candidateSnapshot, preferences, selectedSlugs)
    } catch (cause) {
      return NextResponse.json({
        error: cause instanceof Error ? cause.message : 'This workout selection is unavailable.',
      }, { status: 422 })
    }
  }
  const catalogIdentity = {
    version: clinicalAccess.contentVersion!,
    inventorySha256: clinicalAccess.inventorySha256,
  }
  const snapshot = operation.isPrototype
    ? mintPrototypeSessionSnapshot(draftSnapshot, catalogIdentity)
    : governSessionSnapshot(draftSnapshot, legalNotice!, catalogIdentity)

  const effectivePreferences = preferences ?? {
    ...DEFAULT_WORKOUT_PREFERENCES,
    capability: snapshot.capability,
  }
  const effectiveName = name ?? WORKOUT_GOALS[effectivePreferences.goal]
  const effectiveGenerationSource = generationSource ?? 'scan'

  const shareToken = !operation.isPrototype && share ? generateShareToken() : null
  const expiresAt = shareToken ? new Date(Date.now() + SHARE_TTL_DAYS * 86_400_000).toISOString() : null

  const rpcName = operation.isPrototype
    ? 'create_workout_session_prototype'
    : name
      ? 'create_personalized_workout_session_clinical_governed'
      : 'create_workout_session_clinical_governed'
  const commonRpc = {
    p_assessment_id: assessment_id,
    p_client_id: assessment.client_id,
    p_practitioner_id: user.id,
    p_week: week,
    p_capability: snapshot.capability,
    p_program_snapshot: snapshot,
    p_estimated_duration_sec: snapshot.estimatedDurationSec,
    p_operation_id: randomUUID(),
    p_clinical_content_version: clinicalAccess.contentVersion,
    p_clinical_inventory_sha256: clinicalAccess.inventorySha256,
  }
  const rpcParams = operation.isPrototype
    ? {
        ...commonRpc,
        p_name: effectiveName,
        p_preferences: effectivePreferences,
        p_generation_source: effectiveGenerationSource,
      }
    : {
        ...commonRpc,
        p_token_hash: shareToken?.tokenHash ?? null,
        p_expires_at: expiresAt,
        p_ip_hash: hashIp(req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')),
        p_document_id: legalNotice!.documentId,
        p_document_version: legalNotice!.version,
        p_document_body_sha256: legalNotice!.bodySha256,
        p_document_effective_at: legalNotice!.effectiveAt,
        p_jurisdiction: legalNotice!.jurisdiction,
        p_product_scope: legalNotice!.productScope,
        ...(name && preferences && generationSource ? {
          p_name: name,
          p_preferences: preferences,
          p_generation_source: generationSource,
        } : {}),
      }
  const { data: created, error: createError } = await service.rpc(rpcName, rpcParams)
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
  const clinicalAccess = await serverClinicalContentAccessForPractitioner(user.id)
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

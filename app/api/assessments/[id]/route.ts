import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logEvent, hashResource, hashUser } from '@/lib/log'
import { isNoRows } from '@/lib/api/query-error'
import { dedupeCapturesByViewSide } from '@/lib/captures/dedupeCaptures'
import { clinicalContentAccess } from '@/lib/clinical-content/runtime'
import { verifyClinicalContentAccess } from '@/lib/clinical-content/database'
import { clinicalContentUnavailableResponse } from '@/lib/clinical-content/http'
import { approvedClinicalLinks } from '@/lib/clinical-content/catalog'
import { hasCompleteClinicalSurfaces } from '@/lib/clinical-content/surfaces'
import { buildClinicalProjection } from '@/lib/program/clinicalProjection'
import type { StoredFinding } from '@/lib/findings/storedFindingToEngine'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate
  const clinicalAccess = await verifyClinicalContentAccess(clinicalContentAccess(), supabase)
  const completeClinicalSurface = hasCompleteClinicalSurfaces(clinicalAccess)

  const { id } = await params
  const logBase = { userHash: hashUser(user.id), resourceHash: hashResource(id) }

  const { data: assessment, error } = await supabase
    .from('assessments')
    .select(`
      id, status, overall_score, overall_grade,
      scoring_engine_version, tilt_corrected, level_verified, capture_stability, assessed_at, notes,
      priority_keys, capability, exercise_swaps, practitioner_approved, practitioner_approved_at,
      clients!inner(id, first_name, last_name)
    `)
    .eq('id', id)
    .eq('practitioner_id', user.id)
    .single()

  if (error) {
    if (!isNoRows(error)) {
      logEvent({ route: 'GET /api/assessments/[id]', outcome: 'server_error', status: 500, ...logBase, detailCode: 'assessment_load_failed' })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
  }

  const { data: findings, error: findingsErr } = await supabase
    .from('assessment_findings')
    .select('*')
    .eq('assessment_id', id)
    .order('region')
  if (findingsErr) {
    // A failed read must not render as a complete assessment with no findings.
    logEvent({ route: 'GET /api/assessments/[id]', outcome: 'server_error', status: 500, ...logBase, detailCode: 'findings_load_failed' })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  // Enrich findings with causes_text + tight/weak muscles from imbalance_definitions
  const keys = (findings || []).map((f: { imbalance_key: string }) => f.imbalance_key)
  const service = createSupabaseServiceClient()

  // These three reads are independent (defs + links key off `keys`, captures off
  // `id`) — run them together instead of three serial round trips.
  const [defsRes, capturesRes] = await Promise.all([
    keys.length > 0 && clinicalAccess.mode === 'test_fixture' && clinicalAccess.surfaces.recommendations
      ? service.from('imbalance_definitions').select('key, causes_text, tight_muscles, weak_muscles').in('key', keys)
      : Promise.resolve({ data: [] as { key: string; causes_text: string; tight_muscles: unknown; weak_muscles: unknown }[] }),
    service.from('captures').select('id, view, profile_side, storage_path, source, pose_frame').eq('assessment_id', id),
  ])

  const defMap: Record<string, { causes_text: string; tight_muscles: string[]; weak_muscles: string[] }> = {}
  for (const d of defsRes.data ?? []) {
    let tight: string[] = []
    let weak: string[] = []
    try { tight = typeof d.tight_muscles === 'string' ? JSON.parse(d.tight_muscles) : (d.tight_muscles || []) } catch { tight = [] }
    try { weak = typeof d.weak_muscles === 'string' ? JSON.parse(d.weak_muscles) : (d.weak_muscles || []) } catch { weak = [] }
    defMap[d.key] = { causes_text: d.causes_text || '', tight_muscles: tight, weak_muscles: weak }
  }

  // Normalized muscle links (knowledge base). Empty until the muscle KB is
  // seeded; the UI falls back to the legacy JSONB strings in that case.
  const linkMap: Record<string, { tight: { slug: string; name: string; confidence?: 'high' | 'medium' | 'low' }[]; weak: { slug: string; name: string; confidence?: 'high' | 'medium' | 'low' }[] }> = {}
  for (const { muscle, link } of completeClinicalSurface
    ? approvedClinicalLinks(clinicalAccess)
    : []) {
    if (link.scored === false || !keys.includes(link.imbalanceKey)) continue
    const entry = (linkMap[link.imbalanceKey] ??= { tight: [], weak: [] })
    entry[link.role].push({
      slug: muscle.slug,
      name: muscle.name,
      confidence: link.confidence,
    })
  }

  const enrichedFindings = (findings || []).map((f: Record<string, unknown>) => ({
    ...f,
    explanation: clinicalAccess.mode === 'test_fixture' && clinicalAccess.surfaces.recommendations
      ? f.explanation ?? null
      : null,
    causes_text: defMap[f.imbalance_key as string]?.causes_text || '',
    tight_muscles: defMap[f.imbalance_key as string]?.tight_muscles || [],
    weak_muscles: defMap[f.imbalance_key as string]?.weak_muscles || [],
    tight_muscle_links: linkMap[f.imbalance_key as string]?.tight || [],
    weak_muscle_links: linkMap[f.imbalance_key as string]?.weak || [],
  }))

  const rawCaptures = capturesRes.data

  // One capture per (view, profile_side): a burst (engine 1.3.0) stores every
  // frame for re-scorability, but the results page shows a single photo slot per
  // distinct view/side — frames within a burst share source/roll, so the first
  // row stands in. Keying on view alone would collapse left- and right-side
  // captures into one indistinguishable `side` row.
  const perViewCaptures = dedupeCapturesByViewSide(rawCaptures || [])

  // Keep regulated images behind a same-origin admission check. A storage
  // signed URL remains usable until its TTL even after practitioner revocation;
  // this endpoint path re-checks active AAL2 access on every image request.
  const captures = perViewCaptures.map((cap) => {
    const roll = (cap.pose_frame as { captureRollDeg?: number } | null)?.captureRollDeg
    return {
      id: cap.id, view: cap.view, profile_side: cap.profile_side ?? null,
      signed_url: cap.storage_path ? `/api/captures/${encodeURIComponent(cap.id)}/image` : null,
      source: cap.source,
      capture_roll_deg: typeof roll === 'number' ? roll : null,
    }
  })

  const safeAssessment = completeClinicalSurface
    ? assessment
    : { ...assessment, priority_keys: null, capability: null, exercise_swaps: null }
  const clinicalProjection = completeClinicalSurface
    ? buildClinicalProjection(
        assessment,
        (findings ?? []) as StoredFinding[],
        {
          approvedExerciseSlugs: clinicalAccess.approvedExerciseSlugs,
          approvedLinkIds: clinicalAccess.approvedLinkIds,
          approvedReportCopyIds: clinicalAccess.approvedReportCopyIds,
        },
      )
    : null

  return NextResponse.json({
    assessment: safeAssessment,
    findings: enrichedFindings,
    captures,
    clinical_content: {
      enabled: completeClinicalSurface,
      surfaces: clinicalAccess.surfaces,
      mode: clinicalAccess.mode,
      version: completeClinicalSurface ? clinicalAccess.contentVersion : null,
      projection: clinicalProjection,
    },
  })
}

const CAPABILITIES = new Set(['regression', 'standard', 'progression'])

function isSwapMap(v: unknown): v is Record<string, Record<string, string>> {
  if (typeof v !== 'object' || v === null) return false
  return Object.values(v).every(
    (inner) =>
      typeof inner === 'object' &&
      inner !== null &&
      Object.values(inner).every((s) => typeof s === 'string'),
  )
}

// Persist the coach's program overrides (capability, active priority order, swaps).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ROUTE = 'PATCH /api/assessments/[id]'
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate
  const clinicalAccess = await verifyClinicalContentAccess(clinicalContentAccess(), supabase)
  // Same predicate as GET and the assessment page: overrides must not be
  // writable in a partial release where they would be invisible and inert.
  if (!hasCompleteClinicalSurfaces(clinicalAccess)) return clinicalContentUnavailableResponse()
  const userHash = hashUser(user.id)

  const service = createSupabaseServiceClient()
  const allowed = await enforceRateLimit(service, { route: 'assessments_update', userId: user.id, limit: 30, windowSeconds: 60 })
  if (!allowed) {
    logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429, userHash })
    return NextResponse.json({ error: 'Too many requests — try again shortly' }, { status: 429 })
  }

  const { id } = await params
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const b = body as { capability?: unknown; priority_keys?: unknown; exercise_swaps?: unknown }

  const update: Record<string, unknown> = {}
  if (b.capability !== undefined) {
    if (typeof b.capability !== 'string' || !CAPABILITIES.has(b.capability)) {
      return NextResponse.json({ error: 'Invalid capability' }, { status: 400 })
    }
    update.capability = b.capability
  }
  if (b.priority_keys !== undefined) {
    if (!Array.isArray(b.priority_keys) || !b.priority_keys.every((k) => typeof k === 'string')) {
      return NextResponse.json({ error: 'Invalid priority_keys' }, { status: 400 })
    }
    update.priority_keys = b.priority_keys
  }
  if (b.exercise_swaps !== undefined) {
    if (!isSwapMap(b.exercise_swaps)) {
      return NextResponse.json({ error: 'Invalid exercise_swaps' }, { status: 400 })
    }
    update.exercise_swaps = b.exercise_swaps
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  // Service-role write (authenticated DB writes on regulated tables are revoked);
  // scoped by practitioner_id since service-role bypasses RLS.
  const { error } = await service
    .from('assessments')
    .update(update)
    .eq('id', id)
    .eq('practitioner_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

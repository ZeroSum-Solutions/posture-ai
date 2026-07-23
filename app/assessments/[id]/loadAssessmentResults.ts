import { NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { logEvent, hashResource, hashUser } from '@/lib/log'
import { isNoRows } from '@/lib/api/query-error'
import { dedupeCapturesByViewSide } from '@/lib/captures/dedupeCaptures'
import { clinicalContentAccess } from '@/lib/clinical-content/runtime'
import { verifyClinicalContentAccess } from '@/lib/clinical-content/database'
import { approvedClinicalLinks } from '@/lib/clinical-content/catalog'
import { hasCompleteClinicalSurfaces } from '@/lib/clinical-content/surfaces'
import type { ClinicalContentAccess } from '@/lib/clinical-content/policy'
import { buildClinicalProjection, type ClinicalProjection } from '@/lib/program/clinicalProjection'
import type { StoredFinding } from '@/lib/findings/storedFindingToEngine'

export type AssessmentResultsPayload = {
  assessment: {
    id: string
    status: string
    overall_score: number
    overall_grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'E'
    scoring_engine_version: string | null
    tilt_corrected: boolean | null
    level_verified: boolean | null
    capture_stability?: number | null
    assessed_at: string
    priority_keys?: string[] | null
    capability?: string | null
    exercise_swaps?: Record<string, Record<string, string>> | null
    practitioner_approved?: boolean | null
    practitioner_approved_at: string | null
    notes: string | null
    clients: { id: string; first_name: string; last_name: string }
  }
  findings: Array<{
    id: string
    imbalance_key: string
    region: string
    label: string
    deviation: number
    direction: string
    severity_pct: number
    zone: 'maintain' | 'warning' | 'danger' | 'unreliable'
    view_used: string
    confidence: number
    stability_score?: number | null
    uncertainty_deg?: number | null
    borderline?: boolean | null
    metric_validity?: string | null
    explanation?: string | null
    causes_text?: string
    tight_muscles?: string[]
    weak_muscles?: string[]
    tight_muscle_links?: Array<{ slug: string; name: string; confidence?: 'high' | 'medium' | 'low' }>
    weak_muscle_links?: Array<{ slug: string; name: string; confidence?: 'high' | 'medium' | 'low' }>
  }>
  captures: Array<{
    id: string
    view: string
    profile_side: 'left' | 'right' | null
    signed_url: string | null
    source: string
    capture_roll_deg: number | null
  }>
  clinical_content: {
    enabled: boolean
    surfaces: ClinicalContentAccess['surfaces']
    mode: ClinicalContentAccess['mode']
    version: string | null
    projection: ClinicalProjection | null
  }
}

export type AssessmentResultsLoadResult =
  | { ok: true; data: AssessmentResultsPayload }
  | { ok: false; response: NextResponse }

export async function loadAssessmentResults(
  id: string,
  verifiedClinicalAccess?: ClinicalContentAccess,
): Promise<AssessmentResultsLoadResult> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return { ok: false, response: gate }
  const clinicalAccess = verifiedClinicalAccess
    ?? await verifyClinicalContentAccess(clinicalContentAccess(), supabase)
  const completeClinicalSurface = hasCompleteClinicalSurfaces(clinicalAccess)
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
      return { ok: false, response: NextResponse.json({ error: 'Internal server error' }, { status: 500 }) }
    }
    return { ok: false, response: NextResponse.json({ error: 'Assessment not found' }, { status: 404 }) }
  }
  const relatedClient = Array.isArray(assessment.clients)
    ? assessment.clients[0]
    : assessment.clients
  if (!relatedClient) {
    logEvent({ route: 'GET /api/assessments/[id]', outcome: 'server_error', status: 500, ...logBase, detailCode: 'assessment_client_missing' })
    return { ok: false, response: NextResponse.json({ error: 'Internal server error' }, { status: 500 }) }
  }
  const normalizedAssessment: AssessmentResultsPayload['assessment'] = {
    id: assessment.id,
    status: assessment.status,
    overall_score: assessment.overall_score,
    overall_grade: assessment.overall_grade,
    scoring_engine_version: assessment.scoring_engine_version,
    tilt_corrected: assessment.tilt_corrected,
    level_verified: assessment.level_verified,
    capture_stability: assessment.capture_stability,
    assessed_at: assessment.assessed_at,
    notes: assessment.notes ?? null,
    priority_keys: assessment.priority_keys,
    capability: assessment.capability,
    exercise_swaps: assessment.exercise_swaps,
    practitioner_approved: assessment.practitioner_approved,
    practitioner_approved_at: assessment.practitioner_approved_at ?? null,
    clients: {
      id: relatedClient.id,
      first_name: relatedClient.first_name,
      last_name: relatedClient.last_name,
    },
  }

  const { data: findings, error: findingsErr } = await supabase
    .from('assessment_findings')
    .select('*')
    .eq('assessment_id', id)
    .order('region')
  if (findingsErr) {
    logEvent({ route: 'GET /api/assessments/[id]', outcome: 'server_error', status: 500, ...logBase, detailCode: 'findings_load_failed' })
    return { ok: false, response: NextResponse.json({ error: 'Internal server error' }, { status: 500 }) }
  }

  const keys = (findings || []).map((finding: { imbalance_key: string }) => finding.imbalance_key)
  const service = createSupabaseServiceClient()
  const [defsRes, capturesRes] = await Promise.all([
    keys.length > 0 && clinicalAccess.mode === 'test_fixture' && clinicalAccess.surfaces.recommendations
      ? service.from('imbalance_definitions').select('key, causes_text, tight_muscles, weak_muscles').in('key', keys)
      : Promise.resolve({ data: [] as { key: string; causes_text: string; tight_muscles: unknown; weak_muscles: unknown }[] }),
    service.from('captures').select('id, view, profile_side, storage_path, source, pose_frame').eq('assessment_id', id),
  ])

  const defMap: Record<string, { causes_text: string; tight_muscles: string[]; weak_muscles: string[] }> = {}
  for (const definition of defsRes.data ?? []) {
    let tight: string[] = []
    let weak: string[] = []
    try {
      tight = typeof definition.tight_muscles === 'string'
        ? JSON.parse(definition.tight_muscles)
        : (definition.tight_muscles || [])
    } catch {
      tight = []
    }
    try {
      weak = typeof definition.weak_muscles === 'string'
        ? JSON.parse(definition.weak_muscles)
        : (definition.weak_muscles || [])
    } catch {
      weak = []
    }
    defMap[definition.key] = {
      causes_text: definition.causes_text || '',
      tight_muscles: tight,
      weak_muscles: weak,
    }
  }

  const linkMap: Record<string, {
    tight: { slug: string; name: string; confidence?: 'high' | 'medium' | 'low' }[]
    weak: { slug: string; name: string; confidence?: 'high' | 'medium' | 'low' }[]
  }> = {}
  for (const { muscle, link } of completeClinicalSurface ? approvedClinicalLinks(clinicalAccess) : []) {
    if (link.scored === false || !keys.includes(link.imbalanceKey)) continue
    const entry = (linkMap[link.imbalanceKey] ??= { tight: [], weak: [] })
    entry[link.role].push({
      slug: muscle.slug,
      name: muscle.name,
      confidence: link.confidence,
    })
  }

  const enrichedFindings: AssessmentResultsPayload['findings'] = (findings || []).map((finding) => ({
    ...finding,
    explanation: clinicalAccess.mode === 'test_fixture' && clinicalAccess.surfaces.recommendations
      ? finding.explanation ?? null
      : null,
    causes_text: defMap[finding.imbalance_key as string]?.causes_text || '',
    tight_muscles: defMap[finding.imbalance_key as string]?.tight_muscles || [],
    weak_muscles: defMap[finding.imbalance_key as string]?.weak_muscles || [],
    tight_muscle_links: linkMap[finding.imbalance_key as string]?.tight || [],
    weak_muscle_links: linkMap[finding.imbalance_key as string]?.weak || [],
  }))

  const perViewCaptures = dedupeCapturesByViewSide(capturesRes.data || [])
  const captures: AssessmentResultsPayload['captures'] = perViewCaptures.map((capture) => {
    const roll = (capture.pose_frame as { captureRollDeg?: number } | null)?.captureRollDeg
    return {
      id: capture.id,
      view: capture.view,
      profile_side: capture.profile_side ?? null,
      signed_url: capture.storage_path ? `/api/captures/${encodeURIComponent(capture.id)}/image` : null,
      source: capture.source,
      capture_roll_deg: typeof roll === 'number' ? roll : null,
    }
  })

  const safeAssessment: AssessmentResultsPayload['assessment'] = completeClinicalSurface
    ? normalizedAssessment
    : { ...normalizedAssessment, priority_keys: null, capability: null, exercise_swaps: null }
  const clinicalProjection = completeClinicalSurface
    ? buildClinicalProjection(
        normalizedAssessment,
        (findings ?? []) as StoredFinding[],
        {
          approvedExerciseSlugs: clinicalAccess.approvedExerciseSlugs,
          approvedLinkIds: clinicalAccess.approvedLinkIds,
          approvedReportCopyIds: clinicalAccess.approvedReportCopyIds,
        },
      )
    : null

  return {
    ok: true,
    data: {
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
    },
  }
}

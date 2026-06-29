import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { isNoRows } from '@/lib/api/query-error'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  const { id } = await params

  const { data: assessment, error } = await supabase
    .from('assessments')
    .select(`
      id, status, overall_score, overall_grade, overall_percentile,
      front_rank, side_rank, scoring_engine_version, tilt_corrected, level_verified, assessed_at, notes,
      priority_keys, capability, exercise_swaps, practitioner_approved, practitioner_approved_at,
      clients!inner(id, first_name, last_name)
    `)
    .eq('id', id)
    .eq('practitioner_id', user.id)
    .single()

  if (error) {
    if (!isNoRows(error)) {
      console.error(`[api/assessments/${id}] load failed:`, error.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
  }

  const { data: findings } = await supabase
    .from('assessment_findings')
    .select('*')
    .eq('assessment_id', id)
    .order('region')

  // Enrich findings with causes_text + tight/weak muscles from imbalance_definitions
  const keys = (findings || []).map((f: { imbalance_key: string }) => f.imbalance_key)
  const defMap: Record<string, { causes_text: string; tight_muscles: string[]; weak_muscles: string[] }> = {}
  if (keys.length > 0) {
    const { data: defs } = await supabase
      .from('imbalance_definitions')
      .select('key, causes_text, tight_muscles, weak_muscles')
      .in('key', keys)
    if (defs) {
      for (const d of defs) {
        let tight: string[] = []
        let weak: string[] = []
        try { tight = typeof d.tight_muscles === 'string' ? JSON.parse(d.tight_muscles) : (d.tight_muscles || []) } catch { tight = [] }
        try { weak = typeof d.weak_muscles === 'string' ? JSON.parse(d.weak_muscles) : (d.weak_muscles || []) } catch { weak = [] }
        defMap[d.key] = { causes_text: d.causes_text || '', tight_muscles: tight, weak_muscles: weak }
      }
    }
  }

  // Normalized muscle links (knowledge base). Empty until the muscle KB is
  // seeded; the UI falls back to the legacy JSONB strings in that case.
  const linkMap: Record<string, { tight: { slug: string; name: string }[]; weak: { slug: string; name: string }[] }> = {}
  if (keys.length > 0) {
    const { data: linkRows } = await supabase
      .from('muscle_imbalance_links')
      .select('imbalance_key, role, muscle_slug, muscles(name)')
      .in('imbalance_key', keys)
    for (const row of (linkRows ?? []) as unknown as { imbalance_key: string; role: 'tight' | 'weak'; muscle_slug: string; muscles: { name: string } | null }[]) {
      const entry = (linkMap[row.imbalance_key] ??= { tight: [], weak: [] })
      entry[row.role].push({ slug: row.muscle_slug, name: row.muscles?.name ?? row.muscle_slug })
    }
  }

  const enrichedFindings = (findings || []).map((f: Record<string, unknown>) => ({
    ...f,
    causes_text: defMap[f.imbalance_key as string]?.causes_text || '',
    tight_muscles: defMap[f.imbalance_key as string]?.tight_muscles || [],
    weak_muscles: defMap[f.imbalance_key as string]?.weak_muscles || [],
    tight_muscle_links: linkMap[f.imbalance_key as string]?.tight || [],
    weak_muscle_links: linkMap[f.imbalance_key as string]?.weak || [],
  }))

  // Fetch captures (photos) for this assessment
  const service = createSupabaseServiceClient()
  const { data: rawCaptures } = await service
    .from('captures')
    .select('id, view, storage_path, source, pose_frame')
    .eq('assessment_id', id)

  // Generate signed URLs for captures that have storage paths
  const captures: Array<{ id: string; view: string; signed_url: string | null; source: string; capture_roll_deg: number | null }> = []
  for (const cap of (rawCaptures || [])) {
    let signed_url: string | null = null
    if (cap.storage_path) {
      const { data: urlData } = await service.storage
        .from('posture-captures')
        .createSignedUrl(cap.storage_path, 3600)
      signed_url = urlData?.signedUrl ?? null
    }
    const roll = (cap.pose_frame as { captureRollDeg?: number } | null)?.captureRollDeg
    captures.push({
      id: cap.id, view: cap.view, signed_url, source: cap.source,
      capture_roll_deg: typeof roll === 'number' ? roll : null,
    })
  }

  return NextResponse.json({ assessment, findings: enrichedFindings, captures })
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
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

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

  const { error } = await supabase
    .from('assessments')
    .update(update)
    .eq('id', id)
    .eq('practitioner_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

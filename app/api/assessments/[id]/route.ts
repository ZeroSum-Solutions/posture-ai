import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logEvent, hashUser } from '@/lib/log'
import { clinicalContentAccess } from '@/lib/clinical-content/runtime'
import { verifyClinicalContentAccess } from '@/lib/clinical-content/database'
import { clinicalContentUnavailableResponse } from '@/lib/clinical-content/http'
import { hasCompleteClinicalSurfaces } from '@/lib/clinical-content/surfaces'
import { loadAssessmentResults } from '@/app/assessments/[id]/loadAssessmentResults'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const result = await loadAssessmentResults(id)
  return result.ok ? NextResponse.json(result.data) : result.response
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

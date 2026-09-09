import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { enforceRateLimitStrict } from '@/lib/rate-limit'
import { logEvent, hashResource, hashUser } from '@/lib/log'

const ROUTE = 'PATCH /api/assessments/[id]/approve'

// Professional-review gate: a practitioner must review and approve an assessment
// before its report can be exported. Exercises are suggestions for a practitioner
// to apply, not auto-generated orders — this records the human-in-the-loop sign-off.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate
  const userHash = hashUser(user.id)

  const service = createSupabaseServiceClient()
  const allowed = await enforceRateLimitStrict(service, { route: 'assessments_approve', userId: user.id, limit: 20, windowSeconds: 60 })
  if (!allowed) {
    logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429, userHash })
    return NextResponse.json({ error: 'Too many requests — try again shortly' }, { status: 429 })
  }

  let body: { approved?: boolean } = {}
  try { body = await req.json() } catch { /* default approve */ }
  const approved = body.approved !== false

  // Service-role write (authenticated DB writes on regulated tables are revoked);
  // scoped by practitioner_id since service-role bypasses RLS.
  let updateQuery = service
    .from('assessments')
    .update({
      practitioner_approved: approved,
      practitioner_approved_at: approved ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .eq('practitioner_id', user.id)
  // A processing/failed row can contain captures or findings from an interrupted
  // non-atomic legacy write. Never let that partial scan become workout input.
  // Revocation remains available regardless of status so stale approvals can be
  // removed, while approval itself is race-safely conditional on completion.
  if (approved) updateQuery = updateQuery.eq('status', 'complete')
  const { data: updated, error } = await updateQuery.select('id')

  if (error) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, resourceHash: hashResource(id), detailCode: 'assessment_approval_failed' })
    return NextResponse.json({ error: 'Failed to update approval.' }, { status: 500 })
  }
  // 0 rows = wrong id or not this practitioner's assessment — don't report success.
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, practitioner_approved: approved })
}

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'

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

  let body: { approved?: boolean } = {}
  try { body = await req.json() } catch { /* default approve */ }
  const approved = body.approved !== false

  // Service-role write (authenticated DB writes on regulated tables are revoked);
  // scoped by practitioner_id since service-role bypasses RLS.
  const service = createSupabaseServiceClient()
  const { data: updated, error } = await service
    .from('assessments')
    .update({
      practitioner_approved: approved,
      practitioner_approved_at: approved ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .eq('practitioner_id', user.id)
    .select('id')

  if (error) {
    console.error(`[api/assessments/${id}/approve] update failed:`, error.message)
    return NextResponse.json({ error: 'Failed to update approval.' }, { status: 500 })
  }
  // 0 rows = wrong id or not this practitioner's assessment — don't report success.
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, practitioner_approved: approved })
}

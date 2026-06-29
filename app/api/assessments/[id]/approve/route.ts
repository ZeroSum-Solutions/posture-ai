import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'

// Professional-review gate: a practitioner must review and approve an assessment
// before its report can be exported. Exercises are suggestions, not an
// auto-generated prescription — this records the human-in-the-loop sign-off.
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

  const { error } = await supabase
    .from('assessments')
    .update({
      practitioner_approved: approved,
      practitioner_approved_at: approved ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .eq('practitioner_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, practitioner_approved: approved })
}

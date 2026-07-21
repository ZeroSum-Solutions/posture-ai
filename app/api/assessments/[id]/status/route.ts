import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { isNoRows } from '@/lib/api/query-error'
import { hashResource, hashUser, logEvent } from '@/lib/log'

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
  const logBase = { userHash: hashUser(user.id), resourceHash: hashResource(id) }

  const { data: assessment, error } = await supabase
    .from('assessments')
    .select('id, status, overall_score, overall_grade, assessed_at')
    .eq('id', id)
    .eq('practitioner_id', user.id)
    .single()

  if (error || !assessment) {
    if (error && !isNoRows(error)) {
      logEvent({ route: 'GET /api/assessments/[id]/status', outcome: 'server_error', status: 500, ...logBase, detailCode: 'assessment_status_load_failed' })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    logEvent({ route: 'GET /api/assessments/[id]/status', outcome: 'client_error', status: 404, ...logBase, detailCode: 'assessment_not_found' })
    return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
  }

  logEvent({ route: 'GET /api/assessments/[id]/status', outcome: 'ok', status: 200, ...logBase, detailCode: 'assessment_status_loaded' })
  return NextResponse.json({
    id: assessment.id,
    status: assessment.status,
    overallScore: assessment.overall_score,
    overallGrade: assessment.overall_grade,
    assessedAt: assessment.assessed_at,
  })
}

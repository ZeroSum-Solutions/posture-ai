import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
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
    .select('id, status, overall_score, overall_grade, overall_percentile, front_rank, side_rank, assessed_at')
    .eq('id', id)
    .eq('practitioner_id', user.id)
    .single()

  if (error || !assessment) {
    if (error && !isNoRows(error)) {
      console.error('[api/assessments/status] load failed:', id, error.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    console.log('[api/assessments/status] not found:', id)
    return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
  }

  console.log('[api/assessments/status] id:', id, 'status:', assessment.status)
  return NextResponse.json({
    id: assessment.id,
    status: assessment.status,
    overallScore: assessment.overall_score,
    overallGrade: assessment.overall_grade,
    overallPercentile: assessment.overall_percentile,
    frontRank: assessment.front_rank,
    sideRank: assessment.side_rank,
    assessedAt: assessment.assessed_at,
  })
}

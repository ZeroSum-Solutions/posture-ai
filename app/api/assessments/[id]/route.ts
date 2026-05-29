import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: assessment, error } = await supabase
    .from('assessments')
    .select(`
      id, status, overall_score, overall_grade, overall_percentile,
      front_rank, side_rank, scoring_engine_version, assessed_at, notes,
      clients!inner(id, first_name, last_name)
    `)
    .eq('id', id)
    .eq('practitioner_id', user.id)
    .single()

  if (error) {
    return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
  }

  const { data: findings } = await supabase
    .from('assessment_findings')
    .select('*')
    .eq('assessment_id', id)
    .order('region')

  // Enrich findings with causes_text from imbalance_definitions
  const keys = (findings || []).map((f: { imbalance_key: string }) => f.imbalance_key)
  const causesMap: Record<string, string> = {}
  if (keys.length > 0) {
    const { data: defs } = await supabase
      .from('imbalance_definitions')
      .select('key, causes_text, tight_muscles, weak_muscles')
      .in('key', keys)
    if (defs) {
      for (const d of defs) {
        causesMap[d.key] = d.causes_text || ''
      }
    }
  }

  const enrichedFindings = (findings || []).map((f: Record<string, unknown>) => ({
    ...f,
    causes_text: causesMap[f.imbalance_key as string] || '',
  }))

  return NextResponse.json({ assessment, findings: enrichedFindings })
}

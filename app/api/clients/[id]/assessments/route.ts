import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  const { id: clientId } = await params
  const excludeId = req.nextUrl.searchParams.get('exclude')
  const includeFindings = req.nextUrl.searchParams.get('include_findings') === 'true'
  // Opt-in: the PDF comparison picker only offers approved priors (an unapproved
  // one would 403 on export). The progress chart leaves this off to show all.
  const approvedOnly = req.nextUrl.searchParams.get('approved_only') === 'true'

  // Verify client belongs to this practitioner
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('practitioner_id', user.id)
    .single()

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  let query = supabase
    .from('assessments')
    .select(
      includeFindings
        ? 'id, assessed_at, overall_grade, overall_score, status, scoring_engine_version, assessment_findings(imbalance_key, label, severity_pct, zone, region, deviation, standard, unit)'
        : 'id, assessed_at, overall_grade, overall_score, status, scoring_engine_version'
    )
    .eq('client_id', clientId)
    .eq('practitioner_id', user.id)
    .eq('status', 'complete')
    .order('assessed_at', { ascending: true })

  if (excludeId) {
    query = query.neq('id', excludeId)
  }
  if (approvedOnly) {
    query = query.eq('practitioner_approved', true)
  }

  const { data: assessments } = await query

  return NextResponse.json({ assessments: assessments || [] })
}

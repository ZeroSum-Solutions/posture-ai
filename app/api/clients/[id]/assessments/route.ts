import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: clientId } = await params
  const excludeId = req.nextUrl.searchParams.get('exclude')

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
    .select('id, assessed_at, overall_grade, overall_score, status')
    .eq('client_id', clientId)
    .eq('practitioner_id', user.id)
    .eq('status', 'complete')
    .order('assessed_at', { ascending: false })

  if (excludeId) {
    query = query.neq('id', excludeId)
  }

  const { data: assessments } = await query

  return NextResponse.json({ assessments: assessments || [] })
}

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface Params { id: string }

export async function PATCH(req: NextRequest, { params }: { params: Promise<Params> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty body ok */ }

  const updates: Record<string, unknown> = {}
  if (body.archived_at !== undefined) updates.archived_at = body.archived_at

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  console.log('[api/clients/[id]] PATCH: updating client', id, updates)
  const { data, error } = await supabase
    .from('clients')
    .update(updates)
    .eq('id', id)
    .eq('practitioner_id', user.id)
    .select()
    .single()

  if (error) {
    console.error('[api/clients/[id]] PATCH error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  console.log('[api/clients/[id]] PATCH: success, archived_at=', data.archived_at)
  return NextResponse.json({ client: data })
}

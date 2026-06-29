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

  const SEX_VALUES = ['male', 'female', 'other', 'prefer_not_to_say']
  const bad = (msg: string) => NextResponse.json({ error: msg }, { status: 400 })

  const updates: Record<string, unknown> = {}

  // archived_at: archive / restore (string ISO timestamp or null)
  if (body.archived_at !== undefined) updates.archived_at = body.archived_at

  // first_name / last_name are NOT NULL — if provided they must be non-empty
  for (const k of ['first_name', 'last_name'] as const) {
    if (body[k] !== undefined) {
      const v = body[k]
      if (typeof v !== 'string' || v.trim() === '') return bad(`${k} must be a non-empty string`)
      updates[k] = v.trim()
    }
  }

  // Nullable text fields (empty string is normalized to null to clear them)
  for (const k of ['date_of_birth', 'notes'] as const) {
    if (body[k] !== undefined) {
      const v = body[k]
      if (v !== null && typeof v !== 'string') return bad(`${k} must be a string or null`)
      updates[k] = v === '' ? null : v
    }
  }

  // sex_at_birth: nullable enum
  if (body.sex_at_birth !== undefined) {
    const v = body.sex_at_birth
    if (v !== null && !(typeof v === 'string' && SEX_VALUES.includes(v))) {
      return bad('sex_at_birth must be one of male, female, other, prefer_not_to_say, or null')
    }
    updates.sex_at_birth = v === '' ? null : v
  }

  // Nullable non-negative numeric measurements
  for (const k of ['height_cm', 'weight_kg'] as const) {
    if (body[k] !== undefined) {
      const v = body[k]
      if (v !== null && !(typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
        return bad(`${k} must be a non-negative number or null`)
      }
      updates[k] = v
    }
  }

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

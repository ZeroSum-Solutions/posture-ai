import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const supabase = createSupabaseServiceClient()
  console.log('[api/clients] GET: SELECT from clients via .from().select()')
  const { data, error } = await supabase
    .from('clients')
    .select('id, first_name, last_name, date_of_birth, sex_at_birth, height_cm, weight_kg, notes, created_at')
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[api/clients] GET error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  console.log('[api/clients] GET: returned ' + data.length + ' rows from clients table')
  return NextResponse.json({ clients: data, count: data.length })
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServiceClient()
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { first_name, last_name, date_of_birth, sex_at_birth, height_cm, weight_kg, notes, practitioner_id, consent_recorded_at } = body as {
    first_name?: string; last_name?: string; date_of_birth?: string
    sex_at_birth?: string; height_cm?: number; weight_kg?: number
    notes?: string; practitioner_id?: string; consent_recorded_at?: string
  }
  if (!first_name || !last_name) return NextResponse.json({ error: 'first_name and last_name are required' }, { status: 400 })
  if (!practitioner_id) return NextResponse.json({ error: 'practitioner_id is required' }, { status: 400 })
  if (!consent_recorded_at) return NextResponse.json({ error: 'Client consent is required. consent_recorded_at must be provided.' }, { status: 400 })
  console.log('[api/clients] POST: INSERT INTO clients via .from().insert() - ' + first_name + ' ' + last_name)
  const row: Record<string, unknown> = { practitioner_id, first_name, last_name, consent_recorded_at }
  if (date_of_birth) row.date_of_birth = date_of_birth
  if (sex_at_birth) row.sex_at_birth = sex_at_birth
  if (height_cm != null) row.height_cm = height_cm
  if (weight_kg != null) row.weight_kg = weight_kg
  if (notes) row.notes = notes
  const { data, error } = await supabase.from('clients').insert(row).select().single()
  if (error) {
    console.error('[api/clients] POST error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  console.log('[api/clients] POST: INSERT successful, new client id=' + data.id)
  return NextResponse.json({ client: data }, { status: 201 })
}

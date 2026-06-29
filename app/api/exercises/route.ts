import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  const { data: exercises, error } = await supabase
    .from('exercises')
    .select('id, slug, name, category, primary_deviation_keys, min_zone, instructions, sets, hold_seconds, reps_min, reps_max, dosage_type, is_integrative')
    .order('category')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ exercises: exercises || [] })
}

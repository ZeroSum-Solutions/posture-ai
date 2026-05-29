import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

export async function PATCH(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { display_name, practice_name } = body

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (display_name !== undefined) updates.display_name = display_name
  if (practice_name !== undefined) updates.practice_name = practice_name

  const { data, error } = await supabase
    .from('practitioners')
    .update(updates)
    .eq('id', user.id)
    .select('display_name, practice_name, logo_storage_path')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ practitioner: data })
}

export async function POST(req: NextRequest) {
  // Logo upload endpoint
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const formData = await req.formData()
  const file = formData.get('logo') as File | null
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const serviceClient = createSupabaseServiceClient()
  const ext = file.name.split('.').pop() || 'jpg'
  const path = `${user.id}/logo.${ext}`

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Ensure bucket exists
  await serviceClient.storage.createBucket('practitioner-assets', { public: false }).catch(() => {})

  const { error: uploadError } = await serviceClient.storage
    .from('practitioner-assets')
    .upload(path, buffer, {
      contentType: file.type || 'image/jpeg',
      upsert: true,
    })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  // Update practitioners table with logo path
  await supabase
    .from('practitioners')
    .update({ logo_storage_path: path, updated_at: new Date().toISOString() })
    .eq('id', user.id)

  // Return signed URL
  const { data: signedData } = await serviceClient.storage
    .from('practitioner-assets')
    .createSignedUrl(path, 3600)

  return NextResponse.json({ logo_url: signedData?.signedUrl, logo_storage_path: path })
}

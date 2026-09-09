import { NextResponse } from 'next/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 })
  }
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  const { id } = await params
  const service = createSupabaseServiceClient()
  const { data: capture, error } = await service
    .from('captures')
    .select('storage_path, assessments!inner(practitioner_id, clients!inner(practitioner_id, deleted_at))')
    .eq('id', id)
    .eq('practitioner_id', user.id)
    .eq('assessments.practitioner_id', user.id)
    .eq('assessments.clients.practitioner_id', user.id)
    .is('assessments.clients.deleted_at', null)
    .maybeSingle()

  if (error || !capture?.storage_path) {
    return NextResponse.json({ error: 'Capture not found' }, { status: 404 })
  }

  const { data: image, error: downloadError } = await service.storage
    .from('posture-captures')
    .download(capture.storage_path)
  if (downloadError || !image) {
    return NextResponse.json({ error: 'Capture not found' }, { status: 404 })
  }

  const type = image.type.startsWith('image/') ? image.type : 'application/octet-stream'
  return new NextResponse(Buffer.from(await image.arrayBuffer()), {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

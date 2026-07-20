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
  const { data: report, error } = await service
    .from('reports')
    .select('storage_path')
    .eq('id', id)
    .eq('practitioner_id', user.id)
    .maybeSingle()

  if (error || !report?.storage_path) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  const { data: pdf, error: downloadError } = await service.storage
    .from('posture-reports')
    .download(report.storage_path)
  if (downloadError || !pdf) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  return new NextResponse(Buffer.from(await pdf.arrayBuffer()), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="posture-report.pdf"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

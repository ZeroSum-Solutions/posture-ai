import { NextResponse } from 'next/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { clinicalContentAccess } from '@/lib/clinical-content/runtime'
import { verifyClinicalContentAccess } from '@/lib/clinical-content/database'
import type { ClinicalContentAccess } from '@/lib/clinical-content/policy'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

type StoredReport = {
  storage_path: string | null
  report_scope: 'assessment_only' | 'clinical_practitioner' | 'clinical_client' | null
  clinical_content_version: string | null
  clinical_inventory_sha256: string | null
}

function isReportAvailable(report: StoredReport, access: ClinicalContentAccess): boolean {
  if (report.report_scope === 'assessment_only') {
    return report.clinical_content_version === null && report.clinical_inventory_sha256 === null
  }
  if (report.report_scope !== 'clinical_practitioner' && report.report_scope !== 'clinical_client') {
    return false
  }

  const surfaceEnabled = report.report_scope === 'clinical_client'
    ? access.surfaces.programs && access.surfaces.recommendations
    : access.surfaces.recommendations || access.surfaces.knowledgeLinks
  return surfaceEnabled
    && report.clinical_content_version === access.contentVersion
    && report.clinical_inventory_sha256 === access.inventorySha256
}

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
  const clinicalAccess = await verifyClinicalContentAccess(clinicalContentAccess(), service)
  const { data: report, error } = await service
    .from('reports')
    .select('storage_path, report_scope, clinical_content_version, clinical_inventory_sha256')
    .eq('id', id)
    .eq('practitioner_id', user.id)
    .maybeSingle()

  if (error || !report?.storage_path || !isReportAvailable(report as StoredReport, clinicalAccess)) {
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

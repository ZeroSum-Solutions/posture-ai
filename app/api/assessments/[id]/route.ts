import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: assessment, error } = await supabase
    .from('assessments')
    .select(`
      id, status, overall_score, overall_grade, overall_percentile,
      front_rank, side_rank, scoring_engine_version, assessed_at, notes,
      clients!inner(id, first_name, last_name)
    `)
    .eq('id', id)
    .eq('practitioner_id', user.id)
    .single()

  if (error) {
    return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
  }

  const { data: findings } = await supabase
    .from('assessment_findings')
    .select('*')
    .eq('assessment_id', id)
    .order('region')

  // Enrich findings with causes_text + tight/weak muscles from imbalance_definitions
  const keys = (findings || []).map((f: { imbalance_key: string }) => f.imbalance_key)
  const defMap: Record<string, { causes_text: string; tight_muscles: string[]; weak_muscles: string[] }> = {}
  if (keys.length > 0) {
    const { data: defs } = await supabase
      .from('imbalance_definitions')
      .select('key, causes_text, tight_muscles, weak_muscles')
      .in('key', keys)
    if (defs) {
      for (const d of defs) {
        let tight: string[] = []
        let weak: string[] = []
        try { tight = typeof d.tight_muscles === 'string' ? JSON.parse(d.tight_muscles) : (d.tight_muscles || []) } catch { tight = [] }
        try { weak = typeof d.weak_muscles === 'string' ? JSON.parse(d.weak_muscles) : (d.weak_muscles || []) } catch { weak = [] }
        defMap[d.key] = { causes_text: d.causes_text || '', tight_muscles: tight, weak_muscles: weak }
      }
    }
  }

  const enrichedFindings = (findings || []).map((f: Record<string, unknown>) => ({
    ...f,
    causes_text: defMap[f.imbalance_key as string]?.causes_text || '',
    tight_muscles: defMap[f.imbalance_key as string]?.tight_muscles || [],
    weak_muscles: defMap[f.imbalance_key as string]?.weak_muscles || [],
  }))

  // Fetch captures (photos) for this assessment
  const service = createSupabaseServiceClient()
  const { data: rawCaptures } = await service
    .from('captures')
    .select('id, view, storage_path, source')
    .eq('assessment_id', id)

  // Generate signed URLs for captures that have storage paths
  const captures: Array<{ id: string; view: string; signed_url: string | null; source: string }> = []
  for (const cap of (rawCaptures || [])) {
    let signed_url: string | null = null
    if (cap.storage_path) {
      const { data: urlData } = await service.storage
        .from('posture-captures')
        .createSignedUrl(cap.storage_path, 3600)
      signed_url = urlData?.signedUrl ?? null
    }
    captures.push({ id: cap.id, view: cap.view, signed_url, source: cap.source })
  }

  return NextResponse.json({ assessment, findings: enrichedFindings, captures })
}

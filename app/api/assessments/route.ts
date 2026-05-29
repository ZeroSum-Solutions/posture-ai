import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { assessPosture } from '@/lib/posture-engine'
import type { PoseFrame } from '@/lib/posture-engine'
import TEST_FIXTURE from '@/lib/posture-engine/fixtures/test-landmarks.json'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { client_id, test_mode } = body
    if (!client_id) return NextResponse.json({ error: 'client_id required' }, { status: 400 })

    const service = createSupabaseServiceClient()

    // Verify client belongs to this practitioner
    const { data: client } = await service
      .from('clients')
      .select('id')
      .eq('id', client_id)
      .eq('practitioner_id', user.id)
      .single()
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    // Create assessment with status=processing
    const { data: assessment, error: insertErr } = await service
      .from('assessments')
      .insert({
        client_id,
        practitioner_id: user.id,
        status: 'processing',
        assessment_type: 'static',
      })
      .select('id')
      .single()
    if (insertErr || !assessment) {
      console.error('[api/assessments] insert error:', insertErr)
      return NextResponse.json({ error: 'Failed to create assessment' }, { status: 500 })
    }

    const assessmentId = assessment.id
    console.log('[api/assessments] Created assessment:', assessmentId, '(test_mode:', test_mode, ')')

    // Run scoring engine
    try {
      const frames = TEST_FIXTURE.frames as PoseFrame[]
      const result = assessPosture(frames)

      // Save findings
      const findingsToInsert = result.findings.map(f => ({
        assessment_id: assessmentId,
        practitioner_id: user.id,
        imbalance_key: f.key,
        region: f.region,
        label: f.label,
        deviation: f.deviation,
        standard: f.standard,
        unit: f.unit,
        direction: f.direction,
        severity_pct: f.severityPct,
        zone: f.zone,
        view_used: f.viewUsed === 'back' ? 'back' : f.viewUsed,
        confidence: f.confidence,
      }))

      await service.from('assessment_findings').insert(findingsToInsert)

      // Update assessment to complete
      await service
        .from('assessments')
        .update({
          status: 'complete',
          overall_score: result.overallScore,
          overall_grade: result.overallGrade,
          overall_percentile: result.overallPercentile,
          front_rank: result.ranks.front,
          side_rank: result.ranks.side,
          scoring_engine_version: result.engineVersion,
        })
        .eq('id', assessmentId)

      console.log('[api/assessments] Scoring complete. Grade:', result.overallGrade, 'Score:', result.overallScore)
      return NextResponse.json({ id: assessmentId, status: 'complete' })
    } catch (scoreErr) {
      console.error('[api/assessments] Scoring error:', scoreErr)
      await service.from('assessments').update({ status: 'failed' }).eq('id', assessmentId)
      return NextResponse.json({ id: assessmentId, status: 'failed', error: 'Scoring failed' })
    }
  } catch (err) {
    console.error('[api/assessments] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

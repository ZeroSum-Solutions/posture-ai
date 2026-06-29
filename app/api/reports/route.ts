import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { PostureReportPdf } from '@/lib/pdf/report'
import type { PdfFinding, PdfAssessment, PdfExercise } from '@/lib/pdf/report'
import { ClientReport } from '@/lib/pdf/clientReport'
import { buildProgramFrom } from '@/lib/program/buildProgram'
import { isNoRows } from '@/lib/api/query-error'
import { dbFindingsToEngineFindings, isCapability, type DbFindingRow } from '@/lib/reports/clientProgram'
import type { ReactElement } from 'react'
import type { DocumentProps } from '@react-pdf/renderer'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logEvent, hashUser } from '@/lib/log'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate

  const allowed = await enforceRateLimit(createSupabaseServiceClient(), {
    route: 'reports', userId: user.id, limit: 10, windowSeconds: 60,
  })
  if (!allowed) {
    logEvent({ route: 'POST /api/reports', outcome: 'rate_limited', status: 429, userHash: hashUser(user.id) })
    return NextResponse.json({ error: 'Too many requests — try again shortly' }, { status: 429 })
  }

  let body: { assessment_id?: string; compared_to_assessment_id?: string; variant?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { assessment_id, compared_to_assessment_id } = body
  const variant: 'practitioner' | 'client' = body.variant === 'client' ? 'client' : 'practitioner'

  if (!assessment_id || typeof assessment_id !== 'string') {
    return NextResponse.json({ error: 'assessment_id required' }, { status: 400 })
  }

  // Fetch assessment
  const { data: assessment, error: aErr } = await supabase
    .from('assessments')
    .select(`
      id, client_id, status, overall_score, overall_grade, overall_percentile,
      front_rank, side_rank, assessed_at, practitioner_approved,
      priority_keys, capability, exercise_swaps,
      clients!inner(id, first_name, last_name)
    `)
    .eq('id', assessment_id)
    .eq('practitioner_id', user.id)
    .single()

  if (aErr || !assessment) {
    if (aErr && !isNoRows(aErr)) {
      console.error('[api/reports] assessment load failed:', assessment_id, aErr.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
  }

  // Professional-review gate: no export until a practitioner approves.
  if (!assessment.practitioner_approved) {
    return NextResponse.json(
      { error: 'This report must be reviewed and approved by the practitioner before it can be exported.' },
      { status: 403 },
    )
  }

  // A comparison assessment's findings also get exported (deltas), so it must
  // belong to this practitioner AND be approved too — otherwise its data could be
  // exported without review, or leak from another practitioner's records (IDOR).
  if (compared_to_assessment_id) {
    const { data: prior, error: pErr } = await supabase
      .from('assessments')
      .select('id, client_id, practitioner_approved')
      .eq('id', compared_to_assessment_id)
      .eq('practitioner_id', user.id)
      .maybeSingle()
    if (pErr && !isNoRows(pErr)) {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    if (!prior) {
      return NextResponse.json({ error: 'Comparison assessment not found.' }, { status: 404 })
    }
    // A comparison report is "this client now vs this client before" — the
    // compared assessment must be the SAME client. This blocks nonsensical
    // cross-client comparisons (and with them the cross-client erasure-residual
    // and report-trigger lock-order edge cases).
    if (prior.client_id !== assessment.client_id) {
      return NextResponse.json(
        { error: 'The comparison assessment must belong to the same client.' },
        { status: 400 },
      )
    }
    if (!prior.practitioner_approved) {
      return NextResponse.json(
        { error: 'The comparison assessment must also be reviewed and approved before it can be exported.' },
        { status: 403 },
      )
    }
  }

  // Fetch findings
  const { data: findingsRaw } = await supabase
    .from('assessment_findings')
    .select('*')
    .eq('assessment_id', assessment_id)
    .order('region')

  // Enrich with causes_text, tight/weak muscles from imbalance_definitions
  const keys = (findingsRaw || []).map((f: { imbalance_key: string }) => f.imbalance_key)
  // Exercises are only recommended for reliable findings — an unreliable finding
  // (the unscoreable pelvic_axial_rotation, or any low-confidence capture) must
  // not pull corrective exercises into the practitioner report.
  const reliableKeys = (findingsRaw || [])
    .filter((f: { zone?: string }) => f.zone !== 'unreliable')
    .map((f: { imbalance_key: string }) => f.imbalance_key)
  const defsMap: Record<string, { causes_text: string; tight_muscles: string[]; weak_muscles: string[] }> = {}
  if (keys.length > 0) {
    const { data: defs } = await supabase
      .from('imbalance_definitions')
      .select('key, causes_text, tight_muscles, weak_muscles')
      .in('key', keys)
    if (defs) {
      for (const d of defs) {
        defsMap[d.key] = {
          causes_text: d.causes_text || '',
          tight_muscles: Array.isArray(d.tight_muscles) ? d.tight_muscles : (typeof d.tight_muscles === 'string' ? JSON.parse(d.tight_muscles) : []),
          weak_muscles: Array.isArray(d.weak_muscles) ? d.weak_muscles : (typeof d.weak_muscles === 'string' ? JSON.parse(d.weak_muscles) : []),
        }
      }
    }
  }

  // Build delta map if comparing
  const deltaMap: Record<string, number> = {}
  if (compared_to_assessment_id) {
    const { data: priorFindings } = await supabase
      .from('assessment_findings')
      .select('imbalance_key, deviation')
      .eq('assessment_id', compared_to_assessment_id)
    if (priorFindings) {
      for (const pf of priorFindings) {
        deltaMap[pf.imbalance_key] = pf.deviation
      }
    }
  }

  const hasDelta = compared_to_assessment_id ? Object.keys(deltaMap).length > 0 : false

  const findings: PdfFinding[] = (findingsRaw || []).map((f: Record<string, unknown>) => {
    const def = defsMap[f.imbalance_key as string]
    return {
      id: f.id as string,
      imbalance_key: f.imbalance_key as string,
      region: f.region as string,
      label: f.label as string,
      deviation: Number(f.deviation),
      direction: f.direction as string,
      severity_pct: Number(f.severity_pct),
      zone: f.zone as string,
      view_used: f.view_used as string,
      confidence: Number(f.confidence),
      causes_text: def?.causes_text || '',
      tight_muscles: def?.tight_muscles || [],
      weak_muscles: def?.weak_muscles || [],
      delta: hasDelta && deltaMap[f.imbalance_key as string] !== undefined
        ? Number(f.deviation) - deltaMap[f.imbalance_key as string]
        : null,
    }
  })

  // Fetch exercises relevant to the findings
  const exercises: PdfExercise[] = []
  if (reliableKeys.length > 0) {
    const { data: exRows } = await supabase
      .from('exercises')
      .select('name, category, instructions, sets, hold_seconds, primary_deviation_keys')
    if (exRows) {
      for (const ex of exRows) {
        const devKeys: string[] = Array.isArray(ex.primary_deviation_keys) ? ex.primary_deviation_keys : []
        if (devKeys.some((k: string) => reliableKeys.includes(k))) {
          exercises.push({
            name: ex.name,
            category: ex.category,
            instructions: ex.instructions,
            sets: ex.sets,
            hold_seconds: ex.hold_seconds,
          })
        }
      }
    }
  }

  // Fetch practitioner
  const { data: practitioner } = await supabase
    .from('practitioners')
    .select('display_name, practice_name')
    .eq('id', user.id)
    .single()

  // Extract client info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientsData = (assessment as any).clients
  const clientFirst = Array.isArray(clientsData) ? clientsData[0]?.first_name : clientsData?.first_name
  const clientLast = Array.isArray(clientsData) ? clientsData[0]?.last_name : clientsData?.last_name

  const pdfAssessment: PdfAssessment = {
    id: assessment.id,
    overall_score: assessment.overall_score,
    overall_grade: assessment.overall_grade,
    overall_percentile: assessment.overall_percentile,
    front_rank: assessment.front_rank,
    side_rank: assessment.side_rank,
    assessed_at: assessment.assessed_at,
    clients: { first_name: clientFirst || 'Client', last_name: clientLast || '' },
  }

  // Generate PDF buffer — practitioner report, or the plain-language client
  // report rebuilt from the persisted findings + the coach's saved overrides
  // (so the PDF matches exactly what the practitioner sees on the results page).
  let docElement: ReactElement<DocumentProps>
  if (variant === 'client') {
    const overrides = assessment as unknown as {
      priority_keys: string[] | null
      capability: string | null
      exercise_swaps: Record<string, Record<string, string>> | null
    }
    const program = buildProgramFrom(
      dbFindingsToEngineFindings((findingsRaw || []) as unknown as DbFindingRow[]),
      assessment.overall_grade,
      {
        capability: isCapability(overrides.capability) ? overrides.capability : 'standard',
        activeKeys: Array.isArray(overrides.priority_keys) ? overrides.priority_keys : undefined,
        swaps: overrides.exercise_swaps || undefined,
      },
    )
    const dateStr = new Date(assessment.assessed_at).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
    })
    docElement = React.createElement(ClientReport, {
      clientName: `${clientFirst || 'Client'} ${clientLast || ''}`.trim(),
      practitioner: practitioner?.practice_name || practitioner?.display_name || 'Your practitioner',
      dateStr,
      report: program,
    }) as unknown as ReactElement<DocumentProps>
  } else {
    docElement = React.createElement(PostureReportPdf, {
      assessment: pdfAssessment,
      findings,
      exercises,
      practitioner: practitioner || undefined,
      hasDelta,
    }) as unknown as ReactElement<DocumentProps>
  }

  const pdfBuffer = await renderToBuffer(docElement)

  // Verify it starts with %PDF
  const header = Buffer.from(pdfBuffer).slice(0, 4).toString('ascii')
  if (!header.startsWith('%PDF')) {
    return NextResponse.json({ error: 'PDF generation produced invalid output' }, { status: 500 })
  }

  // Upload to Supabase Storage via service role
  const serviceSupabase = createSupabaseServiceClient()
  const storagePath = `${user.id}/${assessment_id}/${variant === 'client' ? 'report-client.pdf' : 'report.pdf'}`

  // Ensure bucket exists
  const { error: bucketErr } = await serviceSupabase.storage.createBucket('posture-reports', {
    public: false,
    allowedMimeTypes: ['application/pdf'],
  })
  if (bucketErr && !bucketErr.message?.includes('already exists') && !bucketErr.message?.includes('Duplicate')) {
    console.error('[api/reports] Bucket creation error:', bucketErr.message)
  }

  const { error: uploadErr } = await serviceSupabase.storage
    .from('posture-reports')
    .upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    })

  if (uploadErr) {
    console.error('[api/reports] Upload error:', uploadErr.message)
    return NextResponse.json({ error: 'Failed to upload PDF: ' + uploadErr.message }, { status: 500 })
  }

  // Get signed URL (1 hour)
  const { data: signedData, error: signErr } = await serviceSupabase.storage
    .from('posture-reports')
    .createSignedUrl(storagePath, 3600)

  if (signErr || !signedData) {
    return NextResponse.json({ error: 'Failed to create signed URL' }, { status: 500 })
  }

  // Insert reports row (service-role: authenticated DB writes on regulated tables
  // are revoked; practitioner_id is set explicitly below).
  const { data: report, error: reportErr } = await serviceSupabase
    .from('reports')
    .insert({
      assessment_id,
      practitioner_id: user.id,
      storage_path: storagePath,
      // The client report never renders comparison data, so don't record one.
      compared_to_assessment_id: variant === 'client' ? null : (compared_to_assessment_id || null),
    })
    .select('id')
    .single()

  if (reportErr || !report) {
    // The reports row didn't persist — e.g. the client was erased mid-export and
    // the reports_reject_deleted_client trigger rejected it. Remove the PDF we
    // just uploaded so no regulated file is orphaned in storage after an erasure.
    console.error('[api/reports] reports insert failed; removing uploaded PDF:', reportErr?.message)
    await serviceSupabase.storage.from('posture-reports').remove([storagePath])
    return NextResponse.json({ error: 'Failed to record report. Please retry.' }, { status: 500 })
  }

  return NextResponse.json({
    report_id: report.id,
    signed_url: signedData.signedUrl,
    storage_path: storagePath,
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomUUID } from 'node:crypto'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { PostureReportPdf } from '@/lib/pdf/report'
import type { PdfFinding, PdfAssessment, PdfExercise } from '@/lib/pdf/report'
import { ClientReport } from '@/lib/pdf/clientReport'
import { buildProgramFrom } from '@/lib/program/buildProgram'
import { deriveExerciseRecommendations, type ZonedFinding } from '@/lib/exercises'
import { ALL_EXERCISES } from '@/content'
import { isNoRows } from '@/lib/api/query-error'
import { dbFindingsToEngineFindings, isCapability, type DbFindingRow } from '@/lib/reports/clientProgram'
import { buildClientComparison, type ClientComparison } from '@/lib/reports/clientComparison'
import { areEngineVersionsComparable } from '@/lib/comparison/policy'
import type { ReactElement } from 'react'
import type { DocumentProps } from '@react-pdf/renderer'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logEvent, hashUser } from '@/lib/log'
import { resolveRuntimeLegalDocument } from '@/lib/legal/runtime'
import { snapshotLegalDocument } from '@/lib/legal/policy'

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
      id, client_id, status, overall_score, overall_grade,
      assessed_at, practitioner_approved,
      priority_keys, capability, exercise_swaps, scoring_engine_version,
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

  // A generated report is a new governed artifact. Resolve and freeze the
  // applicable notice before doing any rendering or storage work so production
  // fails closed when no approved legal document is available.
  const legalResolution = resolveRuntimeLegalDocument({ kind: 'screening_notice' })
  if (!legalResolution.ok) {
    return NextResponse.json(
      { error: 'The screening notice is unavailable.', code: 'legal_unavailable' },
      { status: 503 },
    )
  }
  const legalNotice = snapshotLegalDocument(legalResolution.document)

  // A comparison assessment's findings also get exported (deltas), so it must
  // belong to this practitioner AND be approved too — otherwise its data could be
  // exported without review, or leak from another practitioner's records (IDOR).
  // Captured here (after the gate passes) for the client-report progress section.
  let priorMeta: {
    grade: string
    score: unknown
    dateStr: string
    assessedAt: string
    scoringEngineVersion: string | null
  } | null = null
  let engineVersionMismatch = false
  if (compared_to_assessment_id) {
    const { data: prior, error: pErr } = await supabase
      .from('assessments')
      .select('id, client_id, practitioner_approved, overall_grade, overall_score, assessed_at, scoring_engine_version')
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
    const currentVersion = assessment.scoring_engine_version ?? null
    const priorVersion = prior.scoring_engine_version ?? null
    engineVersionMismatch = !areEngineVersionsComparable(currentVersion, priorVersion)
    if (!prior.practitioner_approved) {
      return NextResponse.json(
        { error: 'The comparison assessment must also be reviewed and approved before it can be exported.' },
        { status: 403 },
      )
    }
    const currentTime = Date.parse(assessment.assessed_at)
    const priorTime = Date.parse(prior.assessed_at)
    if (!Number.isFinite(currentTime) || !Number.isFinite(priorTime) || priorTime >= currentTime) {
      return NextResponse.json(
        { error: 'The comparison assessment must be earlier than the current assessment.' },
        { status: 400 },
      )
    }
    priorMeta = {
      grade: prior.overall_grade as string,
      score: prior.overall_score,
      assessedAt: prior.assessed_at,
      scoringEngineVersion: priorVersion,
      dateStr: new Date(prior.assessed_at).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
      }),
    }
  }

  // Fetch findings
  const { data: findingsRaw, error: findingsErr } = await supabase
    .from('assessment_findings')
    .select('*')
    .eq('assessment_id', assessment_id)
    .order('region')

  // supabase-js returns {data:null,error} on failure instead of throwing, so a
  // failed read is indistinguishable from a genuinely-empty result. Rendering from
  // silently-empty findings would deliver a clinical PDF showing zero posture issues.
  if (findingsErr) {
    console.error('[api/reports] findings load failed:', assessment_id, findingsErr.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  // Enrich with causes_text, tight/weak muscles from imbalance_definitions
  const keys = (findingsRaw || []).map((f: { imbalance_key: string }) => f.imbalance_key)
  const defsMap: Record<string, { causes_text: string; tight_muscles: string[]; weak_muscles: string[] }> = {}
  // Tolerate a malformed JSONB muscle list: a bad value must not abort the whole
  // export with an uncaught SyntaxError (matches app/api/assessments/[id]/route.ts).
  const parseMuscleList = (v: unknown): string[] => {
    if (Array.isArray(v)) return v as string[]
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }
    return []
  }
  if (keys.length > 0) {
    const { data: defs } = await supabase
      .from('imbalance_definitions')
      .select('key, causes_text, tight_muscles, weak_muscles')
      .in('key', keys)
    if (defs) {
      for (const d of defs) {
        defsMap[d.key] = {
          causes_text: d.causes_text || '',
          tight_muscles: parseMuscleList(d.tight_muscles),
          weak_muscles: parseMuscleList(d.weak_muscles),
        }
      }
    }
  }

  // Build delta map if comparing
  const priorFindingMap = new Map<string, {
    deviation: unknown
    severityPct: unknown
    reliable: boolean
    unit: string | null
  }>()
  let priorComparisonFindings: Array<{
    key: string
    severityPct: unknown
    reliable: boolean
    unit: string | null
  }> = []
  if (compared_to_assessment_id) {
    const { data: priorFindings, error: priorFindingsErr } = await supabase
      .from('assessment_findings')
      .select('imbalance_key, deviation, severity_pct, zone, unit')
      .eq('assessment_id', compared_to_assessment_id)
    if (priorFindingsErr) {
      console.error('[api/reports] prior findings load failed:', compared_to_assessment_id, priorFindingsErr.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    if (priorFindings) {
      for (const pf of priorFindings) {
        priorFindingMap.set(pf.imbalance_key, {
          deviation: pf.deviation,
          severityPct: pf.severity_pct,
          reliable: typeof pf.zone === 'string' && pf.zone !== 'unreliable',
          unit: typeof pf.unit === 'string' ? pf.unit : null,
        })
      }
      priorComparisonFindings = priorFindings.map((pf) => ({
        key: pf.imbalance_key,
        severityPct: pf.severity_pct,
        reliable: typeof pf.zone === 'string' && pf.zone !== 'unreliable',
        unit: typeof pf.unit === 'string' ? pf.unit : null,
      }))
    }
  }

  const hasDelta = Boolean(compared_to_assessment_id && priorMeta)

  // Plain-language "since last time" progress for the CLIENT report only, and
  // only when a valid, approved, same-client prior was selected (all enforced
  // by the gate above). The practitioner PDF keeps its own numeric deltas.
  const canonicalComparison: ClientComparison | null =
    priorMeta
      ? buildClientComparison({
          priorDateStr: priorMeta.dateStr,
          current: {
            grade: assessment.overall_grade,
            score: assessment.overall_score,
            scoringEngineVersion: assessment.scoring_engine_version ?? null,
            assessedAt: assessment.assessed_at,
          },
          prior: {
            grade: priorMeta.grade,
            score: priorMeta.score,
            scoringEngineVersion: priorMeta.scoringEngineVersion,
            assessedAt: priorMeta.assessedAt,
          },
          currentFindings: (findingsRaw || []).map((f: Record<string, unknown>) => ({
            key: f.imbalance_key as string,
            severityPct: f.severity_pct,
            reliable: typeof f.zone === 'string' && f.zone !== 'unreliable',
            unit: typeof f.unit === 'string' ? f.unit : null,
          })),
          priorFindings: priorComparisonFindings,
        })
      : null
  const clientComparison = variant === 'client' ? canonicalComparison : null

  const finiteNumber = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value !== 'string' || value.trim() === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  const findings: PdfFinding[] = (findingsRaw || []).map((f: Record<string, unknown>) => {
    const def = defsMap[f.imbalance_key as string]
    const priorFinding = priorFindingMap.get(f.imbalance_key as string)
    const currentUnit = typeof f.unit === 'string' ? f.unit : null
    const currentDeviation = finiteNumber(f.deviation)
    const priorDeviation = finiteNumber(priorFinding?.deviation)
    const unitsMatch = currentUnit !== null && currentUnit === priorFinding?.unit
    return {
      id: f.id as string,
      imbalance_key: f.imbalance_key as string,
      region: f.region as string,
      label: f.label as string,
      deviation: currentDeviation,
      unit: currentUnit ?? '',
      direction: f.direction as string,
      severity_pct: finiteNumber(f.severity_pct),
      zone: f.zone as string,
      view_used: f.view_used as string,
      confidence: Number(f.confidence),
      causes_text: def?.causes_text || '',
      tight_muscles: def?.tight_muscles || [],
      weak_muscles: def?.weak_muscles || [],
      comparison: canonicalComparison?.byKey[f.imbalance_key as string] ?? null,
      delta: hasDelta && unitsMatch && currentDeviation !== null && priorDeviation !== null
        ? currentDeviation - priorDeviation
        : null,
    }
  })

  // Exercises relevant to the findings, from authored content/ — the same source and the
  // same selector the program builder uses, so the practitioner report cannot recommend an
  // exercise contraindicated by a concurrent finding (nor an informational item, nor one
  // below its own min zone). An unreliable finding recommends nothing.
  const exercises: PdfExercise[] = deriveExerciseRecommendations(
    ALL_EXERCISES,
    (findingsRaw || []) as unknown as ZonedFinding[],
  ).map((ex) => ({
    name: ex.name,
    category: ex.category,
    instructions: ex.instructions,
    sets: ex.sets,
    hold_seconds: ex.holdSeconds,
  }))

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
    scoring_engine_version: assessment.scoring_engine_version,
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
      comparison: clientComparison,
      legalNotice,
    }) as unknown as ReactElement<DocumentProps>
  } else {
    docElement = React.createElement(PostureReportPdf, {
      assessment: pdfAssessment,
      findings,
      exercises,
      practitioner: practitioner || undefined,
      hasDelta,
      engineVersionMismatch,
      legalNotice,
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
  const pdfSha256 = createHash('sha256').update(Buffer.from(pdfBuffer)).digest('hex')
  const storagePath = `${user.id}/${assessment_id}/${variant}/${pdfSha256}-${randomUUID()}.pdf`

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
      upsert: false,
    })

  if (uploadErr) {
    console.error('[api/reports] Upload error:', uploadErr.message)
    return NextResponse.json({ error: 'Failed to upload PDF: ' + uploadErr.message }, { status: 500 })
  }

  // Insert reports row (service-role: authenticated DB writes on regulated tables
  // are revoked; practitioner_id is set explicitly below).
  const { data: report, error: reportErr } = await serviceSupabase
    .from('reports')
    .insert({
      assessment_id,
      practitioner_id: user.id,
      storage_path: storagePath,
      // Record the comparison only when the report actually rendered one: the
      // practitioner PDF whenever a prior was passed, the client PDF only when a
      // valid same-client progress comparison was built above.
      compared_to_assessment_id: variant === 'client'
        ? (clientComparison ? compared_to_assessment_id : null)
        : (compared_to_assessment_id || null),
      legal_document_id: legalNotice.documentId,
      legal_document_version: legalNotice.version,
      legal_document_body_sha256: legalNotice.bodySha256,
      legal_document_effective_at: legalNotice.effectiveAt,
      legal_jurisdiction: legalNotice.jurisdiction,
      legal_product_scope: legalNotice.productScope,
      legal_provenance_state: 'governed',
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
    // A same-origin download re-checks active AAL2 access on every request.
    // Do not issue a storage capability that could outlive revocation.
    signed_url: `/api/reports/${encodeURIComponent(report.id)}/download`,
    storage_path: storagePath,
    comparison_overall: clientComparison?.overall.status ?? null,
    engine_version_mismatch: engineVersionMismatch,
  })
}

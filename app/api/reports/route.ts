import { NextRequest, NextResponse } from 'next/server'
import { comparePostgresTimestamps } from '@/lib/time/postgres-timestamp'
import { createHash, randomUUID } from 'node:crypto'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { PostureReportPdf } from '@/lib/pdf/report'
import type { PdfFinding, PdfAssessment, PdfExercise } from '@/lib/pdf/report'
import { ClientReport } from '@/lib/pdf/clientReport'
import { buildProgramFrom } from '@/lib/program/buildProgram'
import { isCoherentForKey } from '@/lib/program/roleCoherence'
import { deriveExerciseRecommendations, type ZonedFinding } from '@/lib/exercises'
import { ALL_EXERCISES } from '@/content'
import { isNoRows } from '@/lib/api/query-error'
import { dbFindingsToEngineFindings, isCapability, type DbFindingRow } from '@/lib/reports/clientProgram'
import { buildClientComparison, type ClientComparison } from '@/lib/reports/clientComparison'
import { areEngineVersionsComparable } from '@/lib/comparison/policy'
import type { ReactElement } from 'react'
import type { DocumentProps } from '@react-pdf/renderer'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logEvent, hashResource, hashUser } from '@/lib/log'
import { resolveRuntimeLegalDocument } from '@/lib/legal/runtime'
import { snapshotLegalDocument } from '@/lib/legal/policy'
import { clinicalContentAccess } from '@/lib/clinical-content/runtime'
import { verifyClinicalContentAccess } from '@/lib/clinical-content/database'
import { clinicalContentUnavailableResponse } from '@/lib/clinical-content/http'

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await practitionerGate(supabase, user.id)
  if (gate) return gate
  const clinicalAccess = await verifyClinicalContentAccess(clinicalContentAccess(), supabase)

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
  if (variant === 'client' && !(clinicalAccess.surfaces.programs && clinicalAccess.surfaces.recommendations)) {
    return clinicalContentUnavailableResponse()
  }

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
      logEvent({ route: 'POST /api/reports', outcome: 'server_error', status: 500, userHash: hashUser(user.id), resourceHash: hashResource(assessment_id), detailCode: 'assessment_load_failed' })
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
    if (comparePostgresTimestamps(prior.assessed_at, assessment.assessed_at) !== -1) {
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
    logEvent({ route: 'POST /api/reports', outcome: 'server_error', status: 500, userHash: hashUser(user.id), resourceHash: hashResource(assessment_id), detailCode: 'findings_load_failed' })
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
  if (keys.length > 0 && clinicalAccess.mode === 'test_fixture' && clinicalAccess.surfaces.knowledgeLinks) {
    const { data: defs } = await createSupabaseServiceClient()
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
      logEvent({ route: 'POST /api/reports', outcome: 'server_error', status: 500, userHash: hashUser(user.id), resourceHash: hashResource(compared_to_assessment_id), detailCode: 'prior_findings_load_failed' })
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
  const exercises: PdfExercise[] = clinicalAccess.surfaces.recommendations
    ? deriveExerciseRecommendations(
        ALL_EXERCISES.filter((exercise) => clinicalAccess.approvedExerciseSlugs.includes(exercise.slug)),
        (findingsRaw || []) as unknown as ZonedFinding[],
        {
          isCoherentForKey: (exercise, key) => isCoherentForKey(
            exercise,
            key,
            new Set(clinicalAccess.approvedLinkIds),
          ),
        },
      ).map((ex) => ({
        name: ex.name,
        category: ex.category,
        instructions: ex.instructions,
        sets: ex.sets,
        hold_seconds: ex.holdSeconds,
      }))
    : []

  // Fetch practitioner
  const { data: practitioner } = await supabase
    .from('practitioners')
    .select('display_name, practice_name')
    .eq('id', user.id)
    .single()

  // Extract client info
  const clientsData = (assessment as unknown as {
    clients: { first_name: string | null; last_name: string | null }
      | { first_name: string | null; last_name: string | null }[]
      | null
  }).clients
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
        clinicalContent: {
          approvedExerciseSlugs: clinicalAccess.approvedExerciseSlugs,
          approvedLinkIds: clinicalAccess.approvedLinkIds,
          approvedReportCopyIds: clinicalAccess.approvedReportCopyIds,
        },
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
  const reportFetch: typeof fetch = (input, init) => {
    const timeout = AbortSignal.timeout(60_000)
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    return fetch(input, { ...init, signal })
  }
  const serviceSupabase = createSupabaseServiceClient({ fetch: reportFetch })
  const pdfSha256 = createHash('sha256').update(Buffer.from(pdfBuffer)).digest('hex')
  const storagePath = `${user.id}/${assessment_id}/${variant}/${pdfSha256}-${randomUUID()}.pdf`
  const cleanupIntent = {
    deletion_receipt_id: null,
    source_code: 'report_insert_compensation',
    bucket: 'posture-reports',
    object_path: storagePath,
    // Long enough for normal rendering/upload/finalization, short enough that a
    // crashed request does not leave an untracked PDF for long.
    next_attempt_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  }

  // Ensure bucket exists
  const { error: bucketErr } = await serviceSupabase.storage.createBucket('posture-reports', {
    public: false,
    allowedMimeTypes: ['application/pdf'],
  })
  if (bucketErr && !bucketErr.message?.includes('already exists') && !bucketErr.message?.includes('Duplicate')) {
    logEvent({ route: 'POST /api/reports', outcome: 'server_error', status: 0, userHash: hashUser(user.id), detailCode: 'report_bucket_check_failed' })
  }

  // Persist compensation BEFORE the external side effect. If the process or DB
  // dies after upload, the scheduled worker already knows the exact object path.
  const { error: intentError } = await serviceSupabase
    .from('privacy_storage_deletion_outbox')
    .insert(cleanupIntent)
  if (intentError) {
    logEvent({ route: 'POST /api/reports', outcome: 'server_error', status: 500, userHash: hashUser(user.id), resourceHash: hashResource(assessment_id), detailCode: 'report_cleanup_intent_failed' })
    return NextResponse.json({ error: 'Could not safely prepare report storage. Please retry.' }, { status: 500 })
  }

  const { error: uploadErr } = await serviceSupabase.storage
    .from('posture-reports')
    .upload(storagePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: false,
    })

  if (uploadErr) {
    // Provider errors can be commit-ambiguous: the object may exist even though
    // the response says the upload failed. Retain the intent; deleting a missing
    // object later is idempotent, while cancelling here could orphan a real PDF.
    logEvent({ route: 'POST /api/reports', outcome: 'server_error', status: 500, userHash: hashUser(user.id), resourceHash: hashResource(assessment_id), detailCode: 'report_upload_failed' })
    return NextResponse.json({ error: 'Failed to upload PDF.' }, { status: 500 })
  }

  // Persist the governed report row and cancel the pre-upload intent in one DB
  // transaction. Either both happen, or the intent remains available to retry.
  const reportScope = variant === 'client'
    ? 'clinical_client'
    : clinicalAccess.surfaces.recommendations || clinicalAccess.surfaces.knowledgeLinks
      ? 'clinical_practitioner'
      : 'assessment_only'
  const { data: finalizeData, error: reportErr } = await serviceSupabase.rpc(
    'finalize_report_upload_v2',
    {
      p_assessment_id: assessment_id,
      p_practitioner_id: user.id,
      p_storage_path: storagePath,
      // Record the comparison only when the report actually rendered one.
      p_compared_to_assessment_id: variant === 'client'
        ? (clientComparison ? compared_to_assessment_id : null)
        : (compared_to_assessment_id || null),
      p_document_id: legalNotice.documentId,
      p_document_version: legalNotice.version,
      p_document_body_sha256: legalNotice.bodySha256,
      p_document_effective_at: legalNotice.effectiveAt,
      p_jurisdiction: legalNotice.jurisdiction,
      p_product_scope: legalNotice.productScope,
      p_report_scope: reportScope,
      p_clinical_content_version: reportScope === 'assessment_only' ? null : clinicalAccess.contentVersion,
      p_clinical_inventory_sha256: reportScope === 'assessment_only' ? null : clinicalAccess.inventorySha256,
    },
  )
  const report = finalizeData as { status?: string; report_id?: string } | null

  if (reportErr || report?.status !== 'created' || !report.report_id) {
    // A lost RPC response is also commit-ambiguous. Never remove synchronously:
    // if finalization committed, its transaction deleted the intent and the PDF
    // belongs to a report; otherwise the still-durable intent cleans it later.
    logEvent({ route: 'POST /api/reports', outcome: 'server_error', status: 500, userHash: hashUser(user.id), resourceHash: hashResource(assessment_id), detailCode: 'report_finalize_unconfirmed' })
    return NextResponse.json({ error: 'Failed to record report. Please retry.' }, { status: 500 })
  }

  return NextResponse.json({
    report_id: report.report_id,
    // A same-origin download re-checks active AAL2 access on every request.
    // Do not issue a storage capability that could outlive revocation.
    signed_url: `/api/reports/${encodeURIComponent(report.report_id)}/download`,
    storage_path: storagePath,
    comparison_overall: clientComparison?.overall.status ?? null,
    engine_version_mismatch: engineVersionMismatch,
  })
}

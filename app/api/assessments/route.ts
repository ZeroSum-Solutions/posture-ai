import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { assessPosture, testLandmarksFrames } from '@posture-ai/engine'
import type { PoseFrame } from '@posture-ai/engine'
import { parseAssessmentPayload, MAX_PAYLOAD_BYTES } from '@/lib/validation/frames'
import { getConsentStatus, captureEligibility } from '@/lib/consent/record'
import { consentLegalProvenance } from '@/lib/consent/policy'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logEvent, hashUser } from '@/lib/log'
import { buildFindingRow } from '@/lib/findings/buildFindingRow'
import { buildCaptureRow } from '@/lib/captures/buildCaptureRow'
import { assessmentSubmissionDigest } from '@/lib/assessments/submission'
import { operationForPractitioner } from '@/lib/prototype/runtime'
import { ageBand, captureBlockReason } from '@/lib/clients/age'

const ROUTE = 'POST /api/assessments'
const TEST_MODE_ENABLED = process.env.POSTURE_TEST_MODE_ENABLED === '1'

export async function POST(req: NextRequest) {
  const started = Date.now()
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const gate = await practitionerGate(supabase, user.id)
    if (gate) return gate
    const operation = operationForPractitioner(user.id)
    const userHash = hashUser(user.id)

    // Enforce the size cap on the ACTUAL received body, not the client-supplied
    // Content-Length header — that header is absent on chunked / HTTP-2 requests
    // (routine on Vercel), where `?? 0` would skip the check and let an oversized
    // body buffer into JSON.parse before Zod's frame limits apply.
    let rawBody: ArrayBuffer
    try {
      rawBody = await req.arrayBuffer()
    } catch {
      logEvent({ route: ROUTE, outcome: 'client_error', status: 400, userHash })
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    if (rawBody.byteLength > MAX_PAYLOAD_BYTES) {
      logEvent({ route: ROUTE, outcome: 'client_error', status: 413, userHash })
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }

    let body: unknown
    try {
      body = JSON.parse(new TextDecoder().decode(rawBody))
    } catch {
      logEvent({ route: ROUTE, outcome: 'client_error', status: 400, userHash })
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = parseAssessmentPayload(body, { testModeEnabled: TEST_MODE_ENABLED })
    if (!parsed.ok) {
      logEvent({ route: ROUTE, outcome: 'client_error', status: parsed.status, userHash, detail: parsed.error })
      return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    }
    const { client_id, submission_id, useFixture } = parsed.data
    const submissionDigest = assessmentSubmissionDigest(parsed.data)

    const service = createSupabaseServiceClient()

    const allowed = await enforceRateLimit(service, {
      route: 'assessments', userId: user.id, limit: 20, windowSeconds: 60,
    })
    if (!allowed) {
      logEvent({ route: ROUTE, outcome: 'rate_limited', status: 429, userHash })
      return NextResponse.json({ error: 'Too many requests — try again shortly' }, { status: 429 })
    }

    // Verify client belongs to this practitioner and is not tombstoned (erased).
    // The assessments_reject_deleted_client trigger is the hard race-safe guard;
    // this gives a clean 404 instead of a DB-error 500 in the common case.
    const { data: client } = await service
      .from('clients')
      .select('id, date_of_birth')
      .eq('id', client_id)
      .eq('practitioner_id', user.id)
      .is('deleted_at', null)
      .maybeSingle()
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    if (operation.isPrototype) {
      // Prototype operation removes the consent-document business gate, not the
      // product's age boundary. Keep this server-side so a caller cannot bypass
      // the wizard and persist a screening for an ineligible client.
      const band = ageBand(client.date_of_birth)
      if (band === 'under_13') {
        const reason = captureBlockReason(band, false)
        logEvent({ route: ROUTE, outcome: 'client_error', status: 403, userHash, detail: reason ?? 'capture blocked' })
        return NextResponse.json({ error: reason }, { status: 403 })
      }
      try {
        const frames = (useFixture ? testLandmarksFrames : parsed.data.frames) as PoseFrame[]
        const result = assessPosture(frames)
        // The RPC ignores embedded ownership fields and supplies both ids from
        // its trusted scalar arguments. Reusing the existing mappers keeps the
        // same face minimization and finding provenance as governed capture.
        const captures = frames.map((frame) =>
          buildCaptureRow(frame, submission_id, user.id, { useFixture }),
        )
        const findings = result.findings.map((finding) =>
          buildFindingRow(finding, submission_id, user.id),
        )
        const { data, error } = await service.rpc('create_assessment_prototype', {
          p_client_id: client_id,
          p_practitioner_id: user.id,
          p_submission_id: submission_id,
          p_submission_digest: submissionDigest,
          p_captures: captures,
          p_findings: findings,
          p_overall_score: result.overallScore,
          p_overall_grade: result.overallGrade,
          p_scoring_engine_version: result.engineVersion,
          p_tilt_corrected: result.tiltCorrected,
          p_level_verified: result.levelVerified,
          p_capture_stability: result.captureStability ?? null,
        })
        if (error || !data || typeof data !== 'object') {
          throw new Error(error?.message ?? 'prototype assessment transaction failed')
        }
        const outcome = data as Record<string, unknown>
        const status = typeof outcome.status === 'string' ? outcome.status : ''
        const assessmentId = typeof outcome.assessment_id === 'string'
          ? outcome.assessment_id
          : null
        if (status === 'submission_conflict') {
          return NextResponse.json(
            { error: 'submission_id was already used for a different assessment payload' },
            { status: 409 },
          )
        }
        if (status === 'not_found') {
          return NextResponse.json({ error: 'Client not found' }, { status: 404 })
        }
        if (status === 'practitioner_unavailable') {
          return NextResponse.json({ error: 'Active practitioner access is required.' }, { status: 403 })
        }
        if (status === 'invalid_input') {
          return NextResponse.json({ error: 'Assessment data could not be saved.' }, { status: 422 })
        }
        if (assessmentId && ['processing', 'complete', 'failed'].includes(status)) {
          logEvent({
            route: ROUTE,
            outcome: 'ok',
            status: 200,
            userHash,
            assessmentId,
            durationMs: Date.now() - started,
            detail: outcome.replayed === true ? 'idempotent replay' : 'prototype transaction',
          })
          return NextResponse.json({
            id: assessmentId,
            status,
            ...(outcome.replayed === true ? { replayed: true } : { replayed: false }),
          })
        }
        throw new Error(`unexpected prototype assessment status: ${status || 'missing'}`)
      } catch (scoreErr) {
        // No assessment id exists when scoring or a child insert fails: the RPC
        // is one transaction, so there is no partial processing row to repair.
        logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, detail: String(scoreErr) })
        return NextResponse.json({ error: 'Scoring failed' }, { status: 500 })
      }
    }

    // Compliance gate (authoritative): a valid subject consent + the age policy
    // must be satisfied before any capture is persisted/scored. (BIPA pre-capture
    // consent; COPPA/minor: under-13 blocked, 13–17 needs guardian consent.)
    const consent = await getConsentStatus(service, client_id)
    if (consent.legalState === 'legal_unavailable') {
      logEvent({ route: ROUTE, outcome: 'server_error', status: 503, userHash, detail: 'subject consent legal document unavailable' })
      return NextResponse.json(
        { error: 'Consent terms are temporarily unavailable.', code: 'legal_unavailable' },
        { status: 503 },
      )
    }
    if (consent.legalState === 'reconsent_required') {
      logEvent({ route: ROUTE, outcome: 'client_error', status: 403, userHash, detail: 'subject reconsent required' })
      return NextResponse.json(
        { error: 'The subject must review and sign the current consent terms before screening.', code: 'reconsent_required' },
        { status: 403 },
      )
    }
    const eligibility = captureEligibility(client.date_of_birth, consent)
    if (!eligibility.ok) {
      logEvent({ route: ROUTE, outcome: 'client_error', status: 403, userHash, detail: eligibility.reason ?? 'capture blocked' })
      return NextResponse.json({ error: eligibility.reason }, { status: 403 })
    }
    if (!consent.document || consent.legalState !== 'current') {
      logEvent({ route: ROUTE, outcome: 'server_error', status: 503, userHash, detail: 'governed subject consent provenance unavailable' })
      return NextResponse.json(
        { error: 'Consent evidence is temporarily unavailable.', code: 'legal_unavailable' },
        { status: 503 },
      )
    }

    const findExistingSubmission = () => service
      .from('assessments')
      .select('id, status, submission_digest')
      .eq('practitioner_id', user.id)
      .eq('submission_id', submission_id)
      .maybeSingle()

    const replayResponse = (existing: { id: string; status: string; submission_digest: string | null }) => {
      if (existing.submission_digest !== submissionDigest) {
        logEvent({ route: ROUTE, outcome: 'client_error', status: 409, userHash, assessmentId: existing.id, detail: 'submission_id payload mismatch' })
        return NextResponse.json(
          { error: 'submission_id was already used for a different assessment payload' },
          { status: 409 },
        )
      }
      logEvent({ route: ROUTE, outcome: 'ok', status: 200, userHash, assessmentId: existing.id, detail: 'idempotent replay' })
      return NextResponse.json({ id: existing.id, status: existing.status, replayed: true })
    }

    // Fast replay path. The unique index remains the authority for simultaneous
    // requests that both pass this read before either insert commits.
    const { data: existing, error: existingErr } = await findExistingSubmission()
    if (existingErr) {
      logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, detail: existingErr.message })
      return NextResponse.json({ error: 'Failed to check assessment submission' }, { status: 500 })
    }
    if (existing) return replayResponse(existing)

    // Create assessment with status=processing
    const { data: assessment, error: insertErr } = await service
      .from('assessments')
      .insert({
        client_id,
        practitioner_id: user.id,
        submission_id,
        submission_digest: submissionDigest,
        status: 'processing',
        assessment_type: 'static',
        ...consentLegalProvenance(consent.document),
      })
      .select('id')
      .single()
    if (insertErr?.code === '23505') {
      // Concurrent same-key requests race at the unique index. Resolve the row
      // that won and apply the same digest check as the fast replay path.
      const { data: racedExisting, error: racedExistingErr } = await findExistingSubmission()
      if (!racedExistingErr && racedExisting) return replayResponse(racedExisting)
      logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, detail: racedExistingErr?.message ?? 'submission conflict row not found' })
      return NextResponse.json({ error: 'Failed to resolve assessment submission' }, { status: 500 })
    }
    if (insertErr || !assessment) {
      logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, detail: insertErr?.message })
      return NextResponse.json({ error: 'Failed to create assessment' }, { status: 500 })
    }

    const assessmentId = assessment.id

    // Run scoring engine on validated client frames (or the bundled fixture
    // when the server-side test flag explicitly allows it).
    try {
      const frames = (useFixture ? testLandmarksFrames : parsed.data.frames) as PoseFrame[]

      // Persist the captured pose frames (reproducible / re-scorable), with the
      // unused face-region keypoints stripped first (data minimization, BIPA).
      // Scoring above/below runs on the full in-memory frame; only what is saved
      // is minimized. Photo storage is handled by the separate authenticated
      // capture-image upload after this assessment has been created.
      const capturesToInsert = frames.map((f) =>
        buildCaptureRow(f, assessmentId, user.id, { useFixture }),
      )
      const { error: capErr } = await service.from('captures').insert(capturesToInsert)
      if (capErr) throw new Error(`captures insert failed: ${capErr.message}`)

      const result = assessPosture(frames)

      // Save findings (metric_validity stamped from threshold provenance)
      const findingsToInsert = result.findings.map((f) =>
        buildFindingRow(f, assessmentId, user.id),
      )

      // Every write is checked: an assessment must never read 'complete' while
      // its findings/captures silently failed to persist — a thrown error lands
      // in the catch below, which marks the assessment failed for the poller.
      const { error: findErr } = await service.from('assessment_findings').insert(findingsToInsert)
      if (findErr) throw new Error(`findings insert failed: ${findErr.message}`)

      // Update assessment to complete
      const { error: updErr } = await service
        .from('assessments')
        .update({
          status: 'complete',
          overall_score: result.overallScore,
          overall_grade: result.overallGrade,
          scoring_engine_version: result.engineVersion,
          tilt_corrected: result.tiltCorrected,
          level_verified: result.levelVerified,
          // null for single-frame captures (legacy path) — never fabricated.
          capture_stability: result.captureStability ?? null,
        })
        .eq('id', assessmentId)
      if (updErr) throw new Error(`status update failed: ${updErr.message}`)

      logEvent({ route: ROUTE, outcome: 'ok', status: 200, userHash, assessmentId, durationMs: Date.now() - started })
      return NextResponse.json({ id: assessmentId, status: 'complete' })
    } catch (scoreErr) {
      logEvent({ route: ROUTE, outcome: 'server_error', status: 200, userHash, assessmentId, detail: String(scoreErr) })
      const { error: failErr } = await service.from('assessments').update({ status: 'failed' }).eq('id', assessmentId)
      if (failErr) {
        // Even the failed-mark failed — the poller would spin on 'processing'
        // without this log + the client-side poll cap.
        logEvent({ route: ROUTE, outcome: 'server_error', status: 500, userHash, assessmentId, detail: `failed-mark failed: ${failErr.message}` })
      }
      return NextResponse.json({ id: assessmentId, status: 'failed', error: 'Scoring failed' })
    }
  } catch (err) {
    logEvent({ route: ROUTE, outcome: 'server_error', status: 500, detail: String(err) })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { practitionerGate } from '@/lib/auth/requirePractitioner'
import { assessPosture, testLandmarksFrames } from '@posture-ai/engine'
import type { PoseFrame } from '@posture-ai/engine'
import { parseAssessmentPayload, MAX_PAYLOAD_BYTES } from '@/lib/validation/frames'
import { stripFaceLandmarks } from '@/lib/pose/face-min'
import { getConsentStatus, captureEligibility } from '@/lib/consent/record'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logEvent, hashUser } from '@/lib/log'
import { buildFindingRow } from '@/lib/findings/buildFindingRow'

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
    const userHash = hashUser(user.id)

    const contentLength = Number(req.headers.get('content-length') ?? 0)
    if (contentLength > MAX_PAYLOAD_BYTES) {
      logEvent({ route: ROUTE, outcome: 'client_error', status: 413, userHash })
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      logEvent({ route: ROUTE, outcome: 'client_error', status: 400, userHash })
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = parseAssessmentPayload(body, { testModeEnabled: TEST_MODE_ENABLED })
    if (!parsed.ok) {
      logEvent({ route: ROUTE, outcome: 'client_error', status: parsed.status, userHash, detail: parsed.error })
      return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    }
    const { client_id, useFixture } = parsed.data

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

    // Compliance gate (authoritative): a valid subject consent + the age policy
    // must be satisfied before any capture is persisted/scored. (BIPA pre-capture
    // consent; COPPA/minor: under-13 blocked, 13–17 needs guardian consent.)
    const consent = await getConsentStatus(service, client_id)
    const eligibility = captureEligibility(client.date_of_birth, consent)
    if (!eligibility.ok) {
      logEvent({ route: ROUTE, outcome: 'client_error', status: 403, userHash, detail: eligibility.reason ?? 'capture blocked' })
      return NextResponse.json({ error: eligibility.reason }, { status: 403 })
    }

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
      // is minimized. storage_path is never set — no raw image bytes at rest.
      const capturesToInsert = frames.map((f) => ({
        assessment_id: assessmentId,
        practitioner_id: user.id,
        view: f.view,
        source: useFixture ? 'fixture' : (f.source ?? 'upload'),
        pose_frame: stripFaceLandmarks(f) as unknown as object,
      }))
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
          overall_percentile: result.overallPercentile,
          front_rank: result.ranks.front,
          side_rank: result.ranks.side,
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

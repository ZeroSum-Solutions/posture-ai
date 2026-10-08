#!/usr/bin/env node
/**
 * QA Seed — LOCAL SUPABASE ONLY
 * Usage:  npm run qa:seed
 *         npx vite-node scripts/qa-seed.ts
 *
 * Idempotent: deletes QA auth users (qa+*@example.test + the 3 practitioner
 * emails), truncates app tables in FK order, then reseeds. Deterministic via
 * mulberry32 PRNG, seed=42 — every run produces the same rows in the same order.
 *
 * NEVER run against production (URL check at startup aborts if not localhost).
 */

import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { assessPosture, testLandmarksFrames } from '@posture-ai/engine'
import { buildFindingRow } from '../lib/findings/buildFindingRow'
import { stripFaceLandmarks } from '../lib/pose/face-min'
import { hashConsentToken } from '../lib/consent/token'
import { LEGAL_DOCUMENT_FIXTURES } from '../content/legal/fixtures'
import clinicalContentInventory from '../content/clinical-content-inventory.json'
import { resolveLegalDocument, snapshotLegalDocument } from '../lib/legal/policy'
import { LEGAL_CONTEXT_BY_KIND, type LegalDocumentKind } from '../lib/legal/types'
import {
  activateLocalPractitionerAal2,
  provisionLocalInvitedPractitioner,
} from '../e2e/helpers/practitioner-auth'

// ─────────────────────────────────────────────────────────────
// Config — resolved from THIS project's running local stack. Several projects
// share the machine with different Supabase ports, so never hardcode them: a
// fixed 54321/54322 points at whichever stack owns those ports.
// ─────────────────────────────────────────────────────────────
function localStack() {
  const out = execFileSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const env = Object.fromEntries([...out.matchAll(/^([A-Z_]+)="(.*)"$/gm)].map(m => [m[1], m[2]]))
  const required = ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'DB_URL'] as const
  for (const key of required) {
    if (!env[key]) throw new Error(`supabase status did not report ${key}; is the local stack running?`)
  }
  return { url: env.API_URL!, anonKey: env.ANON_KEY!, serviceRoleKey: env.SERVICE_ROLE_KEY!, dbUrl: env.DB_URL! }
}

const isLoopback = (raw: string) => ['127.0.0.1', 'localhost'].includes(new URL(raw).hostname)
const stack = localStack()
const SUPABASE_URL = stack.url
const SERVICE_ROLE_KEY = stack.serviceRoleKey
const ANON_KEY = stack.anonKey
const DB_URL = stack.dbUrl

if (!isLoopback(SUPABASE_URL) || !isLoopback(DB_URL)) {
  console.error('ABORT: the Supabase API or database is not on loopback. Refusing to seed.')
  process.exit(1)
}
console.log(`Seeding local stack ${SUPABASE_URL} (db port ${new URL(DB_URL).port})`)

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const pool = new pg.Pool({ connectionString: DB_URL })
const runSql = (text: string, values?: unknown[]) => pool.query(text, values)

// ─────────────────────────────────────────────────────────────
// PRNG — mulberry32, seed=42
// ─────────────────────────────────────────────────────────────
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(42)
const rInt = (n: number) => Math.floor(rand() * n)
const rRange = (lo: number, hi: number) => lo + rInt(hi - lo + 1)
const rPick = <T>(arr: readonly T[]): T => arr[rInt(arr.length)]
const rBool = (p = 0.5) => rand() < p

// ─────────────────────────────────────────────────────────────
// Fake-data tables
// ─────────────────────────────────────────────────────────────
const FIRSTS = [
  'Alice', 'Bob', 'Carol', 'David', 'Emma', 'Frank', 'Grace', 'Henry', 'Iris', 'Jack',
  'Kate', 'Liam', 'Maya', 'Noah', 'Olivia', 'Paul', 'Quinn', 'Rachel', 'Sam', 'Tara',
  'Uma', 'Victor', 'Wendy', 'Xander', 'Yara', 'Zoe', 'Adrian', 'Beth', 'Carl', 'Diana',
  'Ethan', 'Fiona', 'George', 'Hannah', 'Ivan', 'Julia', 'Kevin', 'Laura', 'Mike', 'Nancy',
  'Oscar', 'Pam', 'Raj', 'Sofia', 'Tom', 'Ursula', 'Vince', 'Wren', 'Xavier', 'Yuki',
  'Zara', 'Aaron', 'Bella', 'Chris', 'Dana', 'Eli', 'Faye', 'Grant', 'Haley', 'Ian',
  'Jade', 'Kurt', 'Leah', 'Marco', 'Nina', 'Otto', 'Petra', 'Rex', 'Sara', 'Tyler',
]
const LASTS = [
  'Smith', 'Jones', 'Williams', 'Brown', 'Taylor', 'Davies', 'Evans', 'Wilson', 'Thomas', 'Roberts',
  'Johnson', 'Lewis', 'Walker', 'Robinson', 'Wood', 'Thompson', 'White', 'Watson', 'Jackson', 'Harris',
  'Martin', 'Perez', 'Garcia', 'Martinez', 'Anderson', 'Clark', 'Rodriguez', 'Lee', 'Gonzalez', 'Hill',
  'Baker', 'Hall', 'Allen', 'Young', 'King', 'Wright', 'Scott', 'Green', 'Adams', 'Nelson',
]
const SEX_OPTIONS = ['male', 'female', 'other', 'prefer_not_to_say'] as const

let _nameIdx = 0
function nextName(): { first: string; last: string } {
  const i = _nameIdx++
  return {
    first: FIRSTS[i % FIRSTS.length],
    last: LASTS[Math.floor(i / FIRSTS.length) % LASTS.length],
  }
}

/** ISO date string from today minus the given number of years (roughly). */
function dobYearsAgo(years: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years, d.getMonth() - rInt(12), d.getDate() - rInt(28))
  return d.toISOString().split('T')[0]
}

function pastDate(daysAgo: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d
}

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

// ─────────────────────────────────────────────────────────────
// Engine — run once; reuse result for every assessment
// ─────────────────────────────────────────────────────────────
console.log('Running posture engine on fixture frames…')
const ENGINE_RESULT = assessPosture(testLandmarksFrames)
const STRIPPED_FRAMES = testLandmarksFrames.map(f => stripFaceLandmarks(f))
console.log(`Engine OK — score ${ENGINE_RESULT.overallScore}, grade ${ENGINE_RESULT.overallGrade}, ${ENGINE_RESULT.findings.length} findings`)

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const CONSENT_VERSION = '1.0'
const PRAC_PASSWORD = 'TestPass1234!'
const CLINICAL_CONTENT_VERSION = 'clinical-content-test-fixture-v1'
const CLINICAL_REVIEW_RECEIPT_SHA256 = 'f'.repeat(64)
const PRACTITIONER_DOCUMENT_KINDS = [
  'terms',
  'privacy',
  'screening_notice',
] as const satisfies readonly LegalDocumentKind[]
const qaPractitionerCredentials: Array<{
  email: string
  password: string
  totp_secret: string
}> = []
const EXERCISE_SLUGS = [
  'cervical-retraction', 'chin-tuck', 'cat-cow', 'bird-dog', 'childs-pose-reach',
  'band-pull-apart', 'butterfly-stretch', 'bent-knee-calf-stretch', 'band-hip-hinge-pull-through',
]

function makeSnapshot(week: number, capability: string, estimatedDurationSec: number): object {
  const exCount = rRange(3, 6)
  const items = Array.from({ length: exCount }, (_, i) => ({
    slug: EXERCISE_SLUGS[i % EXERCISE_SLUGS.length],
    sets: rRange(2, 4),
    holdSeconds: rPick([20, 30, 45, 60]),
    name: `Exercise ${i + 1}`,
  }))
  return {
    version: 3,
    week,
    capability,
    priorities: [],
    items,
    estimatedDurationSec,
    clinicalContent: {
      version: CLINICAL_CONTENT_VERSION,
      inventorySha256: clinicalContentInventory.inventory_sha256,
    },
  }
}

// ─────────────────────────────────────────────────────────────
// Cleanup — delete QA users + truncate app tables
// ─────────────────────────────────────────────────────────────
async function cleanup() {
  console.log('Cleaning up existing QA data…')

  // Truncate app tables FIRST (children before parents, respecting FKs).
  // Must happen before auth user deletion so practitioners FK is clear.
  await runSql(`
    TRUNCATE TABLE
      workout_share_events,
      workout_ratings,
      session_runs,
      workout_sessions,
      client_deletion_log,
      consent_tokens,
      consent_records,
      assessment_findings,
      exercise_recommendations,
      captures,
      reports,
      assessments,
      clients,
      practitioners
    RESTART IDENTITY CASCADE
  `)
  console.log('  App tables truncated')

  // Remove only the disposable QA invitation audit rows before Auth deletion.
  // Accepted invitations intentionally retain their user binding, so Auth's
  // ON DELETE SET NULL cannot satisfy the invitation shape constraint by itself.
  await runSql(`
    DELETE FROM private.practitioner_access_events
     WHERE invitation_id IN (
       SELECT id FROM private.practitioner_invitations
        WHERE email_normalized LIKE 'qa+%@example.test'
     )
  `)
  const deletedInvitations = await runSql(
    `DELETE FROM private.practitioner_invitations
      WHERE email_normalized LIKE 'qa+%@example.test'
      RETURNING email_normalized`
  )
  console.log(`  Deleted ${deletedInvitations.rowCount} QA invitation(s)`)

  // Now delete QA auth users directly via SQL (no auth-layer caching delay).
  const deleted = await runSql(
    `DELETE FROM auth.users WHERE email LIKE 'qa+%@example.test' RETURNING email`
  )
  console.log(`  Deleted ${deleted.rowCount} QA auth user(s): ${deleted.rows.map((r: { email: string }) => r.email).join(', ') || 'none'}`)
}

// ─────────────────────────────────────────────────────────────
// Practitioner creation
// ─────────────────────────────────────────────────────────────
async function seedQaLegalAcceptances(practitionerId: string) {
  const acceptedAt = new Date().toISOString()
  const rows = PRACTITIONER_DOCUMENT_KINDS.map((kind) => {
    const resolution = resolveLegalDocument({
      documents: LEGAL_DOCUMENT_FIXTURES,
      kind,
      context: LEGAL_CONTEXT_BY_KIND[kind],
      at: new Date(),
      allowFixtures: true,
    })
    if (!resolution.ok) throw new Error(`QA legal document unavailable: ${kind}`)
    const document = snapshotLegalDocument(resolution.document)
    return {
      practitioner_id: practitionerId,
      legal_document_id: document.documentId,
      legal_document_version: document.version,
      legal_document_body_sha256: document.bodySha256,
      legal_document_effective_at: document.effectiveAt,
      legal_jurisdiction: document.jurisdiction,
      legal_product_scope: document.productScope,
      acceptance_context: 'local_qa_seed_v1',
      acceptance_method: 'automated_test_fixture',
      accepted_at: acceptedAt,
    }
  })
  const { error } = await supabase
    .from('practitioner_legal_acceptances')
    .upsert(rows, {
      onConflict: 'practitioner_id,legal_document_id,legal_document_version,legal_document_body_sha256,legal_document_effective_at,legal_jurisdiction,legal_product_scope,acceptance_context',
      ignoreDuplicates: true,
    })
  if (error) throw new Error(`QA legal acceptance seed failed: ${error.message}`)
}

async function createPractitioner(email: string, displayName: string): Promise<string> {
  const user = await provisionLocalInvitedPractitioner({
    admin: supabase,
    supabaseUrl: SUPABASE_URL,
    email,
    password: PRAC_PASSWORD,
    displayName,
  })

  const fixtureClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: signInError } = await fixtureClient.auth.signInWithPassword({
    email,
    password: PRAC_PASSWORD,
  })
  if (signInError) throw new Error(`QA practitioner sign-in failed: ${signInError.message}`)
  const totpSecret = await activateLocalPractitionerAal2(fixtureClient)
  await fixtureClient.auth.signOut({ scope: 'global' })
  const userId = user.id

  // Set non_diagnostic_ack_at so they're past onboarding
  const { error: updErr } = await supabase
    .from('practitioners')
    .update({ non_diagnostic_ack_at: pastDate(60).toISOString(), display_name: displayName })
    .eq('id', userId)
  if (updErr) throw new Error(`practitioners update ${email}: ${updErr.message}`)

  await seedQaLegalAcceptances(userId)
  qaPractitionerCredentials.push({ email, password: PRAC_PASSWORD, totp_secret: totpSecret })

  console.log(`  Created practitioner ${email} → ${userId}`)
  return userId
}

// ─────────────────────────────────────────────────────────────
// Assessment creation (real engine output)
// ─────────────────────────────────────────────────────────────
async function createAssessment(
  clientId: string,
  practitionerId: string,
  opts: { approved: boolean; daysAgo: number }
): Promise<string> {
  const { approved, daysAgo } = opts

  const { data, error } = await supabase
    .from('assessments')
    .insert({
      client_id: clientId,
      practitioner_id: practitionerId,
      status: 'complete',
      assessment_type: 'static',
      overall_score: ENGINE_RESULT.overallScore,
      overall_grade: ENGINE_RESULT.overallGrade,
      scoring_engine_version: ENGINE_RESULT.engineVersion,
      tilt_corrected: ENGINE_RESULT.tiltCorrected,
      level_verified: ENGINE_RESULT.levelVerified,
      capture_stability: ENGINE_RESULT.captureStability ?? null,
      practitioner_approved: approved,
      practitioner_approved_at: approved ? new Date().toISOString() : null,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(`assessment insert: ${error?.message}`)
  const assessmentId = data.id

  // Captures (storage_path must be NULL per DB constraint)
  const captureRows = STRIPPED_FRAMES.map(f => ({
    assessment_id: assessmentId,
    practitioner_id: practitionerId,
    view: f.view,
    source: 'fixture',
    storage_path: null,
    pose_frame: f as unknown as object,
  }))
  const { error: capErr } = await supabase.from('captures').insert(captureRows)
  if (capErr) throw new Error(`captures insert: ${capErr.message}`)

  // Findings (canonical buildFindingRow logic, same as production API)
  const findingRows = ENGINE_RESULT.findings.map(f =>
    buildFindingRow(f, assessmentId, practitionerId)
  )
  const { error: findErr } = await supabase.from('assessment_findings').insert(findingRows)
  if (findErr) throw new Error(`findings insert: ${findErr.message}`)

  // Backdate timestamps via direct SQL
  const ts = pastDate(daysAgo)
  await runSql(
    `UPDATE assessments SET created_at = $1::timestamptz, assessed_at = $1::timestamptz WHERE id = $2`,
    [ts.toISOString(), assessmentId]
  )
  if (approved) {
    await runSql(
      `UPDATE assessments SET practitioner_approved_at = $1::timestamptz WHERE id = $2`,
      [ts.toISOString(), assessmentId]
    )
  }

  return assessmentId
}

// ─────────────────────────────────────────────────────────────
// Consent helpers
// ─────────────────────────────────────────────────────────────
async function grantConsent(
  clientId: string,
  practitionerId: string,
  opts: { daysAgo?: number; relationship?: string } = {}
) {
  const daysAgo = opts.daysAgo ?? 30
  const relationship = opts.relationship ?? 'self'
  const ts = pastDate(daysAgo)
  const consentHash = sha256hex(`consent:${clientId}:${CONSENT_VERSION}:${daysAgo}`)

  await supabase.from('consent_records').insert({
    client_id: clientId,
    practitioner_id: practitionerId,
    kind: 'enrollment',
    consent_version: CONSENT_VERSION,
    consent_hash: consentHash,
    signer_name: relationship === 'self' ? 'Client Signature' : 'Guardian Signature',
    signer_relationship: relationship,
    method: 'e_signature',
    signed_at: ts.toISOString(),
    recorded_at: ts.toISOString(),
  })
  await runSql(
    'UPDATE clients SET consent_recorded_at=$1 WHERE id=$2',
    [ts, clientId]
  )
}

async function revokeConsent(clientId: string, practitionerId: string, daysAgo = 5) {
  // Insert a revocation record
  const ts = pastDate(daysAgo)
  const consentHash = sha256hex(`revoke:${clientId}:${CONSENT_VERSION}:${daysAgo}`)
  await supabase.from('consent_records').insert({
    client_id: clientId,
    practitioner_id: practitionerId,
    kind: 'revocation',
    consent_version: CONSENT_VERSION,
    consent_hash: consentHash,
    signer_name: 'Client Signature',
    signer_relationship: 'self',
    method: 'e_signature',
    signed_at: ts.toISOString(),
    recorded_at: ts.toISOString(),
    revoked_at: ts.toISOString(),
  })
}

async function mintConsentToken(
  clientId: string,
  practitionerId: string,
  opts: { expired?: boolean } = {}
): Promise<string> {
  const rawToken = `token-${sha256hex(clientId + practitionerId + String(rand())).substring(0, 32)}`
  const expiresAt = opts.expired
    ? pastDate(3)  // expired 3 days ago
    : pastDate(-7) // expires 7 days from now
  await supabase.from('consent_tokens').insert({
    token_hash: hashConsentToken(rawToken),
    client_id: clientId,
    practitioner_id: practitionerId,
    consent_version: CONSENT_VERSION,
    expires_at: expiresAt.toISOString(),
  })
  return rawToken
}

// ─────────────────────────────────────────────────────────────
// Workout session helpers
// ─────────────────────────────────────────────────────────────
async function mintWorkoutSession(
  assessmentId: string,
  clientId: string,
  practitionerId: string,
  opts: {
    week?: number
    capability?: string
    withRun?: boolean
    completed?: boolean
    rated?: boolean
    shareState?: 'active' | 'expired' | 'revoked' | 'none'
    daysAgo?: number
  } = {}
): Promise<string> {
  const {
    week = rRange(1, 3),
    capability = rPick(['regression', 'standard', 'progression']),
    withRun = false,
    completed = false,
    rated = false,
    shareState = 'none',
    daysAgo = rRange(1, 30),
  } = opts

  // Raw share token + hash (if share link requested)
  let sessionTokenHash: string | null = null
  let rawShareToken: string | null = null
  if (shareState !== 'none') {
    rawShareToken = sha256hex(`share:${assessmentId}:${String(rand())}`).substring(0, 48)
    sessionTokenHash = sha256hex(rawShareToken)
  }

  // Revoked fixtures are first minted as live credentials and then revoked
  // below. Directly inserting an already-revoked credential would bypass the
  // monotonic share lifecycle that production enforces.
  const sessionStatus = 'active'
  const expiresAt =
    shareState === 'active' ? pastDate(-14).toISOString()  // active: 14 days from now
    : shareState === 'expired' ? pastDate(2).toISOString() // expired: 2 days ago
    : shareState === 'revoked' ? pastDate(-7).toISOString() // revoked: would have been valid
    : null

  const estimatedDurationSec = rRange(600, 1800)
  const { data: ws, error: wsErr } = await supabase
    .from('workout_sessions')
    .insert({
      assessment_id: assessmentId,
      client_id: clientId,
      practitioner_id: practitionerId,
      week,
      capability,
      program_snapshot: makeSnapshot(week, capability, estimatedDurationSec),
      session_token_hash: sessionTokenHash,
      status: completed ? 'completed' : sessionStatus,
      estimated_duration_sec: estimatedDurationSec,
      expires_at: expiresAt,
      revoked_at: null,
      clinical_content_version: CLINICAL_CONTENT_VERSION,
      clinical_inventory_sha256: clinicalContentInventory.inventory_sha256,
      clinical_review_receipt_sha256: CLINICAL_REVIEW_RECEIPT_SHA256,
    })
    .select('id')
    .single()

  if (wsErr || !ws) throw new Error(`workout_session insert: ${wsErr?.message}`)
  const sessionId = ws.id

  // Backdate session created_at
  await runSql(
    'UPDATE workout_sessions SET created_at=$1 WHERE id=$2',
    [pastDate(daysAgo), sessionId]
  )

  // Mint share event
  if (shareState !== 'none') {
    await supabase.from('workout_share_events').insert({
      workout_session_id: sessionId,
      practitioner_id: practitionerId,
      event: 'minted',
      actor: null,
      actor_code: 'practitioner',
      reason_code: 'practitioner_action',
      operation_id: sessionId,
      share_generation: 1,
    })
    if (shareState === 'revoked') {
      const { error: revokeError } = await supabase
        .from('workout_sessions')
        .update({
          session_token_hash: null,
          expires_at: null,
          status: 'revoked',
          revoked_at: pastDate(1).toISOString(),
        })
        .eq('id', sessionId)
      if (revokeError) throw new Error(`workout_session revoke: ${revokeError.message}`)
      await supabase.from('workout_share_events').insert({
        workout_session_id: sessionId,
        practitioner_id: practitionerId,
        event: 'revoked',
        actor: null,
        actor_code: 'practitioner',
        reason_code: 'practitioner_action',
        operation_id: assessmentId,
        share_generation: 1,
      })
    }
  }

  // Session run
  if (withRun || completed || rated) {
    const runStatus = completed ? 'completed' : 'in_progress'
    const items = [
      { slug: 'bird-dog', completed: completed, skipped: false, durationMs: completed ? 45000 : 0 },
      { slug: 'cat-cow', completed: false, skipped: false, durationMs: 0 },
    ]
    const { data: run, error: runErr } = await supabase
      .from('session_runs')
      .insert({
        workout_session_id: sessionId,
        practitioner_id: practitionerId,
        status: runStatus,
        current_item_index: completed ? items.length : 1,
        items,
        total_duration_ms: completed ? 90000 : null,
        completed_at: completed ? new Date().toISOString() : null,
        revision: completed ? 2 : 1,
      })
      .select('id')
      .single()

    if (runErr || !run) throw new Error(`session_run insert: ${runErr?.message}`)
    const runId = run.id

    if (rated) {
      await supabase.from('workout_ratings').insert({
        session_run_id: runId,
        workout_session_id: sessionId,
        client_id: clientId,
        practitioner_id: practitionerId,
        clarity: rRange(3, 5),
        pace: rPick(['too_slow', 'just_right', 'too_fast']),
        difficulty: rPick(['too_easy', 'just_right', 'too_hard']),
        feedback_tags: [],
      })
    }
  }

  return sessionId
}

// ─────────────────────────────────────────────────────────────
// Tombstone a client (set deleted_at + write deletion log)
// ─────────────────────────────────────────────────────────────
async function tombstoneClient(
  clientId: string,
  practitionerId: string,
) {
  const deletedAt = pastDate(rRange(1, 10))
  const { data, error } = await supabase.rpc('erase_client_transactional', {
    p_client_id: clientId,
    p_practitioner_id: practitionerId,
    p_reason_code: 'practitioner_correction',
    p_erased_at: deletedAt.toISOString(),
  })
  const status = (data as { status?: string } | null)?.status
  if (error || status !== 'database_erased') {
    throw new Error(`QA client erasure failed: ${error?.message ?? status ?? 'unknown'}`)
  }
}

// ─────────────────────────────────────────────────────────────
// Main seeder
// ─────────────────────────────────────────────────────────────

interface ClientSpec {
  ageYears: number
  consentState: 'granted' | 'declined' | 'pending_link' | 'expired_link' | 'minor_guardian' | 'under13_none'
  assessmentCount: number
  tombstone?: boolean
}

async function seedClients(
  practitionerId: string,
  specs: ClientSpec[],
  emailOffset: number
): Promise<{ total: { clients: number; assessments: number; approvedAssessments: string[] } }> {
  let totalAssessments = 0
  const approvedAssessments: string[] = []

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]
    const { first, last } = nextName()
    const email = `qa+client-${emailOffset + i}@example.test`
    const dob = spec.ageYears > 0 ? dobYearsAgo(spec.ageYears) : undefined
    const sex = rPick(SEX_OPTIONS)

    const { data: clientData, error: clientErr } = await supabase
      .from('clients')
      .insert({
        practitioner_id: practitionerId,
        first_name: first,
        last_name: last,
        date_of_birth: dob ?? null,
        sex_at_birth: sex,
        height_cm: rRange(155, 190),
        weight_kg: rRange(55, 100),
        notes: rBool(0.3) ? 'QA seed client' : null,
      })
      .select('id')
      .single()

    if (clientErr || !clientData) throw new Error(`client insert: ${clientErr?.message}`)
    const clientId = clientData.id

    // Backdate client created_at
    await runSql(
      'UPDATE clients SET created_at=$1, updated_at=$1 WHERE id=$2',
      [pastDate(rRange(30, 180)), clientId]
    )

    // Consent state
    switch (spec.consentState) {
      case 'granted':
        await grantConsent(clientId, practitionerId, { daysAgo: rRange(14, 90) })
        break
      case 'declined':
        await revokeConsent(clientId, practitionerId, rRange(5, 30))
        break
      case 'pending_link':
        await mintConsentToken(clientId, practitionerId, { expired: false })
        break
      case 'expired_link':
        await mintConsentToken(clientId, practitionerId, { expired: true })
        break
      case 'minor_guardian':
        await grantConsent(clientId, practitionerId, {
          daysAgo: rRange(14, 60),
          relationship: 'parent',
        })
        break
      case 'under13_none':
        // No consent created — under-13 is blocked by the app layer
        break
    }

    // Assessments (only for consented clients)
    const canAssess = ['granted', 'minor_guardian'].includes(spec.consentState)
    const assessmentIds: string[] = []

    if (canAssess && spec.assessmentCount > 0) {
      for (let a = 0; a < spec.assessmentCount; a++) {
        // Spread over 6 months — newer assessments for later indices
        const daysAgo = rRange(1, 180 - a * Math.floor(160 / spec.assessmentCount))
        const isApproved = rBool(0.6) // 60% approved, 40% draft
        const assessmentId = await createAssessment(clientId, practitionerId, {
          approved: isApproved,
          daysAgo,
        })
        assessmentIds.push(assessmentId)
        if (isApproved) approvedAssessments.push(assessmentId)
        totalAssessments++
      }
    }

    // Tombstone (must happen AFTER assessments are created, due to trigger)
    if (spec.tombstone && assessmentIds.length > 0) {
      await tombstoneClient(clientId, practitionerId)
    }
  }

  return { total: { clients: specs.length, assessments: totalAssessments, approvedAssessments } }
}

// ─────────────────────────────────────────────────────────────
// Workout session seeding (for a set of approved assessment ids)
// ─────────────────────────────────────────────────────────────
async function seedWorkoutSessions(
  assessmentIds: string[],
  clientsByAssessment: Map<string, string>,
  practitionerId: string
) {
  let minted = 0, partRun = 0, completed = 0, rated = 0
  let shareActive = 0, shareExpired = 0, shareRevoked = 0

  for (const assessmentId of assessmentIds) {
    const clientId = clientsByAssessment.get(assessmentId)
    if (!clientId) continue
    // Randomly choose session pattern
    const pattern = rInt(7)
    if (pattern === 0) {
      // minted only
      await mintWorkoutSession(assessmentId, clientId, practitionerId, { shareState: 'none' })
      minted++
    } else if (pattern === 1) {
      // part-run
      await mintWorkoutSession(assessmentId, clientId, practitionerId, { withRun: true })
      partRun++
    } else if (pattern === 2) {
      // completed
      await mintWorkoutSession(assessmentId, clientId, practitionerId, { completed: true })
      completed++
    } else if (pattern === 3) {
      // rated
      await mintWorkoutSession(assessmentId, clientId, practitionerId, { completed: true, rated: true })
      rated++
    } else if (pattern === 4) {
      // active share link
      await mintWorkoutSession(assessmentId, clientId, practitionerId, { shareState: 'active' })
      shareActive++
    } else if (pattern === 5) {
      // expired share link
      await mintWorkoutSession(assessmentId, clientId, practitionerId, { shareState: 'expired' })
      shareExpired++
    } else {
      // revoked share link
      await mintWorkoutSession(assessmentId, clientId, practitionerId, { shareState: 'revoked' })
      shareRevoked++
    }
  }

  return { minted, partRun, completed, rated, shareActive, shareExpired, shareRevoked }
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════')
  console.log('  QA Seed — LOCAL Supabase only')
  console.log('══════════════════════════════════════\n')

  await cleanup()

  // ── Practitioners ──────────────────────────────────────────
  console.log('\nCreating practitioners…')
  const pracEmptyId = await createPractitioner('qa+prac-empty@example.test', 'Dr. Empty State')
  const pracTypicalId = await createPractitioner('qa+prac-typical@example.test', 'Dr. Typical Clinic')
  const pracHeavyId = await createPractitioner('qa+prac-heavy@example.test', 'Dr. Heavy Load')

  // ── prac-empty: 0 clients ──────────────────────────────────
  console.log('\n[prac-empty] 0 clients — no seed needed')

  // ── prac-typical: 30 clients, ~100 assessments ─────────────
  console.log('\n[prac-typical] Seeding 30 clients…')
  const typicalSpecs: ClientSpec[] = [
    // Adults with consent + multi-assessment (progress trend)
    ...Array.from({ length: 4 }, () => ({ ageYears: rRange(25, 55), consentState: 'granted' as const, assessmentCount: rRange(3, 5) })),
    // Adults with consent + single assessment
    ...Array.from({ length: 15 }, () => ({ ageYears: rRange(22, 65), consentState: 'granted' as const, assessmentCount: 1 })),
    // Minors (13-17) needing guardian consent
    { ageYears: 15, consentState: 'minor_guardian', assessmentCount: 1 },
    { ageYears: 14, consentState: 'minor_guardian', assessmentCount: 2 },
    { ageYears: 17, consentState: 'minor_guardian', assessmentCount: 1 },
    // Under-13 (blocked — no assessment)
    { ageYears: 10, consentState: 'under13_none', assessmentCount: 0 },
    // Declined consent (no assessment)
    { ageYears: rRange(28, 50), consentState: 'declined', assessmentCount: 0 },
    { ageYears: rRange(28, 50), consentState: 'declined', assessmentCount: 0 },
    // Pending consent link (not yet responded)
    { ageYears: rRange(30, 45), consentState: 'pending_link', assessmentCount: 0 },
    // Expired consent link
    { ageYears: rRange(25, 50), consentState: 'expired_link', assessmentCount: 0 },
    // Tombstone: approved assessment then client deleted
    { ageYears: rRange(30, 55), consentState: 'granted', assessmentCount: 1, tombstone: true },
    { ageYears: rRange(30, 55), consentState: 'granted', assessmentCount: 2, tombstone: true },
  ]

  // Pad to exactly 30
  while (typicalSpecs.length < 30) {
    typicalSpecs.push({ ageYears: rRange(22, 65), consentState: 'granted', assessmentCount: rBool(0.7) ? 1 : 2 })
  }
  const typicalSpecs30 = typicalSpecs.slice(0, 30)

  const typicalResult = await seedClients(pracTypicalId, typicalSpecs30, 0)
  console.log(`  ${typicalResult.total.clients} clients, ${typicalResult.total.assessments} assessments`)

  // Build clientId map for approved assessments (typical) — exclude tombstoned clients
  const typicalClientMap = new Map<string, string>()
  {
    const { data: rows } = await supabase
      .from('assessments')
      .select('id, client_id, clients!inner(deleted_at)')
      .eq('practitioner_id', pracTypicalId)
      .eq('practitioner_approved', true)
      .is('clients.deleted_at', null)
    for (const r of rows ?? []) typicalClientMap.set(r.id, r.client_id)
  }

  // Seed workout sessions for typical approved assessments
  const typicalWS = await seedWorkoutSessions(
    [...typicalClientMap.keys()],
    typicalClientMap,
    pracTypicalId
  )
  console.log(`  Workout sessions: ${JSON.stringify(typicalWS)}`)

  // ── prac-heavy: 150 clients, ~300 assessments ──────────────
  console.log('\n[prac-heavy] Seeding 150 clients…')
  const heavySpecs: ClientSpec[] = [
    // Adults with multi-assessments (large bulk)
    ...Array.from({ length: 10 }, () => ({ ageYears: rRange(25, 60), consentState: 'granted' as const, assessmentCount: rRange(3, 6) })),
    // Adults with 2 assessments
    ...Array.from({ length: 30 }, () => ({ ageYears: rRange(20, 70), consentState: 'granted' as const, assessmentCount: 2 })),
    // Adults with single assessment (bulk)
    ...Array.from({ length: 72 }, () => ({ ageYears: rRange(18, 75), consentState: 'granted' as const, assessmentCount: 1 })),
    // Minors (13-17) with guardian consent
    ...Array.from({ length: 8 }, (_, i) => ({ ageYears: 13 + (i % 5), consentState: 'minor_guardian' as const, assessmentCount: 1 })),
    // Under-13 (no assessment)
    ...Array.from({ length: 5 }, () => ({ ageYears: rRange(5, 12), consentState: 'under13_none' as const, assessmentCount: 0 })),
    // Declined consent
    ...Array.from({ length: 8 }, () => ({ ageYears: rRange(25, 55), consentState: 'declined' as const, assessmentCount: 0 })),
    // Pending links
    ...Array.from({ length: 6 }, () => ({ ageYears: rRange(28, 50), consentState: 'pending_link' as const, assessmentCount: 0 })),
    // Expired links
    ...Array.from({ length: 4 }, () => ({ ageYears: rRange(25, 50), consentState: 'expired_link' as const, assessmentCount: 0 })),
    // Tombstones
    ...Array.from({ length: 7 }, () => ({ ageYears: rRange(28, 60), consentState: 'granted' as const, assessmentCount: rRange(1, 3), tombstone: true })),
  ]

  // Pad/trim to 150
  while (heavySpecs.length < 150) {
    heavySpecs.push({ ageYears: rRange(22, 65), consentState: 'granted', assessmentCount: 1 })
  }
  const heavySpecs150 = heavySpecs.slice(0, 150)

  const heavyResult = await seedClients(pracHeavyId, heavySpecs150, 1000)
  console.log(`  ${heavyResult.total.clients} clients, ${heavyResult.total.assessments} assessments`)

  // Build clientId map for approved assessments (heavy) — exclude tombstoned clients
  const heavyClientMap = new Map<string, string>()
  {
    const { data: rows } = await supabase
      .from('assessments')
      .select('id, client_id, clients!inner(deleted_at)')
      .eq('practitioner_id', pracHeavyId)
      .eq('practitioner_approved', true)
      .is('clients.deleted_at', null)
      .limit(200)
    for (const r of rows ?? []) heavyClientMap.set(r.id, r.client_id)
  }

  // Seed workout sessions for a subset of heavy approved assessments
  const heavyApprovedSample = [...heavyClientMap.keys()].filter((_, i) => i % 2 === 0)
  const heavyWS = await seedWorkoutSessions(heavyApprovedSample, heavyClientMap, pracHeavyId)
  console.log(`  Workout sessions: ${JSON.stringify(heavyWS)}`)

  // ── Final counts ───────────────────────────────────────────
  console.log('\n══════════════════════════════════════')
  console.log('  Seed complete — final counts')
  console.log('══════════════════════════════════════')

  const counts = await runSql(`
    SELECT
      (SELECT count(*) FROM practitioners)::int                                         AS practitioners,
      (SELECT count(*) FROM clients WHERE deleted_at IS NULL)::int                      AS clients_active,
      (SELECT count(*) FROM clients WHERE deleted_at IS NOT NULL)::int                  AS clients_tombstoned,
      (SELECT count(*) FROM assessments WHERE practitioner_approved = false)::int       AS assessments_draft,
      (SELECT count(*) FROM assessments WHERE practitioner_approved = true)::int        AS assessments_approved,
      (SELECT count(*) FROM client_deletion_log)::int                                   AS client_deletion_log,
      (SELECT count(*) FROM consent_records WHERE revoked_at IS NULL)::int              AS consents_granted,
      (SELECT count(*) FROM consent_records WHERE revoked_at IS NOT NULL)::int          AS consents_revoked,
      (SELECT count(*) FROM consent_tokens WHERE consumed_at IS NULL AND expires_at > now())::int  AS consent_tokens_pending,
      (SELECT count(*) FROM consent_tokens WHERE consumed_at IS NULL AND expires_at <= now())::int AS consent_tokens_expired,
      (SELECT count(*) FROM workout_sessions WHERE status = 'active' AND revoked_at IS NULL)::int  AS ws_active,
      (SELECT count(*) FROM workout_sessions WHERE status = 'completed')::int           AS ws_completed,
      (SELECT count(*) FROM workout_sessions WHERE revoked_at IS NOT NULL)::int         AS ws_revoked,
      (SELECT count(*) FROM session_runs WHERE status = 'in_progress')::int             AS runs_in_progress,
      (SELECT count(*) FROM session_runs WHERE status = 'completed')::int               AS runs_completed,
      (SELECT count(*) FROM workout_ratings)::int                                       AS ratings,
      (SELECT count(*) FROM workout_share_events WHERE event = 'minted')::int           AS share_events_minted,
      (SELECT count(*) FROM workout_share_events WHERE event = 'revoked')::int          AS share_events_revoked,
      (SELECT count(*) FROM captures)::int                                              AS captures,
      (SELECT count(*) FROM assessment_findings)::int                                   AS findings
  `)

  console.table(counts.rows[0])

  console.log('\nLocal QA practitioner credentials (disposable fixtures only):')
  console.table(qaPractitionerCredentials)

  await pool.end()
  console.log('\nDone.')
}

main().catch(err => {
  console.error('Seed failed:', err)
  pool.end()
  process.exit(1)
})

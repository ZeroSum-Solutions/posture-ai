#!/usr/bin/env node
/**
 * Deterministic PR-09 scale fixtures. This script is intentionally local-only
 * and refuses to reuse an existing fixture: run it after `supabase db reset`.
 *
 * Usage:
 *   npx vite-node --config vitest.config.ts scripts/performance/seed.ts
 *
 * Runtime outputs are written below ignored `test-results/performance/` by
 * default. The public manifest contains no credential; the adjacent credential
 * file is mode 0600 and exists only so the API runner can perform a real UI/MFA
 * sign-in.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { assessPosture, testLandmarksFrames } from '@posture-ai/engine'
import pg from 'pg'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'

import { activateLocalPractitionerAal2, provisionLocalInvitedPractitioner } from '../../e2e/helpers/practitioner-auth'
import { buildFindingRow } from '../../lib/findings/buildFindingRow'
import { hashConsent } from '../../lib/consent/policy'
import { snapshotLegalDocument } from '../../lib/legal/policy'
import { resolveRuntimeLegalDocument } from '../../lib/legal/runtime'
import { LEGAL_CONTEXT_BY_KIND, type LegalDocumentKind } from '../../lib/legal/types'
import {
  assertExactFixtureCounts,
  assertPerformanceUrls,
  deterministicUuid,
  PERFORMANCE_FIXTURE_COUNTS,
  isCliEntry,
  sha256Canonical,
} from './contracts'

const FIXTURE_PASSWORD = 'TestPass1234!'
const OUTPUT_DIRECTORY = resolve(process.env.PERF_OUTPUT_DIR ?? 'test-results/performance')
const PRACTITIONER_DOCUMENT_KINDS = ['terms', 'privacy', 'screening_notice'] as const satisfies readonly LegalDocumentKind[]
const LEGAL_FIXTURE_ENV = { POSTURE_TEST_MODE_ENABLED: '1', VERCEL_ENV: 'preview' }

type Environment = Readonly<Record<string, string | undefined>>

export type LocalSupabaseRuntime = Readonly<{
  supabaseUrl: string
  databaseUrl: string
  serviceRoleKey: string
  anonKey: string
  credentialSource: 'performance_env' | 'e2e_env' | 'supabase_status'
}>

export function parseSupabaseStatusEnvironment(raw: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
    if (!match) throw new Error('Local Supabase status returned malformed environment output')
    const [, key, encoded] = match
    if (key in parsed) throw new Error('Local Supabase status returned duplicate environment keys')
    let value = encoded
    if (encoded.startsWith('"')) {
      try {
        value = JSON.parse(encoded) as string
      } catch {
        throw new Error('Local Supabase status returned malformed quoted values')
      }
    } else if (encoded.startsWith("'") && encoded.endsWith("'")) {
      value = encoded.slice(1, -1)
    }
    parsed[key] = value
  }
  return parsed
}

function readLocalSupabaseStatus(): string {
  try {
    return execFileSync(resolve('node_modules/.bin/supabase'), ['status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    throw new Error(
      'Could not read local Supabase credentials. Start the local stack or provide a complete PERF_SUPABASE_SERVICE_ROLE_KEY/PERF_SUPABASE_ANON_KEY pair.',
    )
  }
}

function completePair(serviceRoleKey: string | undefined, anonKey: string | undefined, label: string) {
  if (Boolean(serviceRoleKey) !== Boolean(anonKey)) {
    throw new Error(`${label} must provide both service-role and anon keys`)
  }
  return serviceRoleKey && anonKey ? { serviceRoleKey, anonKey } : null
}

export function resolveLocalSupabaseRuntime(
  environment: Environment = process.env,
  readStatus: () => string = readLocalSupabaseStatus,
): LocalSupabaseRuntime {
  const performancePair = completePair(
    environment.PERF_SUPABASE_SERVICE_ROLE_KEY,
    environment.PERF_SUPABASE_ANON_KEY,
    'Performance Supabase environment',
  )
  const e2ePair = completePair(
    environment.E2E_SUPABASE_SERVICE_ROLE_KEY,
    environment.E2E_SUPABASE_ANON_KEY,
    'E2E Supabase environment',
  )
  if (performancePair || e2ePair) {
    const pair = performancePair ?? e2ePair!
    return {
      supabaseUrl: environment.PERF_SUPABASE_URL
        ?? environment.E2E_SUPABASE_URL
        ?? 'http://127.0.0.1:54321',
      databaseUrl: environment.PERF_DB_URL
        ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      ...pair,
      credentialSource: performancePair ? 'performance_env' : 'e2e_env',
    }
  }

  const status = parseSupabaseStatusEnvironment(readStatus())
  for (const key of ['API_URL', 'DB_URL', 'SERVICE_ROLE_KEY', 'ANON_KEY']) {
    if (!status[key]) throw new Error(`Local Supabase status omitted required ${key}`)
  }
  const supabaseUrl = environment.PERF_SUPABASE_URL ?? environment.E2E_SUPABASE_URL ?? status.API_URL!
  const databaseUrl = environment.PERF_DB_URL ?? status.DB_URL!
  if (new URL(supabaseUrl).origin !== new URL(status.API_URL!).origin) {
    throw new Error('Configured Supabase URL does not match the running local Supabase stack')
  }
  const configuredDatabase = new URL(databaseUrl)
  const statusDatabase = new URL(status.DB_URL!)
  if (
    configuredDatabase.hostname !== statusDatabase.hostname
    || configuredDatabase.port !== statusDatabase.port
    || configuredDatabase.pathname !== statusDatabase.pathname
  ) throw new Error('Configured database URL does not match the running local Supabase stack')
  return {
    supabaseUrl,
    databaseUrl,
    serviceRoleKey: status.SERVICE_ROLE_KEY!,
    anonKey: status.ANON_KEY!,
    credentialSource: 'supabase_status',
  }
}

export async function assertSupabaseCredentialsCurrent(
  admin: SupabaseClient,
  anonymous: SupabaseClient,
) {
  const { error: serviceError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 })
  const { error: anonymousError } = await anonymous.from('practitioners').select('id').limit(0)
  if (serviceError || anonymousError) {
    throw new Error(
      'Local Supabase credentials failed verification. Refresh the explicit key pair or let the seed read the running local stack.',
    )
  }
}

export type PerformanceBrowserFixture = Readonly<{
  fixture_id: string
  client_id: string
  assessment_id: string
  prior_assessment_id: string
  client_search_query: string
  client_display_name: string
  consent_ready_client_id: string
}>

type SeededCredential = Readonly<{
  fixture_id: string
  email: string
  password: string
  totp_secret: string
}>

function fixtureId(recordCount: number) {
  return `seeded_records_${recordCount}`
}

function practitionerEmail(recordCount: number) {
  return `performance+${recordCount}@postureai.test`
}

function tiedTimestamp(baseIso: string, index: number, tieWidth: number, stepMilliseconds: number) {
  const value = Date.parse(baseIso) - Math.floor(index / tieWidth) * stepMilliseconds
  return new Date(value).toISOString()
}

async function writeJsonAtomic(path: string, value: unknown, mode?: number) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { ...(mode ? { mode } : {}) })
  await rename(temporary, path)
}

async function acceptPractitionerDocuments(admin: SupabaseClient, practitionerId: string) {
  const acceptedAt = new Date().toISOString()
  const rows = PRACTITIONER_DOCUMENT_KINDS.map((kind) => {
    const resolution = resolveRuntimeLegalDocument({ kind }, LEGAL_FIXTURE_ENV)
    if (!resolution.ok) throw new Error(`Fixture legal document unavailable: ${kind} (${resolution.code})`)
    const document = snapshotLegalDocument(resolution.document)
    if (
      document.jurisdiction !== LEGAL_CONTEXT_BY_KIND[kind].jurisdiction
      || document.productScope !== LEGAL_CONTEXT_BY_KIND[kind].productScope
    ) {
      throw new Error(`Fixture legal document context mismatch: ${kind}`)
    }
    return {
      practitioner_id: practitionerId,
      legal_document_id: document.documentId,
      legal_document_version: document.version,
      legal_document_body_sha256: document.bodySha256,
      legal_document_effective_at: document.effectiveAt,
      legal_jurisdiction: document.jurisdiction,
      legal_product_scope: document.productScope,
      acceptance_context: 'local_performance_fixture_v1',
      acceptance_method: 'automated_test_fixture',
      accepted_at: acceptedAt,
    }
  })
  const { error } = await admin.from('practitioner_legal_acceptances').insert(rows)
  if (error) throw new Error(`Performance legal acceptance seed failed: ${error.message}`)
}

async function provisionPractitioner(input: {
  admin: SupabaseClient
  anonKey: string
  supabaseUrl: string
  recordCount: number
}): Promise<{ practitionerId: string; credential: SeededCredential }> {
  const email = practitionerEmail(input.recordCount)
  const displayName = `Performance ${input.recordCount}`
  const user = await provisionLocalInvitedPractitioner({
    admin: input.admin,
    supabaseUrl: input.supabaseUrl,
    email,
    password: FIXTURE_PASSWORD,
    displayName,
  })
  const sessionClient = createClient(input.supabaseUrl, input.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: signInError } = await sessionClient.auth.signInWithPassword({
    email,
    password: FIXTURE_PASSWORD,
  })
  if (signInError) throw new Error(`Performance fixture sign-in failed: ${signInError.message}`)
  const totpSecret = await activateLocalPractitionerAal2(sessionClient)
  await sessionClient.auth.signOut({ scope: 'global' })

  const { error: practitionerError } = await input.admin
    .from('practitioners')
    .update({ non_diagnostic_ack_at: new Date().toISOString(), display_name: displayName })
    .eq('id', user.id)
  if (practitionerError) throw new Error(`Performance practitioner update failed: ${practitionerError.message}`)
  await acceptPractitionerDocuments(input.admin, user.id)
  return {
    practitionerId: user.id,
    credential: { fixture_id: fixtureId(input.recordCount), email, password: FIXTURE_PASSWORD, totp_secret: totpSecret },
  }
}

async function ensureFreshDatabase(pool: pg.Pool) {
  const existingActors = await pool.query<{ email: string }>(
    `SELECT email FROM auth.users WHERE email LIKE 'performance+%@postureai.test' ORDER BY email`,
  )
  const deterministicClientIds = PERFORMANCE_FIXTURE_COUNTS.flatMap((recordCount) => (
    Array.from({ length: recordCount }, (_, index) => deterministicUuid(`${recordCount}:client:${index}`))
  ))
  const existingRows = await pool.query<{ id: string }>(
    'SELECT id::text FROM public.clients WHERE id = ANY($1::uuid[]) LIMIT 1',
    [deterministicClientIds],
  )
  if (existingActors.rowCount || existingRows.rowCount) {
    throw new Error(
      'Performance fixtures already exist or a prior seed was partial. Refusing mutation; run `supabase db reset` and seed once.',
    )
  }
}

async function insertClients(pool: pg.Pool, practitionerId: string, recordCount: number) {
  const rows = Array.from({ length: recordCount }, (_, index) => {
    const isAnchor = index === 0
    return {
      id: deterministicUuid(`${recordCount}:client:${index}`),
      practitioner_id: practitionerId,
      first_name: `Perf${recordCount}`,
      last_name: isAnchor ? 'Anchor' : `Client${String(index).padStart(4, '0')}`,
      date_of_birth: '1990-01-15',
      sex_at_birth: index % 2 === 0 ? 'female' : 'male',
      height_cm: 165 + (index % 20),
      weight_kg: 60 + (index % 30),
      notes: 'Deterministic local performance fixture',
      created_at: tiedTimestamp('2026-07-01T12:00:00.000Z', index, 5, 1_000),
    }
  })
  await pool.query(
    `INSERT INTO public.clients (
       id, practitioner_id, first_name, last_name, date_of_birth, sex_at_birth,
       height_cm, weight_kg, notes, created_at, updated_at
     )
     SELECT x.id, x.practitioner_id, x.first_name, x.last_name, x.date_of_birth,
            x.sex_at_birth::public.sex_at_birth_enum, x.height_cm, x.weight_kg,
            x.notes, x.created_at, x.created_at
       FROM jsonb_to_recordset($1::jsonb) AS x(
         id uuid, practitioner_id uuid, first_name text, last_name text,
         date_of_birth date, sex_at_birth text, height_cm numeric, weight_kg numeric,
         notes text, created_at timestamptz
       )`,
    [JSON.stringify(rows)],
  )
  return rows
}

async function grantAnchorConsent(admin: SupabaseClient, practitionerId: string, clientId: string) {
  const resolution = resolveRuntimeLegalDocument({ kind: 'subject_consent' }, LEGAL_FIXTURE_ENV)
  if (!resolution.ok) throw new Error(`Subject-consent fixture unavailable: ${resolution.code}`)
  const document = snapshotLegalDocument(resolution.document)
  const signedAt = new Date().toISOString()
  const signerName = 'Performance Fixture Subject'
  const signerRelationship = 'self'
  const consentHash = hashConsent({ document, signerName, signerRelationship, signedAt })
  const { data, error } = await admin.rpc('record_inperson_consent_governed', {
    p_client_id: clientId,
    p_practitioner_id: practitionerId,
    p_document_id: document.documentId,
    p_document_version: document.version,
    p_document_body_sha256: document.bodySha256,
    p_document_effective_at: document.effectiveAt,
    p_jurisdiction: document.jurisdiction,
    p_product_scope: document.productScope,
    p_signer_name: signerName,
    p_signer_relationship: signerRelationship,
    p_consent_hash: consentHash,
    p_signed_at: signedAt,
  })
  if (error || data !== 'ok') throw new Error(`Anchor consent seed failed: ${error?.message ?? String(data)}`)
}

async function insertAssessmentsAndFindings(
  pool: pg.Pool,
  practitionerId: string,
  clientId: string,
  recordCount: number,
) {
  const engineResult = assessPosture(testLandmarksFrames)
  if (engineResult.findings.length === 0) throw new Error('Performance fixture engine produced no findings')
  const assessments = Array.from({ length: recordCount }, (_, index) => {
    const assessedAt = tiedTimestamp('2026-06-30T12:00:00.000Z', index, 5, 60_000)
    return {
      id: deterministicUuid(`${recordCount}:assessment:${index}`),
      client_id: clientId,
      practitioner_id: practitionerId,
      assessed_at: assessedAt,
      status: 'complete',
      scoring_engine_version: engineResult.engineVersion,
      overall_score: engineResult.overallScore,
      overall_grade: engineResult.overallGrade,
      assessment_type: 'static',
      practitioner_approved: true,
      practitioner_approved_at: assessedAt,
      tilt_corrected: engineResult.tiltCorrected,
      level_verified: engineResult.levelVerified,
      capture_stability: engineResult.captureStability ?? null,
      created_at: assessedAt,
    }
  })
  await pool.query(
    `INSERT INTO public.assessments (
       id, client_id, practitioner_id, assessed_at, status, scoring_engine_version,
       overall_score, overall_grade, assessment_type, practitioner_approved,
       practitioner_approved_at, tilt_corrected, level_verified, capture_stability, created_at
     )
     SELECT x.id, x.client_id, x.practitioner_id, x.assessed_at,
            x.status::public.assessment_status_enum, x.scoring_engine_version,
            x.overall_score, x.overall_grade::public.overall_grade_enum,
            x.assessment_type, x.practitioner_approved, x.practitioner_approved_at,
            x.tilt_corrected, x.level_verified, x.capture_stability, x.created_at
       FROM jsonb_to_recordset($1::jsonb) AS x(
         id uuid, client_id uuid, practitioner_id uuid, assessed_at timestamptz,
         status text, scoring_engine_version text, overall_score numeric,
         overall_grade text, assessment_type text, practitioner_approved boolean,
         practitioner_approved_at timestamptz, tilt_corrected boolean,
         level_verified boolean, capture_stability numeric, created_at timestamptz
       )`,
    [JSON.stringify(assessments)],
  )

  const findings = assessments.flatMap((assessment, assessmentIndex) => (
    engineResult.findings.map((finding, findingIndex) => ({
      id: deterministicUuid(`${recordCount}:finding:${assessmentIndex}:${findingIndex}`),
      ...buildFindingRow(finding, assessment.id, practitionerId),
    }))
  ))
  await pool.query(
    `INSERT INTO public.assessment_findings (
       id, assessment_id, practitioner_id, imbalance_key, region, label, deviation,
       standard, unit, direction, severity_pct, zone, view_used, confidence,
       metric_validity, stability_score, uncertainty_deg, borderline, observations
     )
     SELECT x.id, x.assessment_id, x.practitioner_id, x.imbalance_key, x.region,
            x.label, x.deviation, x.standard, x.unit, x.direction, x.severity_pct,
            x.zone::public.zone_enum, x.view_used::public.view_enum, x.confidence,
            x.metric_validity, x.stability_score, x.uncertainty_deg, x.borderline,
            x.observations
       FROM jsonb_to_recordset($1::jsonb) AS x(
         id uuid, assessment_id uuid, practitioner_id uuid, imbalance_key text,
         region text, label text, deviation numeric, standard numeric, unit text,
         direction text, severity_pct numeric, zone text, view_used text,
         confidence numeric, metric_validity text, stability_score numeric,
         uncertainty_deg numeric, borderline boolean, observations jsonb
       )`,
    [JSON.stringify(findings)],
  )
  return { assessments, findingsPerAssessment: engineResult.findings.length }
}

async function queryFixtureManifest(
  pool: pg.Pool,
  practitionerId: string,
  recordCount: number,
  findingsPerAssessment: number,
) {
  const anchorId = deterministicUuid(`${recordCount}:client:0`)
  const clients = await pool.query<{
    id: string; created_at: string; first_name: string; last_name: string
  }>(
    `SELECT id::text, created_at::text, first_name, last_name
       FROM public.clients
      WHERE practitioner_id = $1 AND archived_at IS NULL AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC`,
    [practitionerId],
  )
  const assessments = await pool.query<{
    id: string; assessed_at: string; overall_score: string; overall_grade: string
  }>(
    `SELECT id::text, assessed_at::text, overall_score::text, overall_grade::text
       FROM public.assessments
      WHERE practitioner_id = $1 AND client_id = $2 AND status = 'complete'
      ORDER BY assessed_at DESC, id DESC`,
    [practitionerId, anchorId],
  )
  const pickerClients = await pool.query<{
    id: string; created_at: string; first_name: string; last_name: string
  }>(
    `SELECT id::text, created_at::text, first_name, last_name
       FROM public.clients
      WHERE practitioner_id = $1
        AND archived_at IS NULL
        AND deleted_at IS NULL
        AND (first_name ILIKE $2 OR last_name ILIKE $2)
      ORDER BY created_at DESC, id DESC`,
    [practitionerId, `Perf${recordCount}%`],
  )
  const findings = await pool.query<{
    assessment_id: string; imbalance_key: string; deviation: string; zone: string
  }>(
    `SELECT f.assessment_id::text, f.imbalance_key, f.deviation::text, f.zone::text
       FROM public.assessment_findings f
       JOIN public.assessments a ON a.id = f.assessment_id
      WHERE a.practitioner_id = $1 AND a.client_id = $2 AND a.status = 'complete'
      ORDER BY f.assessment_id, f.imbalance_key`,
    [practitionerId, anchorId],
  )
  const authProvenance = await pool.query<{
    access_status: string
    role: string
    invitation_state: string
    verified_totp_factors: string
  }>(
    `SELECT p.access_status::text,
            p.role,
            i.state::text AS invitation_state,
            (SELECT count(*)::text
               FROM auth.mfa_factors f
              WHERE f.user_id = p.id
                AND f.factor_type = 'totp'
                AND f.status = 'verified') AS verified_totp_factors
       FROM public.practitioners p
       JOIN private.practitioner_invitations i ON i.provisioned_user_id = p.id
      WHERE p.id = $1`,
    [practitionerId],
  )
  const counts = {
    activeClients: clients.rowCount ?? clients.rows.length,
    completeAnchorAssessments: assessments.rowCount ?? assessments.rows.length,
    assessmentFindings: findings.rowCount ?? findings.rows.length,
    findingsPerAssessment,
  }
  assertExactFixtureCounts(recordCount, counts)
  if (pickerClients.rows.length !== recordCount) {
    throw new Error(`Picker-search truth set ${pickerClients.rows.length} != ${recordCount}`)
  }
  const admission = authProvenance.rows[0]
  if (
    !admission
    || admission.access_status !== 'active'
    || admission.role !== 'practitioner'
    || admission.invitation_state !== 'accepted'
    || Number(admission.verified_totp_factors) !== 1
  ) throw new Error(`Fixture ${recordCount} is not an invited, active AAL2 practitioner`)
  const latest = assessments.rows[0]
  const prior = assessments.rows[1]
  if (!latest || !prior) throw new Error(`Fixture ${recordCount} did not produce two browser assessments`)
  const browser: PerformanceBrowserFixture = {
    fixture_id: fixtureId(recordCount),
    client_id: anchorId,
    assessment_id: latest.id,
    prior_assessment_id: prior.id,
    // Every seeded client shares this first-name prefix, so the picker-search
    // target still exercises the exact N-record scale instead of quietly
    // measuring a one-row result while claiming a 150/300/1000 fixture.
    client_search_query: `Perf${recordCount}`,
    client_display_name: `Perf${recordCount} Anchor`,
    consent_ready_client_id: anchorId,
  }
  return {
    fixture_id: fixtureId(recordCount),
    fixture_record_count: recordCount,
    practitioner_id: practitionerId,
    anchor_client_id: anchorId,
    counts: {
      active_clients: counts.activeClients,
      picker_search_clients: pickerClients.rows.length,
      complete_anchor_assessments: counts.completeAnchorAssessments,
      assessment_findings: counts.assessmentFindings,
      findings_per_assessment: findingsPerAssessment,
    },
    timestamp_ties: {
      client_distinct_timestamps: new Set(clients.rows.map((row) => row.created_at)).size,
      assessment_distinct_timestamps: new Set(assessments.rows.map((row) => row.assessed_at)).size,
    },
    auth_provenance: {
      invitation_state: admission.invitation_state,
      practitioner_access_status: admission.access_status,
      practitioner_role: admission.role,
      verified_totp_factors: Number(admission.verified_totp_factors),
    },
    db_projection_sha256: {
      clients: sha256Canonical(clients.rows),
      picker_search_clients: sha256Canonical(pickerClients.rows),
      assessments: sha256Canonical(assessments.rows),
      assessment_findings: sha256Canonical(findings.rows),
    },
    expected_client_ids: clients.rows.map((row) => row.id),
    expected_picker_client_ids: pickerClients.rows.map((row) => row.id),
    expected_assessment_ids: assessments.rows.map((row) => row.id),
    browser,
  }
}

export async function seedPerformanceFixtures() {
  const appUrl = process.env.PERF_APP_URL ?? 'http://127.0.0.1:3000'
  const runtime = resolveLocalSupabaseRuntime()
  const { supabaseUrl, databaseUrl, serviceRoleKey, anonKey } = runtime
  assertPerformanceUrls({ appUrl, supabaseUrl, databaseUrl })
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const credentialProbe = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 })
  const credentials: SeededCredential[] = []
  try {
    await assertSupabaseCredentialsCurrent(admin, credentialProbe)
    await ensureFreshDatabase(pool)
    const fixtures = []
    for (const recordCount of PERFORMANCE_FIXTURE_COUNTS) {
      const { practitionerId, credential } = await provisionPractitioner({
        admin,
        anonKey,
        supabaseUrl,
        recordCount,
      })
      credentials.push(credential)
      const clients = await insertClients(pool, practitionerId, recordCount)
      const anchorId = clients[0]!.id
      await grantAnchorConsent(admin, practitionerId, anchorId)
      const seeded = await insertAssessmentsAndFindings(pool, practitionerId, anchorId, recordCount)
      fixtures.push(await queryFixtureManifest(pool, practitionerId, recordCount, seeded.findingsPerAssessment))
      process.stdout.write(`Seeded exact ${recordCount}-record performance fixture\n`)
    }
    const browser = fixtures.find((fixture) => fixture.fixture_record_count === 1000)!.browser
    const manifest = {
      schema_version: 1,
      fixture_contract_id: 'posture-ai-pr09-deterministic-performance-fixtures-v1',
      generated_at: new Date().toISOString(),
      local_only: true,
      fixture_environment: {
        app_origin: new URL(appUrl).origin,
        supabase_origin: new URL(supabaseUrl).origin,
        database_host: new URL(databaseUrl).hostname,
        required_app_environment: { POSTURE_TEST_MODE_ENABLED: '1', VERCEL_ENV: 'preview_or_unset' },
        credential_source: runtime.credentialSource,
      },
      credentials_path: 'credentials.json',
      fixtures,
      browser,
    }
    await writeJsonAtomic(resolve(OUTPUT_DIRECTORY, 'credentials.json'), { schema_version: 1, credentials }, 0o600)
    await writeJsonAtomic(resolve(OUTPUT_DIRECTORY, 'fixture-manifest.json'), manifest)
    process.stdout.write(`Manifest: ${resolve(OUTPUT_DIRECTORY, 'fixture-manifest.json')}\n`)
    return manifest
  } finally {
    await pool.end()
  }
}

if (isCliEntry(import.meta.url)) {
  if (process.env.PERF_CLI_ENTRY_PROBE === '1') {
    process.stdout.write('PERFORMANCE_SEED_CLI_ENTRY_OK\n')
  } else {
    seedPerformanceFixtures().catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    })
  }
}

#!/usr/bin/env node
/**
 * Measures every frozen API/data target against a real production Next server.
 * Authentication is established through the sign-in and MFA UI; subsequent
 * requests reuse the exact SSR-compatible cookies issued to that browser.
 *
 * Required services: local Supabase plus `next start` on PERF_APP_URL.
 * Default input/output: test-results/performance/{fixture-manifest,api-raw}.json
 */
import { chromium, type Browser, type BrowserContext } from '@playwright/test'
import pg from 'pg'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { cpus, platform, release, totalmem } from 'node:os'

import { totpCode } from '../testing/totp'
import {
  assertPerformanceUrls,
  deterministicUuid,
  isCliEntry,
  PERFORMANCE_MEASUREMENTS,
  PERFORMANCE_WARMUPS,
  sha256Canonical,
  traverseCursorPages,
  withExactFixtureRestoration,
  type TimedCursorPage,
} from './contracts'

type FixtureBrowser = Readonly<{
  fixture_id: string
  client_id: string
  assessment_id: string
  prior_assessment_id: string
  client_search_query: string
  client_display_name: string
  consent_ready_client_id: string
}>

type FixtureManifestEntry = Readonly<{
  fixture_id: string
  fixture_record_count: number
  practitioner_id: string
  anchor_client_id: string
  expected_client_ids: string[]
  expected_picker_client_ids: string[]
  expected_assessment_ids: string[]
  browser: FixtureBrowser
}>

type FixtureManifest = Readonly<{
  schema_version: number
  fixture_contract_id: string
  local_only: boolean
  credentials_path: string
  fixtures: FixtureManifestEntry[]
}>

type Credential = Readonly<{
  fixture_id: string
  email: string
  password: string
  totp_secret: string
}>

type ApiTarget = Readonly<{
  targetId: string
  recordsField: 'clients' | 'assessments'
  fixtureIds: (fixture: FixtureManifestEntry) => readonly string[]
  requestPath: (fixture: FixtureManifestEntry) => string
  concurrentKind: 'client' | 'assessment'
}>

export const API_TARGETS: readonly ApiTarget[] = [
  {
    targetId: 'clients_page_list',
    recordsField: 'clients',
    fixtureIds: (fixture) => fixture.expected_client_ids,
    requestPath: () => '/api/clients?limit=50',
    concurrentKind: 'client',
  },
  {
    targetId: 'clients_api_list',
    recordsField: 'clients',
    fixtureIds: (fixture) => fixture.expected_client_ids,
    requestPath: () => '/api/clients?limit=50',
    concurrentKind: 'client',
  },
  {
    targetId: 'assessment_client_picker',
    recordsField: 'clients',
    fixtureIds: (fixture) => fixture.expected_picker_client_ids,
    requestPath: (fixture) => (
      `/api/clients?limit=50&search=${encodeURIComponent(fixture.browser.client_search_query)}`
    ),
    concurrentKind: 'client',
  },
  {
    targetId: 'client_assessment_history',
    recordsField: 'assessments',
    fixtureIds: (fixture) => fixture.expected_assessment_ids,
    requestPath: (fixture) => `/api/clients/${fixture.anchor_client_id}/assessments?include_findings=true&limit=50`,
    concurrentKind: 'assessment',
  },
  {
    targetId: 'client_progress_chart',
    recordsField: 'assessments',
    fixtureIds: (fixture) => fixture.expected_assessment_ids,
    requestPath: (fixture) => `/api/clients/${fixture.anchor_client_id}/assessments?include_findings=true&limit=50`,
    concurrentKind: 'assessment',
  },
  {
    targetId: 'client_comparison_payload',
    recordsField: 'assessments',
    fixtureIds: (fixture) => fixture.expected_assessment_ids,
    requestPath: (fixture) => `/api/clients/${fixture.anchor_client_id}/assessments?include_findings=true&limit=50`,
    concurrentKind: 'assessment',
  },
] as const

const CURSOR_INTEGRITY_TARGETS = new Set([
  'clients_page_list',
  'clients_api_list',
  'assessment_client_picker',
  'client_assessment_history',
])

export function concurrentClientName(targetId: string, fixture: FixtureManifestEntry) {
  return targetId === 'assessment_client_picker'
    ? { firstName: fixture.browser.client_search_query, lastName: 'Concurrent' }
    : { firstName: 'Concurrent', lastName: 'Newer' }
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new Error(`${label} is not valid JSON`)
  }
}

function validateManifest(value: FixtureManifest) {
  if (value.schema_version !== 1 || value.local_only !== true) throw new Error('Unsupported or non-local fixture manifest')
  if (value.fixture_contract_id !== 'posture-ai-pr09-deterministic-performance-fixtures-v1') {
    throw new Error('Unexpected performance fixture contract')
  }
  const counts = value.fixtures.map((fixture) => fixture.fixture_record_count).sort((a, b) => a - b)
  if (JSON.stringify(counts) !== JSON.stringify([150, 300, 1000])) {
    throw new Error('Fixture manifest must contain exact 150, 300, and 1000 fixtures')
  }
  for (const fixture of value.fixtures) {
    if (
      fixture.expected_client_ids.length !== fixture.fixture_record_count
      || fixture.expected_picker_client_ids.length !== fixture.fixture_record_count
      || fixture.expected_assessment_ids.length !== fixture.fixture_record_count
    ) throw new Error(`Fixture manifest count mismatch: ${fixture.fixture_id}`)
  }
}

async function writeJsonAtomic(path: string, value: unknown) {
  await import('node:fs/promises').then(({ mkdir }) => mkdir(dirname(path), { recursive: true }))
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporary, path)
}

async function authenticateThroughUi(
  browser: Browser,
  appUrl: string,
  credential: Credential,
): Promise<{ context: BrowserContext; cookieHeader: string }> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(new URL('/auth/sign-in', appUrl).href, { waitUntil: 'domcontentloaded' })
  await page.locator('input[type="email"]').fill(credential.email)
  await page.locator('input[type="password"]').fill(credential.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/auth\/mfa/, { timeout: 15_000 })
  await page.getByLabel('Authenticator code').fill(totpCode(credential.totp_secret))
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/'), { timeout: 15_000 })
  if (page.url().includes('/onboarding')) {
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Accept and Continue' }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/onboarding'), { timeout: 15_000 })
  }
  const cookies = await context.cookies(appUrl)
  if (!cookies.length) throw new Error(`UI authentication produced no application cookies for ${credential.fixture_id}`)
  return { context, cookieHeader: cookies.map(({ name, value }) => `${name}=${value}`).join('; ') }
}

type MeasuredPage = TimedCursorPage & Readonly<{
  decodedBodySha256: string
  requestPath: string
  nextCursorSha256: string | null
}>

async function requestApiPage(input: {
  appUrl: string
  cookieHeader: string
  requestPath: string
  recordsField: 'clients' | 'assessments'
}): Promise<MeasuredPage> {
  const started = performance.now()
  const response = await fetch(new URL(input.requestPath, input.appUrl), {
    headers: {
      accept: 'application/json',
      cookie: input.cookieHeader,
      'user-agent': 'posture-ai-pr09-performance-runner/1',
    },
    cache: 'no-store',
    redirect: 'manual',
  })
  const bodyText = await response.text()
  const durationMilliseconds = performance.now() - started
  const body = parseJson<Record<string, unknown>>(bodyText, `${input.requestPath} response`)
  const records = body[input.recordsField]
  if (!Array.isArray(records)) throw new Error(`${input.requestPath} omitted ${input.recordsField}`)
  const ids = records.map((record) => {
    const id = (record as { id?: unknown }).id
    if (typeof id !== 'string') throw new Error(`${input.requestPath} returned a record without an id`)
    return id
  })
  const pagination = body.pagination as { has_more?: unknown; next_cursor?: unknown } | undefined
  const hasMore = pagination?.has_more === true
  const nextCursor = typeof pagination?.next_cursor === 'string' ? pagination.next_cursor : null
  return {
    ids,
    nextCursor,
    hasMore,
    durationMilliseconds: Number(durationMilliseconds.toFixed(6)),
    decodedResponseBodyUtf8Bytes: Buffer.byteLength(bodyText, 'utf8'),
    responseContentEncoding: response.headers.get('content-encoding') ?? 'identity',
    status: response.status,
    decodedBodySha256: sha256Canonical(body),
    requestPath: input.requestPath,
    nextCursorSha256: nextCursor ? sha256Canonical(nextCursor) : null,
  }
}

function sample(page: MeasuredPage, observationIndex: number, measurementContextId: string) {
  return {
    observation_index: observationIndex,
    measurement_context_id: measurementContextId,
    duration_milliseconds: page.durationMilliseconds,
    decoded_response_body_utf8_bytes: page.decodedResponseBodyUtf8Bytes,
    response_content_encoding: page.responseContentEncoding,
    status: page.status,
    page_record_count: page.ids.length,
    decoded_body_sha256: page.decodedBodySha256,
  }
}

function snapshotFromFirstPage(page: TimedCursorPage) {
  if (!page.nextCursor) throw new Error('First traversal page did not return a cursor')
  try {
    const decoded = JSON.parse(Buffer.from(page.nextCursor, 'base64url').toString('utf8')) as { snapshotAt?: unknown }
    if (typeof decoded.snapshotAt !== 'string' || !Number.isFinite(Date.parse(decoded.snapshotAt))) throw new Error()
    return decoded.snapshotAt
  } catch {
    throw new Error('First traversal page returned an unreadable snapshot cursor')
  }
}

async function insertConcurrentRow(input: {
  pool: pg.Pool
  fixture: FixtureManifestEntry
  target: ApiTarget
  concurrentId: string
  firstPage: TimedCursorPage
}) {
  const snapshotAt = snapshotFromFirstPage(input.firstPage)
  const newerAt = new Date(Date.parse(snapshotAt) + 1_000).toISOString()
  if (input.target.concurrentKind === 'client') {
    const name = concurrentClientName(input.target.targetId, input.fixture)
    await input.pool.query(
      `INSERT INTO public.clients (
         id, practitioner_id, first_name, last_name, date_of_birth, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, '1990-01-15', $5, $5)`,
      [input.concurrentId, input.fixture.practitioner_id, name.firstName, name.lastName, newerAt],
    )
    return
  }
  await input.pool.query(
    `INSERT INTO public.assessments (
       id, client_id, practitioner_id, assessed_at, status, scoring_engine_version,
       overall_score, overall_grade, assessment_type, practitioner_approved,
       practitioner_approved_at, created_at
     ) VALUES ($1, $2, $3, $4, 'complete', 'performance-concurrent-v1',
               10, 'A', 'static', true, $4, $4)`,
    [input.concurrentId, input.fixture.anchor_client_id, input.fixture.practitioner_id, newerAt],
  )
}

async function removeConcurrentRow(pool: pg.Pool, kind: ApiTarget['concurrentKind'], id: string) {
  const table = kind === 'client' ? 'clients' : 'assessments'
  await pool.query(`DELETE FROM public.${table} WHERE id = $1`, [id])
}

async function databaseFixtureRecordCount(
  pool: pg.Pool,
  fixture: FixtureManifestEntry,
  kind: ApiTarget['concurrentKind'],
) {
  const result = kind === 'client'
    ? await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM public.clients
          WHERE practitioner_id = $1 AND archived_at IS NULL AND deleted_at IS NULL`,
        [fixture.practitioner_id],
      )
    : await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM public.assessments
          WHERE practitioner_id = $1 AND client_id = $2 AND status = 'complete'`,
        [fixture.practitioner_id, fixture.anchor_client_id],
      )
  return Number(result.rows[0]?.count)
}

function withCursor(requestPath: string, cursor: string | null) {
  if (!cursor) return requestPath
  const parsed = new URL(requestPath, 'http://local.invalid')
  parsed.searchParams.set('cursor', cursor)
  return `${parsed.pathname}${parsed.search}`
}

async function measureTarget(input: {
  appUrl: string
  cookieHeader: string
  pool: pg.Pool
  target: ApiTarget
  fixture: FixtureManifestEntry
}) {
  const requestPath = input.target.requestPath(input.fixture)
  const warmups = []
  for (let index = 0; index < PERFORMANCE_WARMUPS; index += 1) {
    const page = await requestApiPage({
      appUrl: input.appUrl,
      cookieHeader: input.cookieHeader,
      requestPath,
      recordsField: input.target.recordsField,
    })
    if (page.status !== 200) throw new Error(`${input.target.targetId} warmup failed with HTTP ${page.status}`)
    warmups.push(sample(
      page,
      index + 1,
      `${input.target.targetId}:${input.fixture.fixture_id}:warmup:${index + 1}`,
    ))
  }
  const measurements = []
  for (let index = 0; index < PERFORMANCE_MEASUREMENTS; index += 1) {
    const page = await requestApiPage({
      appUrl: input.appUrl,
      cookieHeader: input.cookieHeader,
      requestPath,
      recordsField: input.target.recordsField,
    })
    if (page.status !== 200) throw new Error(`${input.target.targetId} measurement failed with HTTP ${page.status}`)
    measurements.push(sample(
      page,
      index + 1,
      `${input.target.targetId}:${input.fixture.fixture_id}:measurement:${index + 1}`,
    ))
  }

  const expectedIds = input.target.fixtureIds(input.fixture)
  const traversals = []
  const traversalCount = CURSOR_INTEGRITY_TARGETS.has(input.target.targetId)
    ? PERFORMANCE_MEASUREMENTS
    : 0
  for (let traversalIndex = 0; traversalIndex < traversalCount; traversalIndex += 1) {
    const measurementContextId = `${input.target.targetId}:${input.fixture.fixture_id}:cursor:${traversalIndex + 1}`
    const concurrentId = deterministicUuid(
      `${input.fixture.fixture_record_count}:concurrent:${input.target.targetId}:${traversalIndex}`,
    )
    await removeConcurrentRow(input.pool, input.target.concurrentKind, concurrentId)
    const traversal = await withExactFixtureRestoration({
      expectedRecords: input.fixture.fixture_record_count,
      context: measurementContextId,
      countRecords: () => databaseFixtureRecordCount(input.pool, input.fixture, input.target.concurrentKind),
      cleanup: () => removeConcurrentRow(input.pool, input.target.concurrentKind, concurrentId),
      run: () => traverseCursorPages({
        expectedIds,
        concurrentId,
        requestPage: (cursor) => requestApiPage({
          appUrl: input.appUrl,
          cookieHeader: input.cookieHeader,
          requestPath: withCursor(requestPath, cursor),
          recordsField: input.target.recordsField,
        }),
        insertNewerAfterFirstPage: (firstPage) => insertConcurrentRow({
          pool: input.pool,
          fixture: input.fixture,
          target: input.target,
          concurrentId,
          firstPage,
        }),
      }),
    })
    if (
      traversal.integrity.duplicateRecordCount !== 0
      || traversal.integrity.omittedRecordCount !== 0
      || traversal.integrity.unexpectedRecordCount !== 0
      || traversal.integrity.concurrentRecordReturned
    ) throw new Error(`${input.target.targetId} failed cursor-integrity traversal ${traversalIndex + 1}`)
    traversals.push({
      measurement_context_id: measurementContextId,
      concurrent_insert_case: true,
      pages: traversal.pages.map((page, index) => {
        const measured = page as MeasuredPage
        return {
          page_index: index + 1,
          record_ids: measured.ids,
          page_record_count: measured.ids.length,
          duration_milliseconds: measured.durationMilliseconds,
          decoded_response_body_utf8_bytes: measured.decodedResponseBodyUtf8Bytes,
          response_content_encoding: measured.responseContentEncoding,
          status: measured.status,
          decoded_body_sha256: measured.decodedBodySha256,
          next_cursor_sha256: measured.nextCursorSha256,
        }
      }),
      returned_ids_sha256: sha256Canonical(traversal.returnedIds),
      integrity: {
        concurrent_insert_case: true,
        expected_record_count: traversal.integrity.expectedRecordCount,
        returned_record_count: traversal.integrity.returnedRecordCount,
        unique_record_count: traversal.integrity.uniqueRecordCount,
        duplicate_record_count: traversal.integrity.duplicateRecordCount,
        omitted_record_count: traversal.integrity.omittedRecordCount,
        unexpected_record_count: traversal.integrity.unexpectedRecordCount,
        concurrent_record_returned: traversal.integrity.concurrentRecordReturned,
        page_count: traversal.integrity.pageCount,
        maximum_page_records: traversal.integrity.maximumPageRecords,
        maximum_response_bytes: traversal.integrity.maximumResponseBytes,
      },
      concurrent_insert: {
        record_id: concurrentId,
        inserted_after_page: 1,
        returned: traversal.integrity.concurrentRecordReturned,
        fixture_restored_to_exact_count: true,
      },
    })
  }

  return {
    target_id: input.target.targetId,
    fixture_id: input.fixture.fixture_id,
    fixture_record_count: input.fixture.fixture_record_count,
    request_path: requestPath,
    request_identity: {
      method: 'GET',
      canonical_path: requestPath,
      records_field: input.target.recordsField,
      sha256: sha256Canonical(['GET', requestPath, input.target.recordsField]),
    },
    warmups,
    measurements,
    traversals,
  }
}

function commitSha() {
  const value = process.env.PERF_COMMIT_SHA
    ?? process.env.GITHUB_SHA
    ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error('Performance runner requires an exact lowercase commit SHA')
  return value
}

export function apiExecutionIdentity(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const official = environment.PERF_OFFICIAL_RUN === '1'
  const nodeMajor = Number(process.versions.node.split('.')[0])
  if (official && (
    environment.GITHUB_ACTIONS !== 'true'
    || environment.RUNNER_OS !== 'Linux'
    || environment.RUNNER_ARCH !== 'X64'
    || environment.ImageOS !== 'ubuntu24'
    || !environment.ImageVersion
    || nodeMajor !== 22
    || environment.PERF_APPLICATION_MODE !== 'production_next_start'
  )) {
    throw new Error('Official performance evidence requires the frozen GitHub ubuntu-24.04 x64 Node 22 production-next-start profile')
  }
  const cpu = cpus()
  return {
    evidence_class: official ? 'OFFICIAL' : 'LOCAL_ONLY',
    runner_fingerprint: {
      runner_provider: official ? 'github_actions' : 'local',
      runner_image: official ? 'ubuntu-24.04' : platform(),
      runner_image_version: official ? environment.ImageVersion! : release(),
      runner_architecture: official ? 'x64' : process.arch,
      cpu_model: cpu[0]?.model ?? 'unknown',
      logical_cpu_cores: cpu.length,
      memory_bytes: totalmem(),
      node_version: process.versions.node,
      // API measurements use Node fetch. Chromium only bootstraps the real AAL2
      // cookie and is not part of the measured API execution profile.
      browser_name: 'not_applicable',
      browser_build: 'not_applicable',
    },
    actual_execution_profile: official
      ? {
          runner_provider: 'github_actions',
          runner_image: 'ubuntu-24.04',
          runner_architecture: 'x64',
          node_major: 22,
          database: 'local_supabase',
          application_mode: 'production_next_start',
          workers: 1,
          measurement_retries: 0,
          network_profile: 'unthrottled_local_loopback',
        }
      : {
          runner_provider: 'local',
          runner_image: platform(),
          runner_architecture: process.arch,
          node_major: nodeMajor,
          database: 'local_supabase',
          application_mode: environment.PERF_APPLICATION_MODE ?? 'unknown_local_mode',
          workers: 1,
          measurement_retries: 0,
          network_profile: 'unthrottled_local_loopback',
        },
  }
}

export async function runApiMeasurements() {
  const appUrl = process.env.PERF_APP_URL ?? 'http://127.0.0.1:3000'
  const supabaseUrl = process.env.PERF_SUPABASE_URL ?? 'http://127.0.0.1:54321'
  const databaseUrl = process.env.PERF_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  assertPerformanceUrls({ appUrl, supabaseUrl, databaseUrl })

  const manifestPath = resolve(process.env.PERF_MANIFEST_PATH ?? 'test-results/performance/fixture-manifest.json')
  const outputPath = resolve(process.env.PERF_API_ARTIFACT_PATH ?? 'test-results/performance/api-raw.json')
  const manifestRaw = await readFile(manifestPath, 'utf8')
  const manifest = parseJson<FixtureManifest>(manifestRaw, 'Performance fixture manifest')
  validateManifest(manifest)
  const credentialPath = resolve(dirname(manifestPath), manifest.credentials_path)
  if (dirname(credentialPath) !== dirname(manifestPath)) {
    throw new Error('Performance credential path must remain beside the manifest')
  }
  const credentialFile = parseJson<{ credentials?: Credential[] }>(await readFile(credentialPath, 'utf8'), 'Performance credentials')
  const credentials = new Map((credentialFile.credentials ?? []).map((credential) => [credential.fixture_id, credential]))
  if (credentials.size !== manifest.fixtures.length) throw new Error('Performance credentials do not match fixture manifest')

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 })
  const browser = await chromium.launch({ headless: true })
  const execution = apiExecutionIdentity()
  const authBootstrapBrowserBuild = browser.version()
  const targets = []
  try {
    for (const fixture of [...manifest.fixtures].sort((left, right) => left.fixture_record_count - right.fixture_record_count)) {
      const credential = credentials.get(fixture.fixture_id)
      if (!credential) throw new Error(`Missing credential for ${fixture.fixture_id}`)
      const authenticated = await authenticateThroughUi(browser, appUrl, credential)
      try {
        for (const target of API_TARGETS) {
          targets.push(await measureTarget({
            appUrl,
            cookieHeader: authenticated.cookieHeader,
            pool,
            target,
            fixture,
          }))
          process.stdout.write(`Measured ${target.targetId} at ${fixture.fixture_record_count} records\n`)
        }
      } finally {
        await authenticated.context.close()
      }
    }
  } finally {
    await browser.close()
    await pool.end()
  }
  const artifact = {
    schema_version: 1,
    artifact_id: 'posture-ai-pr09-raw-api-performance-v1',
    generated_at: new Date().toISOString(),
    local_only: true,
    evidence_class: execution.evidence_class,
    commit_sha: commitSha(),
    fixture_contract_id: manifest.fixture_contract_id,
    fixture_manifest_sha256: createHash('sha256').update(manifestRaw, 'utf8').digest('hex'),
    runner_fingerprint: execution.runner_fingerprint,
    actual_execution_profile: execution.actual_execution_profile,
    auth_bootstrap_browser_build: authBootstrapBrowserBuild,
    warmups_per_target: PERFORMANCE_WARMUPS,
    measurements_per_target: PERFORMANCE_MEASUREMENTS,
    targets,
  }
  await writeJsonAtomic(outputPath, artifact)
  process.stdout.write(`Raw API artifact: ${outputPath}\n`)
  return artifact
}

if (isCliEntry(import.meta.url)) {
  if (process.env.PERF_CLI_ENTRY_PROBE === '1') {
    process.stdout.write('PERFORMANCE_API_CLI_ENTRY_OK\n')
  } else {
    runApiMeasurements().catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    })
  }
}

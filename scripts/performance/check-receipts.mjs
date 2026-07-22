#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import {
  computeReceiptBudgetHash,
  validatePerformanceReceiptSet,
} from '../check-performance-budgets.mjs'
import { QUERY_SOURCE_PATHS } from './capture-query-plans.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(SCRIPT_PATH), '../..')
const DEFAULT_RESULTS = resolve(ROOT, 'test-results/performance')
const DEFAULT_BUDGET = resolve(ROOT, 'docs/qa/performance-budgets.json')
const REQUIRED_FIXTURE_COUNTS = [150, 300, 1000]
const REQUIRED_QUERY_TARGETS = [
  'clients_page_list',
  'clients_api_list',
  'assessment_client_picker',
  'client_assessment_history',
]

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function nearestRank(values) {
  const rank = Math.ceil(values.length * 0.95)
  return { rank, value: [...values].sort((a, b) => a - b)[rank - 1] }
}

function profileFor(budget, id) {
  const profile = budget.measurement_profiles.find(row => row.profile_id === id)
  if (!profile) throw new Error(`Unknown measurement profile ${id}`)
  return profile.expected_actual_execution_profile
}

function calculationFor(metric, samples) {
  const values = samples.map(sample => sample[metric.observed_value_field])
  if (metric.aggregation === 'maximum') {
    return { aggregation: 'maximum', calculated_maximum: Math.max(...values) }
  }
  const percentile = nearestRank(values)
  return {
    aggregation: 'nearest_rank_p95',
    calculated_nearest_rank: percentile.rank,
    calculated_p95: percentile.value,
  }
}

function receiptBase({ budget, commitSha, metricId, targetId, samples, fixtureCounts, fingerprint }) {
  const metric = budget.metric_registry.find(row => row.metric_id === metricId)
  if (!metric) throw new Error(`Unknown metric ${metricId}`)
  return {
    commit_sha: commitSha,
    budget_file_sha256: computeReceiptBudgetHash(budget),
    metric_id: metricId,
    target_id: targetId,
    raw_samples: samples,
    fixture_record_counts: fixtureCounts,
    runner_fingerprint: fingerprint,
    measurement_profile_id: metric.measurement_profile_id,
    actual_execution_profile: profileFor(budget, metric.measurement_profile_id),
    ...calculationFor(metric, samples),
  }
}

function assertMeasuredSuccess(samples, expected, label) {
  if (!Array.isArray(samples) || samples.length !== expected) {
    throw new Error(`${label} must contain exactly ${expected} measured samples`)
  }
  const failures = samples.filter(sample => sample?.outcome && sample.outcome !== 'success')
  if (failures.length) throw new Error(`${label} contains ${failures.length} failed observations`)
}

function assertApiHttpSuccess(samples, label) {
  if (samples.some((sample) => Array.isArray(sample?.pages) && sample.pages.length === 0)) {
    throw new Error(`${label} contains a traversal with no HTTP pages`)
  }
  const observations = samples.flatMap((sample) => Array.isArray(sample?.pages) ? sample.pages : [sample])
  const failures = observations.filter((sample) => sample?.status !== 200)
  if (failures.length) throw new Error(`${label} contains ${failures.length} non-200 or missing HTTP statuses`)
}

function normalizeApiTargets(apiRaw) {
  if (!Array.isArray(apiRaw.targets)) throw new Error('API raw artifact is missing targets')
  return apiRaw.targets
}

function apiReceipts({ apiRaw, budget, commitSha, fingerprint }) {
  const receipts = []
  const requiredMeasurements = budget.measurement_protocols.api.measured_observations_per_target
  for (const target of normalizeApiTargets(apiRaw)) {
    const fixtureId = target.fixture_id
    const fixtureCount = target.fixture_record_count
    assertMeasuredSuccess(target.measurements, requiredMeasurements, `${target.target_id}/${fixtureId} API measurements`)
    assertApiHttpSuccess(target.measurements, `${target.target_id}/${fixtureId} API measurements`)
    const pageSamples = target.measurements.map((sample, index) => ({
      metric_id: 'maximum_page_records',
      target_id: target.target_id,
      measurement_context_id: sample.measurement_context_id ?? `${target.target_id}:${fixtureId}:page:${index}`,
      fixture_id: fixtureId,
      fixture_record_count: fixtureCount,
      page_record_count: sample.page_record_count,
    }))
    const responseSamples = target.measurements.map((sample, index) => ({
      metric_id: 'maximum_response_bytes',
      target_id: target.target_id,
      measurement_context_id: sample.measurement_context_id ?? `${target.target_id}:${fixtureId}:bytes:${index}`,
      fixture_id: fixtureId,
      fixture_record_count: fixtureCount,
      response_content_encoding: sample.response_content_encoding,
      decoded_response_body_utf8_bytes: sample.decoded_response_body_utf8_bytes,
    }))
    const latencySamples = target.measurements.map((sample, index) => ({
      metric_id: 'seeded_api_p95_milliseconds',
      target_id: target.target_id,
      measurement_context_id: sample.measurement_context_id ?? `${target.target_id}:${fixtureId}:latency:${index}`,
      fixture_id: fixtureId,
      fixture_record_count: fixtureCount,
      duration_milliseconds: sample.duration_milliseconds,
    }))
    const targetContract = budget.targets.audited_data_access_paths.find(row => row.target_id === target.target_id)
      ?? budget.targets.chart_payloads.find(row => row.target_id === target.target_id)
    if (!targetContract) throw new Error(`Unexpected API target ${target.target_id}`)
    if (targetContract.metric_ids.includes('maximum_page_records')) {
      receipts.push(receiptBase({ budget, commitSha, metricId: 'maximum_page_records', targetId: target.target_id, samples: pageSamples, fixtureCounts: [fixtureCount], fingerprint }))
    }
    if (targetContract.metric_ids.includes('maximum_response_bytes')) {
      receipts.push(receiptBase({ budget, commitSha, metricId: 'maximum_response_bytes', targetId: target.target_id, samples: responseSamples, fixtureCounts: [fixtureCount], fingerprint }))
    }
    if (targetContract.metric_ids.includes('seeded_api_p95_milliseconds') && fixtureCount === budget.fixtures.largest_seeded_api_fixture_records) {
      receipts.push(receiptBase({ budget, commitSha, metricId: 'seeded_api_p95_milliseconds', targetId: target.target_id, samples: latencySamples, fixtureCounts: [fixtureCount], fingerprint }))
    }
    if (targetContract.metric_ids.includes('maximum_cursor_duplicates')) {
      assertMeasuredSuccess(target.traversals, requiredMeasurements, `${target.target_id}/${fixtureId} cursor traversals`)
      assertApiHttpSuccess(target.traversals, `${target.target_id}/${fixtureId} cursor traversal pages`)
      for (const [metricId, field] of [
        ['maximum_cursor_duplicates', 'duplicate_record_count'],
        ['maximum_cursor_omissions', 'omitted_record_count'],
      ]) {
        const cursorSamples = target.traversals.map((traversal, index) => ({
          metric_id: metricId,
          target_id: target.target_id,
          measurement_context_id: traversal.measurement_context_id ?? `${target.target_id}:${fixtureId}:cursor:${index}`,
          fixture_id: fixtureId,
          fixture_record_count: fixtureCount,
          [field]: traversal.integrity?.[field],
          concurrent_insert_case: traversal.concurrent_insert?.inserted_after_page === 1,
        }))
        receipts.push(receiptBase({ budget, commitSha, metricId, targetId: target.target_id, samples: cursorSamples, fixtureCounts: [fixtureCount], fingerprint }))
      }
    }
  }
  return receipts
}

function browserReceipts({ webVitals, camera, javascript, budget, commitSha, fingerprint, discoveryDirectory }) {
  const receipts = []
  const expectedJourneys = budget.measurement_protocols.web_vitals.measured_navigations_per_route
  for (const journey of webVitals.journeys ?? []) {
    const measured = (journey.samples ?? []).filter(sample => sample.sample_phase === 'measured')
    assertMeasuredSuccess(measured, expectedJourneys, `${journey.target_id} web-vitals journey`)
    for (const [metricId, valueField] of [
      ['lcp_p95_milliseconds', 'lcp_milliseconds'],
      ['inp_p95_milliseconds', 'inp_milliseconds'],
      ['cls_p95_ratio', 'cls_ratio'],
    ]) {
      const samples = measured.map(sample => {
        const base = {
          metric_id: metricId,
          target_id: journey.target_id,
          measurement_context_id: sample.measurement_context_id,
          timing_start_event: metricId === 'inp_p95_milliseconds' ? 'named_interaction_start' : 'navigation_start',
          timing_end_event: metricId === 'lcp_p95_milliseconds'
            ? 'largest_contentful_paint'
            : metricId === 'inp_p95_milliseconds'
              ? 'next_paint_after_event_processing'
              : 'route_hydrated_and_first_interaction_ready',
          [valueField]: sample[valueField],
        }
        if (metricId === 'inp_p95_milliseconds') {
          base.interaction_trace_id = sample.interaction_trace_id
          base.interaction_steps = sample.interaction_steps
        }
        return base
      })
      receipts.push(receiptBase({ budget, commitSha, metricId, targetId: journey.target_id, samples, fixtureCounts: [], fingerprint }))
    }
  }

  for (const [metricId, key] of [
    ['cold_camera_readiness_p95_milliseconds', 'cold'],
    ['warm_camera_readiness_p95_milliseconds', 'warm'],
  ]) {
    const source = camera[key] ?? []
    const expected = key === 'cold'
      ? budget.measurement_protocols.camera.cold_fresh_context_observations
      : budget.measurement_protocols.camera.warm_cached_observations
    assertMeasuredSuccess(source, expected, `${key} camera readiness`)
    const samples = source.map(sample => ({
      metric_id: metricId,
      target_id: budget.targets.camera_readiness.target_id,
      measurement_context_id: sample.measurement_context_id,
      cache_profile: sample.cache_profile,
      timing_start_event: sample.timing_start_event,
      timing_end_event: sample.timing_end_event,
      duration_milliseconds: sample.duration_milliseconds,
      readiness_outcome: sample.readiness_outcome,
    }))
    receipts.push(receiptBase({ budget, commitSha, metricId, targetId: budget.targets.camera_readiness.target_id, samples, fixtureCounts: [], fingerprint }))
  }

  const expectedDiscoveries = {}
  for (const route of javascript.routes ?? []) {
    if (route.outcome !== 'success') throw new Error(`JavaScript discovery failed for ${route.target_id}`)
    const artifactPath = isAbsolute(route.discovery_artifact)
      ? route.discovery_artifact
      : resolve(discoveryDirectory, route.discovery_artifact)
    const artifactBytes = readFileSync(artifactPath)
    const artifactHash = sha256(artifactBytes)
    if (artifactHash !== route.discovery_artifact_sha256) throw new Error(`JavaScript artifact hash mismatch for ${route.target_id}`)
    const included = [...route.included_resource_inventory].sort((a, b) => stable(a).localeCompare(stable(b)))
    const excluded = [...route.excluded_resource_inventory].sort((a, b) => stable(a).localeCompare(stable(b)))
    const inventoryHash = sha256(stable({
      target_id: route.target_id,
      included_resource_inventory: included,
      excluded_resource_inventory: excluded,
    }))
    if (inventoryHash !== route.discovery_inventory_sha256) throw new Error(`JavaScript inventory hash mismatch for ${route.target_id}`)
    expectedDiscoveries[route.target_id] = {
      discovery_artifact_sha256: artifactHash,
      included_resource_inventory: included,
      excluded_resource_inventory: excluded,
    }
    const sample = {
      metric_id: 'maximum_initial_application_javascript_gzip_bytes',
      target_id: route.target_id,
      measurement_context_id: `javascript:${route.target_id}`,
      accounting_start_event: 'navigation_start',
      readiness_cutoff_event: 'route_hydrated_and_first_interaction_ready',
      discovery_artifact_sha256: artifactHash,
      discovery_inventory_sha256: inventoryHash,
      included_resource_inventory: included,
      excluded_resource_inventory: excluded,
      total_included_gzip_bytes: route.total_included_gzip_bytes,
    }
    receipts.push(receiptBase({ budget, commitSha, metricId: 'maximum_initial_application_javascript_gzip_bytes', targetId: route.target_id, samples: [sample], fixtureCounts: [], fingerprint }))
  }
  return { receipts, expectedDiscoveries }
}

/** @param {Record<string, string | undefined>} [environment] */
export function assertOfficialEnvironment(environment = process.env) {
  const failures = []
  if (environment.GITHUB_ACTIONS !== 'true') failures.push('GITHUB_ACTIONS must be true')
  if (environment.RUNNER_OS !== 'Linux') failures.push('RUNNER_OS must be Linux')
  if (environment.ImageOS !== 'ubuntu24') failures.push('ImageOS must be ubuntu24')
  if (process.arch !== 'x64') failures.push('architecture must be x64')
  if (Number(process.versions.node.split('.')[0]) !== 22) failures.push('Node major must be 22')
  if (failures.length) throw new Error(`Official performance environment mismatch: ${failures.join('; ')}`)
}

/**
 * @param {{
 *   browserBuild: string,
 *   browserName: string,
 *   environment?: Record<string, string | undefined>,
 * }} input
 */
export function runnerFingerprint({ browserBuild, environment = process.env, browserName }) {
  const cpuList = cpus()
  return {
    runner_provider: 'github_actions',
    runner_image: 'ubuntu-24.04',
    runner_image_version: environment.ImageVersion ?? 'unknown',
    runner_architecture: 'x64',
    cpu_model: cpuList[0]?.model ?? 'unknown',
    logical_cpu_cores: cpuList.length,
    memory_bytes: totalmem(),
    node_version: process.versions.node,
    browser_name: browserName,
    browser_build: browserBuild,
  }
}

function assertManifest(manifest, rawApi, expectedCommit) {
  if (manifest.local_only !== true) throw new Error('Fixture manifest must be local_only')
  if (manifest.commit_sha && manifest.commit_sha !== expectedCommit) throw new Error('Fixture manifest commit mismatch')
  const counts = (manifest.fixtures ?? []).map(row => row.fixture_record_count).sort((a, b) => a - b)
  if (stable(counts) !== stable(REQUIRED_FIXTURE_COUNTS)) throw new Error('Fixture manifest does not contain exact 150/300/1000 fixtures')
  for (const fixture of manifest.fixtures) {
    const count = fixture.fixture_record_count
    if (fixture.counts?.active_clients !== count || fixture.counts?.complete_anchor_assessments !== count) {
      throw new Error(`Fixture ${fixture.fixture_id} count mismatch`)
    }
    if (fixture.counts?.assessment_findings !== count * fixture.counts?.findings_per_assessment) {
      throw new Error(`Fixture ${fixture.fixture_id} findings count mismatch`)
    }
    if (fixture.expected_client_ids?.length !== count || fixture.expected_assessment_ids?.length !== count) {
      throw new Error(`Fixture ${fixture.fixture_id} expected ID count mismatch`)
    }
    if (fixture.expected_picker_client_ids?.length !== fixture.counts?.picker_search_clients) {
      throw new Error(`Fixture ${fixture.fixture_id} picker-search count mismatch`)
    }
    if (new Set(fixture.expected_client_ids).size !== count || new Set(fixture.expected_assessment_ids).size !== count) {
      throw new Error(`Fixture ${fixture.fixture_id} expected IDs are not unique`)
    }
  }
  if (rawApi.fixture_contract_id !== manifest.fixture_contract_id) throw new Error('API raw fixture contract mismatch')
}

export async function verifyFixturesAgainstDatabase(manifest, databaseUrl) {
  const parsed = new URL(databaseUrl)
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  if (hostname !== 'localhost' && hostname !== '::1' && !hostname.startsWith('127.')) {
    throw new Error('Fixture verification refuses a non-loopback database')
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const verification = []
    for (const fixture of manifest.fixtures) {
      const [clientsResult, assessmentsResult, findingsResult] = await Promise.all([
        client.query('select id::text from public.clients where practitioner_id = $1 and archived_at is null and deleted_at is null order by id', [fixture.practitioner_id]),
        client.query("select id::text from public.assessments where client_id = $1 and status = 'complete' order by id", [fixture.anchor_client_id]),
        client.query("select af.assessment_id::text, af.imbalance_key from public.assessment_findings af join public.assessments a on a.id = af.assessment_id where a.client_id = $1 and a.status = 'complete' order by af.assessment_id, af.imbalance_key", [fixture.anchor_client_id]),
      ])
      const clientIds = clientsResult.rows.map(row => row.id)
      const assessmentIds = assessmentsResult.rows.map(row => row.id)
      if (stable(clientIds) !== stable([...fixture.expected_client_ids].sort())) throw new Error(`Live client ID set mismatch for ${fixture.fixture_id}`)
      if (stable(assessmentIds) !== stable([...fixture.expected_assessment_ids].sort())) throw new Error(`Live assessment ID set mismatch for ${fixture.fixture_id}`)
      if (findingsResult.rowCount !== fixture.counts.assessment_findings) throw new Error(`Live finding count mismatch for ${fixture.fixture_id}`)
      const pickerResult = await client.query(
        `select id::text
           from public.clients
          where practitioner_id = $1
            and archived_at is null
            and deleted_at is null
            and (
              first_name ilike $2 || '%'
              or last_name ilike $2 || '%'
              or (first_name || ' ' || last_name) ilike $2 || '%'
              or (last_name || ' ' || first_name) ilike $2 || '%'
            )
          order by id`,
        [fixture.practitioner_id, fixture.browser.client_search_query],
      )
      const pickerIds = pickerResult.rows.map(row => row.id)
      if (stable(pickerIds) !== stable([...fixture.expected_picker_client_ids].sort())) {
        throw new Error(`Live picker-search ID set mismatch for ${fixture.fixture_id}`)
      }
      verification.push({
        fixture_id: fixture.fixture_id,
        active_clients: clientIds.length,
        complete_anchor_assessments: assessmentIds.length,
        assessment_findings: findingsResult.rowCount,
        picker_search_clients: pickerIds.length,
        client_ids_sha256: sha256(stable(clientIds)),
        assessment_ids_sha256: sha256(stable(assessmentIds)),
      })
    }
    return verification
  } finally {
    await client.end()
  }
}

export function assertQueryPlanSourceBindings(queryPlans, root = ROOT) {
  if (queryPlans.query_capture_kind !== 'reconstructed_sql_bound_to_source_hashes') {
    throw new Error('Query-plan SQL is not labeled as a source-bound reconstruction')
  }
  const declared = Array.isArray(queryPlans.provenance?.query_source_files)
    ? queryPlans.provenance.query_source_files
    : []
  const byPath = new Map(declared.map((source) => [source?.path, source?.sha256]))
  if (declared.length !== QUERY_SOURCE_PATHS.length || byPath.size !== QUERY_SOURCE_PATHS.length) {
    throw new Error('Query-plan source binding set is incomplete or duplicated')
  }
  for (const path of QUERY_SOURCE_PATHS) {
    const expectedHash = sha256(readFileSync(resolve(root, path)))
    if (byPath.get(path) !== expectedHash) throw new Error(`Query-plan source hash mismatch: ${path}`)
  }
}

function assertQueryPlans(queryPlans, fixtureManifestHash, commitSha) {
  if (queryPlans.status !== 'PASS' || (queryPlans.errors ?? []).length !== 0) throw new Error('Query-plan artifact did not pass its own structural gate')
  if (queryPlans.provenance?.head_commit_sha !== commitSha) throw new Error('Query-plan commit mismatch')
  if (queryPlans.provenance?.fixture_manifest_sha256 !== fixtureManifestHash) throw new Error('Query-plan fixture manifest hash mismatch')
  assertQueryPlanSourceBindings(queryPlans)
  const serialized = stable(queryPlans)
  for (const targetId of REQUIRED_QUERY_TARGETS) {
    if (!serialized.includes(JSON.stringify(targetId))) throw new Error(`Query-plan target missing: ${targetId}`)
  }
  if (!serialized.includes('retrospective_reconstruction')) throw new Error('Query-plan before profile is not labeled retrospective reconstruction')
  if (!serialized.includes('before') || !serialized.includes('after')) throw new Error('Query-plan artifact must contain before and after plans')
}

export function buildPerformanceReceiptSet({
  apiRaw,
  webVitals,
  camera,
  javascript,
  budget,
  expectedCommit,
  apiFingerprint,
  browserFingerprint,
  discoveryDirectory,
}) {
  const api = apiReceipts({
    apiRaw,
    budget,
    commitSha: expectedCommit,
    fingerprint: apiFingerprint,
  })
  const browser = browserReceipts({
    webVitals,
    camera,
    javascript,
    budget,
    commitSha: expectedCommit,
    fingerprint: browserFingerprint,
    discoveryDirectory,
  })
  return {
    receipts: [...api, ...browser.receipts],
    expectedJavascriptDiscoveries: browser.expectedDiscoveries,
  }
}

export async function compileAndValidatePerformanceReceipts(options) {
  assertOfficialEnvironment(options.environment)
  const budget = readJson(options.budgetPath)
  const fixtureBytes = readFileSync(options.fixtureManifestPath)
  const fixtureHash = sha256(fixtureBytes)
  const manifest = JSON.parse(fixtureBytes.toString('utf8'))
  const apiRaw = readJson(options.apiRawPath)
  const webVitals = readJson(options.webVitalsPath)
  const camera = readJson(options.cameraPath)
  const javascript = readJson(options.javascriptPath)
  const queryPlans = readJson(options.queryPlansPath)
  for (const artifact of [apiRaw, webVitals, camera, javascript]) {
    if (artifact.commit_sha && artifact.commit_sha !== options.expectedCommit) throw new Error(`${artifact.artifact_kind ?? 'raw'} commit mismatch`)
  }
  assertManifest(manifest, apiRaw, options.expectedCommit)
  if (apiRaw.fixture_manifest_sha256 !== fixtureHash) throw new Error('API raw fixture manifest hash mismatch')
  if (apiRaw.evidence_class !== 'OFFICIAL') throw new Error('API raw artifact is not official evidence')
  if (stable(apiRaw.actual_execution_profile) !== stable(profileFor(budget, 'api_local_ci'))) {
    throw new Error('API raw execution profile does not match the frozen profile')
  }
  assertQueryPlans(queryPlans, fixtureHash, options.expectedCommit)
  const liveFixtureVerification = await verifyFixturesAgainstDatabase(manifest, options.databaseUrl)
  const apiFingerprint = apiRaw.runner_fingerprint ?? runnerFingerprint({ browserName: 'not_applicable', browserBuild: 'not_applicable', environment: options.environment })
  const metadata = readJson(options.browserMetadataPath)
  if (metadata.commit_sha !== options.expectedCommit) throw new Error('Browser metadata commit mismatch')
  if (metadata.official_environment !== true) throw new Error('Browser raw artifact is not from the official environment')
  for (const profileId of ['throttled_browser_camera', 'deterministic_bundle']) {
    if (stable(metadata.actual_execution_profiles?.[profileId]) !== stable(profileFor(budget, profileId))) {
      throw new Error(`Browser raw execution profile does not match ${profileId}`)
    }
  }
  const browserBuild = metadata.runner_fingerprint?.browser_build ?? metadata.browser_build
  if (typeof browserBuild !== 'string' || browserBuild.length === 0) throw new Error('Browser build is missing from run metadata')
  const browserFingerprint = metadata.runner_fingerprint ?? runnerFingerprint({ browserName: 'chromium', browserBuild, environment: options.environment })
  const built = buildPerformanceReceiptSet({
    apiRaw,
    webVitals,
    camera,
    javascript,
    budget,
    expectedCommit: options.expectedCommit,
    apiFingerprint,
    browserFingerprint,
    discoveryDirectory: dirname(options.javascriptPath),
  })
  const receipts = built.receipts
  const validation = validatePerformanceReceiptSet(receipts, budget, {
    expectedCommitSha: options.expectedCommit,
    expectedJavascriptDiscoveries: built.expectedJavascriptDiscoveries,
  })
  const result = {
    status: validation.status,
    performance_status: validation.status === 'PASS' ? 'MEASURED_PASS' : 'MEASURED_FAIL',
    performance_claimed: validation.status === 'PASS',
    official_environment: true,
    expected_commit: options.expectedCommit,
    fixture_manifest_sha256: fixtureHash,
    live_fixture_verification: liveFixtureVerification,
    receipt_count: receipts.length,
    raw_sample_count: receipts.reduce((sum, receipt) => sum + receipt.raw_samples.length, 0),
    errors: validation.errors,
  }
  return { receipts, result }
}

function parseArgs(argv) {
  const options = { resultsDirectory: DEFAULT_RESULTS, budgetPath: DEFAULT_BUDGET }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`)
    if (argument === '--results') options.resultsDirectory = resolve(value)
    else if (argument === '--budget') options.budgetPath = resolve(value)
    else if (argument === '--expected-commit') options.expectedCommit = value
    else if (argument === '--database-url') options.databaseUrl = value
    else throw new Error(`Unknown argument ${argument}`)
    index += 1
  }
  if (!/^[a-f0-9]{40}$/.test(options.expectedCommit ?? '')) throw new Error('--expected-commit must be a lowercase 40-character SHA')
  options.databaseUrl ??= process.env.PERF_DB_URL
  if (!options.databaseUrl) throw new Error('PERF_DB_URL is required')
  return {
    ...options,
    fixtureManifestPath: resolve(options.resultsDirectory, 'fixture-manifest.json'),
    apiRawPath: resolve(options.resultsDirectory, 'api-raw.json'),
    webVitalsPath: resolve(options.resultsDirectory, 'web-vitals.raw.json'),
    cameraPath: resolve(options.resultsDirectory, 'camera.raw.json'),
    javascriptPath: resolve(options.resultsDirectory, 'javascript.raw.json'),
    browserMetadataPath: resolve(options.resultsDirectory, 'run-metadata.json'),
    queryPlansPath: resolve(options.resultsDirectory, 'query-plans.json'),
    receiptsPath: resolve(options.resultsDirectory, 'receipts.json'),
    resultPath: resolve(options.resultsDirectory, 'validation-result.json'),
  }
}

async function main() {
  let paths
  try {
    paths = parseArgs(process.argv.slice(2))
    const { receipts, result } = await compileAndValidatePerformanceReceipts({ ...paths, environment: process.env })
    writeFileSync(paths.receiptsPath, `${JSON.stringify(receipts, null, 2)}\n`)
    writeFileSync(paths.resultPath, `${JSON.stringify(result, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify(result)}\n`)
    if (result.status !== 'PASS') process.exitCode = 1
  } catch (caught) {
    const result = {
      status: 'FAIL',
      performance_status: 'MEASURED_FAIL',
      performance_claimed: false,
      official_environment: false,
      errors: [caught instanceof Error ? caught.message : String(caught)],
    }
    if (paths?.resultPath) writeFileSync(paths.resultPath, `${JSON.stringify(result, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) await main()

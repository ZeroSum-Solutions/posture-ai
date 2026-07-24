import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import budget from '../../docs/qa/performance-budgets.json'
import { validatePerformanceReceiptSet } from '../check-performance-budgets.mjs'
import {
  assertOfficialEnvironment,
  assertQueryPlanSourceBindings,
  buildPerformanceReceiptSet,
} from './check-receipts.mjs'
import { QUERY_SOURCE_PATHS } from './capture-query-plans.mjs'

const COMMIT = 'a'.repeat(40)
const directories: string[] = []

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${stable(row[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

const apiFingerprint = {
  runner_provider: 'github_actions',
  runner_image: 'ubuntu-24.04',
  runner_image_version: 'test-image',
  runner_architecture: 'x64',
  cpu_model: 'test-cpu',
  logical_cpu_cores: 4,
  memory_bytes: 8_000_000_000,
  node_version: '22.17.0',
  browser_name: 'not_applicable',
  browser_build: 'not_applicable',
}

const browserFingerprint = {
  ...apiFingerprint,
  browser_name: 'chromium',
  browser_build: 'Chromium 140.0',
}

function createApiRaw() {
  const targets = [
    ...budget.targets.audited_data_access_paths,
    ...budget.targets.chart_payloads,
  ].flatMap(target => budget.fixtures.catalog.map(fixture => ({
    target_id: target.target_id,
    fixture_id: fixture.fixture_id,
    fixture_record_count: fixture.fixture_record_count,
    measurements: Array.from({ length: 40 }, (_, index) => ({
      measurement_context_id: `${target.target_id}:${fixture.fixture_id}:api:${index}`,
      status: 200,
      page_record_count: Math.min(50, fixture.fixture_record_count),
      decoded_response_body_utf8_bytes: 100,
      response_content_encoding: 'identity',
      duration_milliseconds: 10,
    })),
    traversals: target.metric_ids.includes('maximum_cursor_duplicates')
      ? Array.from({ length: 40 }, (_, index) => ({
          measurement_context_id: `${target.target_id}:${fixture.fixture_id}:cursor:${index}`,
          pages: [{ status: 200 }],
          integrity: { duplicate_record_count: 0, omitted_record_count: 0 },
          concurrent_insert: { inserted_after_page: 1 },
        }))
      : undefined,
  })))
  return { targets }
}

function createWebVitals() {
  return {
    journeys: budget.targets.web_vitals_journeys.map(journey => ({
      target_id: journey.target_id,
      samples: Array.from({ length: 20 }, (_, index) => ({
        measurement_context_id: `${journey.target_id}:web:${index}`,
        sample_phase: 'measured',
        outcome: 'success',
        lcp_milliseconds: 100,
        cls_ratio: 0.01,
        interaction_trace_id: journey.inp_interaction_trace_id,
        interaction_steps: journey.inp_interaction_steps.map((interaction_step_id, stepIndex) => ({
          interaction_step_id,
          duration_milliseconds: stepIndex + 1,
        })),
        inp_milliseconds: journey.inp_interaction_steps.length,
      })),
    })),
  }
}

function createCamera() {
  const sample = (cache: string, index: number) => ({
    measurement_context_id: `${cache}:${index}`,
    outcome: 'success',
    cache_profile: cache,
    timing_start_event: 'assessment_capture_route_navigation_start',
    timing_end_event: 'pose_runtime_ready_for_first_inference',
    duration_milliseconds: 100,
    readiness_outcome: 'success',
  })
  return {
    cold: Array.from({ length: 20 }, (_, index) => sample('cold_fresh_context', index)),
    warm: Array.from({ length: 20 }, (_, index) => sample('warm_cached', index)),
  }
}

function createJavascript(directory: string) {
  return {
    routes: budget.targets.initial_application_javascript_routes.map((targetId, index) => {
      const artifact = JSON.stringify({ target_id: targetId, resources: [`chunk-${index}.js`] })
      const artifactName = `discovery-${index}.json`
      writeFileSync(join(directory, artifactName), artifact)
      const included = [{ resource_url: `/_next/static/chunk-${index}.js`, gzip_bytes: 10 }]
      const excluded: Array<{ resource_url: string; gzip_bytes: number; matched_allowed_url_prefix: string }> = []
      return {
        target_id: targetId,
        outcome: 'success',
        discovery_artifact: artifactName,
        discovery_artifact_sha256: sha256(artifact),
        discovery_inventory_sha256: sha256(stable({
          target_id: targetId,
          included_resource_inventory: included,
          excluded_resource_inventory: excluded,
        })),
        included_resource_inventory: included,
        excluded_resource_inventory: excluded,
        total_included_gzip_bytes: 10,
      }
    }),
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('official performance receipt compiler', () => {
  it('builds the exact frozen 82-receipt and 2,688-sample matrix', () => {
    const directory = mkdtempSync(join(tmpdir(), 'posture-performance-'))
    directories.push(directory)
    const built = buildPerformanceReceiptSet({
      apiRaw: createApiRaw(),
      webVitals: createWebVitals(),
      camera: createCamera(),
      javascript: createJavascript(directory),
      budget,
      expectedCommit: COMMIT,
      apiFingerprint,
      browserFingerprint,
      discoveryDirectory: directory,
    })
    expect(built.receipts).toHaveLength(82)
    expect(built.receipts.reduce((sum, receipt) => sum + receipt.raw_samples.length, 0)).toBe(2688)
    expect(validatePerformanceReceiptSet(built.receipts, budget, {
      expectedCommitSha: COMMIT,
      expectedJavascriptDiscoveries: built.expectedJavascriptDiscoveries,
    })).toEqual({ status: 'PASS', errors: [] })
  })

  it('rejects a failed browser observation instead of dropping it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'posture-performance-'))
    directories.push(directory)
    const webVitals = createWebVitals()
    webVitals.journeys[0]!.samples[0]!.outcome = 'timeout'
    expect(() => buildPerformanceReceiptSet({
      apiRaw: createApiRaw(),
      webVitals,
      camera: createCamera(),
      javascript: createJavascript(directory),
      budget,
      expectedCommit: COMMIT,
      apiFingerprint,
      browserFingerprint,
      discoveryDirectory: directory,
    })).toThrow(/failed observations/)
  })

  it('rejects a failed or missing API HTTP status even when numeric samples look valid', () => {
    const directory = mkdtempSync(join(tmpdir(), 'posture-performance-'))
    directories.push(directory)
    const apiRaw = createApiRaw()
    apiRaw.targets[0]!.measurements[0]!.status = 500
    expect(() => buildPerformanceReceiptSet({
      apiRaw,
      webVitals: createWebVitals(),
      camera: createCamera(),
      javascript: createJavascript(directory),
      budget,
      expectedCommit: COMMIT,
      apiFingerprint,
      browserFingerprint,
      discoveryDirectory: directory,
    })).toThrow(/non-200 or missing HTTP statuses/)
  })

  it('rejects a failed cursor traversal page status', () => {
    const directory = mkdtempSync(join(tmpdir(), 'posture-performance-'))
    directories.push(directory)
    const apiRaw = createApiRaw()
    const traversals = apiRaw.targets.find((target) => target.traversals)?.traversals
    traversals![0]!.pages[0]!.status = 503
    expect(() => buildPerformanceReceiptSet({
      apiRaw,
      webVitals: createWebVitals(),
      camera: createCamera(),
      javascript: createJavascript(directory),
      budget,
      expectedCommit: COMMIT,
      apiFingerprint,
      browserFingerprint,
      discoveryDirectory: directory,
    })).toThrow(/non-200 or missing HTTP statuses/)
  })

  it('independently rejects a tampered JavaScript discovery artifact', () => {
    const directory = mkdtempSync(join(tmpdir(), 'posture-performance-'))
    directories.push(directory)
    const javascript = createJavascript(directory)
    writeFileSync(join(directory, javascript.routes[0]!.discovery_artifact), '{"tampered":true}')
    expect(() => buildPerformanceReceiptSet({
      apiRaw: createApiRaw(),
      webVitals: createWebVitals(),
      camera: createCamera(),
      javascript,
      budget,
      expectedCommit: COMMIT,
      apiFingerprint,
      browserFingerprint,
      discoveryDirectory: directory,
    })).toThrow(/artifact hash mismatch/)
  })

  it('refuses to call a local or wrong-image run official', () => {
    expect(() => assertOfficialEnvironment({
      GITHUB_ACTIONS: 'false',
      RUNNER_OS: 'macOS',
      ImageOS: 'macos-15',
    })).toThrow(/Official performance environment mismatch/)
  })

  it('binds reconstructed query plans to the exact route, RPC, and index sources', () => {
    const queryPlans = {
      query_capture_kind: 'reconstructed_sql_bound_to_source_hashes',
      provenance: {
        query_source_files: QUERY_SOURCE_PATHS.map((path) => ({
          path,
          sha256: sha256(readFileSync(resolve(process.cwd(), path))),
        })),
      },
    }
    expect(() => assertQueryPlanSourceBindings(queryPlans)).not.toThrow()
    queryPlans.provenance.query_source_files[0]!.sha256 = '0'.repeat(64)
    expect(() => assertQueryPlanSourceBindings(queryPlans)).toThrow(/source hash mismatch/)
  })
})

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import {
  checkPerformanceBudgetFiles,
  validatePerformanceReceipt,
  validatePerformanceReceiptSet,
  validatePerformanceBudgets,
} from './check-performance-budgets.mjs'

const ROOT = join(import.meta.dirname, '..')
const BUDGET_PATH = join(ROOT, 'docs/qa/performance-budgets.json')
const SCHEMA_PATH = join(ROOT, 'docs/qa/performance-budgets.schema.json')
const CHECKER_PATH = join(import.meta.dirname, 'check-performance-budgets.mjs')
const BUDGET = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'))
const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const TEMPORARY_DIRECTORIES: string[] = []
const EXPECTED_METRIC_REGISTRY = [
  { metric_id: 'maximum_page_records', budget_field: 'budgets.maximum_page_records', observed_value_field: 'page_record_count', unit: 'count', aggregation: 'maximum', comparison_operator: 'less_than_or_equal', receipt_fields_contract: 'page_size_observation_required_fields', calculation_fields_contract: 'maximum_calculation_required_fields', measurement_profile_id: 'api_local_ci', fixture_policy_id: 'single_seeded_fixture' },
  { metric_id: 'maximum_response_bytes', budget_field: 'budgets.maximum_response_bytes', observed_value_field: 'decoded_response_body_utf8_bytes', unit: 'bytes', aggregation: 'maximum', comparison_operator: 'less_than_or_equal', receipt_fields_contract: 'api_response_size_observation_required_fields', calculation_fields_contract: 'maximum_calculation_required_fields', measurement_profile_id: 'api_local_ci', fixture_policy_id: 'single_seeded_fixture' },
  { metric_id: 'seeded_api_p95_milliseconds', budget_field: 'budgets.seeded_api_p95_milliseconds', observed_value_field: 'duration_milliseconds', unit: 'milliseconds', aggregation: 'nearest_rank_p95', comparison_operator: 'less_than_or_equal', receipt_fields_contract: 'api_latency_observation_required_fields', calculation_fields_contract: 'nearest_rank_p95_calculation_required_fields', measurement_profile_id: 'api_local_ci', fixture_policy_id: 'largest_seeded_api_fixture' },
  { metric_id: 'lcp_p95_milliseconds', budget_field: 'budgets.lcp_p95_milliseconds', observed_value_field: 'lcp_milliseconds', unit: 'milliseconds', aggregation: 'nearest_rank_p95', comparison_operator: 'less_than_or_equal', receipt_fields_contract: 'lcp_observation_required_fields', calculation_fields_contract: 'nearest_rank_p95_calculation_required_fields', measurement_profile_id: 'throttled_browser_camera', fixture_policy_id: 'not_applicable' },
  { metric_id: 'inp_p95_milliseconds', budget_field: 'budgets.inp_p95_milliseconds', observed_value_field: 'inp_milliseconds', unit: 'milliseconds', aggregation: 'nearest_rank_p95', comparison_operator: 'less_than_or_equal', receipt_fields_contract: 'inp_observation_required_fields', calculation_fields_contract: 'nearest_rank_p95_calculation_required_fields', measurement_profile_id: 'throttled_browser_camera', fixture_policy_id: 'not_applicable' },
  { metric_id: 'cls_p95_ratio', budget_field: 'budgets.cls_p95_ratio', observed_value_field: 'cls_ratio', unit: 'unitless_ratio', aggregation: 'nearest_rank_p95', comparison_operator: 'less_than_or_equal', receipt_fields_contract: 'cls_observation_required_fields', calculation_fields_contract: 'nearest_rank_p95_calculation_required_fields', measurement_profile_id: 'throttled_browser_camera', fixture_policy_id: 'not_applicable' },
  { metric_id: 'maximum_initial_application_javascript_gzip_bytes', budget_field: 'budgets.maximum_initial_application_javascript_gzip_bytes', observed_value_field: 'total_included_gzip_bytes', unit: 'gzip_bytes', aggregation: 'maximum', comparison_operator: 'less_than_or_equal', receipt_fields_contract: 'initial_javascript_route_required_fields', calculation_fields_contract: 'maximum_calculation_required_fields', measurement_profile_id: 'deterministic_bundle', fixture_policy_id: 'not_applicable' },
  { metric_id: 'cold_camera_readiness_p95_milliseconds', budget_field: 'budgets.cold_camera_readiness_p95_milliseconds', observed_value_field: 'duration_milliseconds', unit: 'milliseconds', aggregation: 'nearest_rank_p95', comparison_operator: 'less_than_or_equal', receipt_fields_contract: 'camera_observation_required_fields', calculation_fields_contract: 'nearest_rank_p95_calculation_required_fields', measurement_profile_id: 'throttled_browser_camera', fixture_policy_id: 'not_applicable' },
  { metric_id: 'warm_camera_readiness_p95_milliseconds', budget_field: 'budgets.warm_camera_readiness_p95_milliseconds', observed_value_field: 'duration_milliseconds', unit: 'milliseconds', aggregation: 'nearest_rank_p95', comparison_operator: 'less_than_or_equal', receipt_fields_contract: 'camera_observation_required_fields', calculation_fields_contract: 'nearest_rank_p95_calculation_required_fields', measurement_profile_id: 'throttled_browser_camera', fixture_policy_id: 'not_applicable' },
  { metric_id: 'maximum_cursor_duplicates', budget_field: 'budgets.maximum_cursor_duplicates', observed_value_field: 'duplicate_record_count', unit: 'count', aggregation: 'maximum', comparison_operator: 'less_than_or_equal', receipt_fields_contract: 'cursor_duplicate_observation_required_fields', calculation_fields_contract: 'maximum_calculation_required_fields', measurement_profile_id: 'api_local_ci', fixture_policy_id: 'single_seeded_fixture' },
  { metric_id: 'maximum_cursor_omissions', budget_field: 'budgets.maximum_cursor_omissions', observed_value_field: 'omitted_record_count', unit: 'count', aggregation: 'maximum', comparison_operator: 'less_than_or_equal', receipt_fields_contract: 'cursor_omission_observation_required_fields', calculation_fields_contract: 'maximum_calculation_required_fields', measurement_profile_id: 'api_local_ci', fixture_policy_id: 'single_seeded_fixture' },
]
const EXPECTED_COMMIT_SHA = 'a'.repeat(40)
const DISCOVERY_ARTIFACT_SHA256 = 'd'.repeat(64)
const DISCOVERED_INCLUDED_RESOURCES = [
  { resource_url: '/_next/static/chunks/app.js', gzip_bytes: 100000 },
  { resource_url: '/_next/static/chunks/framework.js', gzip_bytes: 50000 },
]
const DISCOVERED_EXCLUDED_RESOURCES = [
  { resource_url: '/mediapipe/model.task', gzip_bytes: 5000000, matched_allowed_url_prefix: '/mediapipe/' },
]

type TestReceipt = {
  commit_sha: string
  budget_file_sha256: string
  metric_id: string
  target_id: string
  raw_samples: Array<Record<string, unknown>>
  fixture_record_counts: number[]
  runner_fingerprint: Record<string, unknown>
  measurement_profile_id: string
  actual_execution_profile: Record<string, unknown>
  aggregation: string
  calculated_maximum?: number
  calculated_nearest_rank?: number
  calculated_p95?: number
}

afterEach(() => {
  for (const directory of TEMPORARY_DIRECTORIES.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function receiptBudgetHash(): string {
  const value = clone(BUDGET)
  if (value.receipt_contract?.budget_hash_binding) delete value.receipt_contract.budget_hash_binding.expected_sha256
  return createHash('sha256').update(stable(value)).digest('hex')
}

function javascriptDiscoveryInventoryHash(targetId: string): string {
  return createHash('sha256').update(stable({
    target_id: targetId,
    included_resource_inventory: DISCOVERED_INCLUDED_RESOURCES,
    excluded_resource_inventory: DISCOVERED_EXCLUDED_RESOURCES,
  })).digest('hex')
}

function expectedJavascriptDiscoveries() {
  return Object.fromEntries(BUDGET.targets.initial_application_javascript_routes.map((targetId: string) => [
    targetId,
    {
      discovery_artifact_sha256: DISCOVERY_ARTIFACT_SHA256,
      included_resource_inventory: clone(DISCOVERED_INCLUDED_RESOURCES),
      excluded_resource_inventory: clone(DISCOVERED_EXCLUDED_RESOURCES),
    },
  ]))
}

function receiptValidationContext() {
  return {
    expectedCommitSha: EXPECTED_COMMIT_SHA,
    expectedJavascriptDiscoveries: expectedJavascriptDiscoveries(),
  }
}

function targetMetricIds(value: typeof BUDGET): string[] {
  return [
    ...value.targets.audited_data_access_paths.flatMap((target: { metric_ids: string[] }) => target.metric_ids),
    ...value.targets.chart_payloads.flatMap((target: { metric_ids: string[] }) => target.metric_ids),
    ...value.targets.web_vitals_journeys.flatMap((target: { metric_ids: string[] }) => target.metric_ids),
    value.targets.initial_application_javascript_metric_id,
    ...value.targets.camera_readiness.metric_ids,
  ]
}

function allowedTargetsForMetric(metricId: string): string[] {
  const ids = [
    ...BUDGET.targets.audited_data_access_paths.filter((target: { metric_ids: string[] }) => target.metric_ids.includes(metricId)).map((target: { target_id: string }) => target.target_id),
    ...BUDGET.targets.chart_payloads.filter((target: { metric_ids: string[] }) => target.metric_ids.includes(metricId)).map((target: { target_id: string }) => target.target_id),
    ...BUDGET.targets.web_vitals_journeys.filter((target: { metric_ids: string[] }) => target.metric_ids.includes(metricId)).map((target: { target_id: string }) => target.target_id),
  ]
  if (BUDGET.targets.initial_application_javascript_metric_id === metricId) ids.push(...BUDGET.targets.initial_application_javascript_routes)
  if (BUDGET.targets.camera_readiness.metric_ids.includes(metricId)) ids.push(BUDGET.targets.camera_readiness.target_id)
  return ids
}

function receiptFor(metricId: string, targetId: string, observations: Record<string, unknown> | Record<string, unknown>[]): TestReceipt {
  const mapping = BUDGET.metric_registry.find((row: { metric_id: string }) => row.metric_id === metricId)
  const profile = BUDGET.measurement_profiles.find((row: { profile_id: string }) => row.profile_id === mapping.measurement_profile_id)
  const rawSamples = Array.isArray(observations) ? observations : [observations]
  const fixtureRecordCount = rawSamples[0]?.fixture_record_count
  const observedValues = rawSamples.map(sample => sample[mapping.observed_value_field] as number)
  const sorted = [...observedValues].sort((left, right) => left - right)
  const nearestRank = Math.ceil(0.95 * observedValues.length)
  return {
    commit_sha: EXPECTED_COMMIT_SHA,
    budget_file_sha256: receiptBudgetHash(),
    metric_id: metricId,
    target_id: targetId,
    raw_samples: rawSamples,
    fixture_record_counts: typeof fixtureRecordCount === 'number' ? [fixtureRecordCount] : [],
    runner_fingerprint: {
      runner_provider: profile.expected_actual_execution_profile.runner_provider,
      runner_image: profile.expected_actual_execution_profile.runner_image,
      runner_image_version: '20260720.1',
      runner_architecture: profile.expected_actual_execution_profile.runner_architecture,
      cpu_model: 'GitHub Actions x64 runner',
      logical_cpu_cores: 4,
      memory_bytes: 17179869184,
      node_version: '22.17.0',
      browser_name: profile.expected_actual_execution_profile.browser_engine ?? 'not_applicable',
      browser_build: profile.expected_actual_execution_profile.browser_engine ? '128.0.0.0' : 'not_applicable',
    },
    measurement_profile_id: mapping.measurement_profile_id,
    actual_execution_profile: clone(profile.expected_actual_execution_profile),
    aggregation: mapping.aggregation,
    ...(mapping.aggregation === 'maximum'
      ? { calculated_maximum: Math.max(...observedValues) }
      : { calculated_nearest_rank: nearestRank, calculated_p95: sorted[nearestRank - 1] }),
  }
}

function repeatedObservation(observation: Record<string, unknown>, count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_value, index) => ({
    ...clone(observation),
    ...(Object.hasOwn(observation, 'measurement_context_id')
      ? { measurement_context_id: `${observation.measurement_context_id}_${index + 1}` }
      : {}),
  }))
}

function validApiLatencyReceipt() {
  return receiptFor('seeded_api_p95_milliseconds', 'clients_api_list', repeatedObservation({
    metric_id: 'seeded_api_p95_milliseconds',
    target_id: 'clients_api_list',
    measurement_context_id: 'clients_api_list_seeded_records_1000',
    fixture_id: 'seeded_records_1000',
    fixture_record_count: 1000,
    duration_milliseconds: 500,
  }, 40))
}

function validLcpReceipt() {
  return receiptFor('lcp_p95_milliseconds', 'client_selection_journey', repeatedObservation({
    metric_id: 'lcp_p95_milliseconds',
    target_id: 'client_selection_journey',
    measurement_context_id: 'client_selection_journey',
    timing_start_event: 'navigation_start',
    timing_end_event: 'largest_contentful_paint',
    lcp_milliseconds: 1800,
  }, 20))
}

function validMaximumPageReceipt() {
  return receiptFor('maximum_page_records', 'clients_page_list', repeatedObservation({
    metric_id: 'maximum_page_records',
    target_id: 'clients_page_list',
    measurement_context_id: 'clients_page_list_seeded_records_150',
    fixture_id: 'seeded_records_150',
    fixture_record_count: 150,
    page_record_count: 50,
  }, 40))
}

function validInpReceipt() {
  const journey = BUDGET.targets.web_vitals_journeys[0]
  return receiptFor('inp_p95_milliseconds', journey.target_id, repeatedObservation({
    metric_id: 'inp_p95_milliseconds',
    target_id: journey.target_id,
    measurement_context_id: journey.target_id,
    interaction_trace_id: journey.inp_interaction_trace_id,
    interaction_step_id: journey.inp_interaction_steps[0],
    interaction_steps: journey.inp_interaction_steps.map((interaction_step_id: string, index: number) => ({
      interaction_step_id,
      duration_milliseconds: 100 + index,
    })),
    timing_start_event: 'named_interaction_start',
    timing_end_event: 'next_paint_after_event_processing',
    inp_milliseconds: 102,
  }, 20))
}

function validColdCameraReceipt() {
  return receiptFor('cold_camera_readiness_p95_milliseconds', 'assessment_camera_readiness', repeatedObservation({
    metric_id: 'cold_camera_readiness_p95_milliseconds',
    target_id: 'assessment_camera_readiness',
    measurement_context_id: 'cold_camera_readiness',
    cache_profile: 'cold_fresh_context',
    timing_start_event: 'assessment_capture_route_navigation_start',
    timing_end_event: 'pose_runtime_ready_for_first_inference',
    duration_milliseconds: 10000,
    readiness_outcome: 'success',
  }, 20))
}

function validJavascriptReceipt(targetId = '/dashboard') {
  return receiptFor('maximum_initial_application_javascript_gzip_bytes', targetId, {
    metric_id: 'maximum_initial_application_javascript_gzip_bytes',
    target_id: targetId,
    measurement_context_id: `javascript_${targetId}`,
    accounting_start_event: 'navigation_start',
    readiness_cutoff_event: 'route_hydrated_and_first_interaction_ready',
    discovery_artifact_sha256: DISCOVERY_ARTIFACT_SHA256,
    discovery_inventory_sha256: javascriptDiscoveryInventoryHash(targetId),
    included_resource_inventory: clone(DISCOVERED_INCLUDED_RESOURCES),
    excluded_resource_inventory: clone(DISCOVERED_EXCLUDED_RESOURCES),
    total_included_gzip_bytes: 150000,
  })
}

function validReceiptForMatrix(metricId: string, targetId: string, fixtureId?: string, fixtureRecordCount?: number) {
  const mapping = BUDGET.metric_registry.find((row: { metric_id: string }) => row.metric_id === metricId)
  if (mapping.measurement_profile_id === 'api_local_ci') {
    const values: Record<string, number> = {
      page_record_count: 50,
      decoded_response_body_utf8_bytes: 1000,
      duration_milliseconds: 500,
      duplicate_record_count: 0,
      omitted_record_count: 0,
    }
    return receiptFor(metricId, targetId, repeatedObservation({
      metric_id: metricId,
      target_id: targetId,
      measurement_context_id: `${metricId}_${targetId}_${fixtureId}`,
      fixture_id: fixtureId,
      fixture_record_count: fixtureRecordCount,
      ...(mapping.receipt_fields_contract === 'api_response_size_observation_required_fields' ? { response_content_encoding: 'identity' } : {}),
      ...(['maximum_cursor_duplicates', 'maximum_cursor_omissions'].includes(metricId) ? { concurrent_insert_case: true } : {}),
      [mapping.observed_value_field]: values[mapping.observed_value_field],
    }, 40))
  }
  if (metricId === 'lcp_p95_milliseconds') {
    return receiptFor(metricId, targetId, repeatedObservation({
      metric_id: metricId,
      target_id: targetId,
      measurement_context_id: `${metricId}_${targetId}`,
      timing_start_event: 'navigation_start',
      timing_end_event: 'largest_contentful_paint',
      lcp_milliseconds: 1800,
    }, 20))
  }
  if (metricId === 'inp_p95_milliseconds') {
    const journey = BUDGET.targets.web_vitals_journeys.find((row: { target_id: string }) => row.target_id === targetId)
    const interactionSteps = journey.inp_interaction_steps.map((interaction_step_id: string, index: number) => ({ interaction_step_id, duration_milliseconds: 100 + index }))
    return receiptFor(metricId, targetId, repeatedObservation({
      metric_id: metricId,
      target_id: targetId,
      measurement_context_id: `${metricId}_${targetId}`,
      interaction_trace_id: journey.inp_interaction_trace_id,
      interaction_steps: interactionSteps,
      timing_start_event: 'named_interaction_start',
      timing_end_event: 'next_paint_after_event_processing',
      inp_milliseconds: 100 + interactionSteps.length - 1,
    }, 20))
  }
  if (metricId === 'cls_p95_ratio') {
    return receiptFor(metricId, targetId, repeatedObservation({
      metric_id: metricId,
      target_id: targetId,
      measurement_context_id: `${metricId}_${targetId}`,
      timing_start_event: 'navigation_start',
      timing_end_event: 'route_hydrated_and_first_interaction_ready',
      cls_ratio: 0.05,
    }, 20))
  }
  if (metricId === 'cold_camera_readiness_p95_milliseconds') return validColdCameraReceipt()
  if (metricId === 'warm_camera_readiness_p95_milliseconds') {
    return receiptFor(metricId, targetId, repeatedObservation({
      metric_id: metricId,
      target_id: targetId,
      measurement_context_id: 'warm_camera_readiness',
      cache_profile: 'warm_cached',
      timing_start_event: 'assessment_capture_route_navigation_start',
      timing_end_event: 'pose_runtime_ready_for_first_inference',
      duration_milliseconds: 3000,
      readiness_outcome: 'success',
    }, 20))
  }
  if (metricId === 'maximum_initial_application_javascript_gzip_bytes') return validJavascriptReceipt(targetId)
  throw new Error(`No matrix receipt fixture for ${metricId}`)
}

function completeReceiptSet() {
  return BUDGET.metric_registry.flatMap((mapping: { metric_id: string, fixture_policy_id: string }) => {
    const policy = BUDGET.fixtures.policies.find((row: { fixture_policy_id: string }) => row.fixture_policy_id === mapping.fixture_policy_id)
    const fixtures = mapping.fixture_policy_id === 'not_applicable'
      ? [{ fixture_id: undefined, fixture_record_count: undefined }]
      : policy.allowed_fixture_ids.map((fixtureId: string) => BUDGET.fixtures.catalog.find((row: { fixture_id: string }) => row.fixture_id === fixtureId))
    return allowedTargetsForMetric(mapping.metric_id).flatMap(targetId => fixtures.map((fixture: { fixture_id?: string, fixture_record_count?: number }) => (
      validReceiptForMatrix(mapping.metric_id, targetId, fixture.fixture_id, fixture.fixture_record_count)
    )))
  })
}

function expectInvalid(mutate: (value: typeof BUDGET) => void, reason: RegExp) {
  const value = clone(BUDGET)
  mutate(value)
  const result = validatePerformanceBudgets(value, SCHEMA)
  expect(result.status).toBe('FAIL')
  expect(result.performance_status).toBe('NOT_MEASURED')
  expect(result.performance_claimed).toBe(false)
  expect(result.errors.join('\n')).toMatch(reason)
}

function expectInvalidWithSchema(
  mutateBudget: (value: typeof BUDGET) => void,
  mutateSchema: (value: typeof SCHEMA) => void,
  reason: RegExp,
) {
  const value = clone(BUDGET)
  const schema = clone(SCHEMA)
  mutateBudget(value)
  mutateSchema(schema)
  const result = validatePerformanceBudgets(value, schema)
  expect(result.status).toBe('FAIL')
  expect(result.performance_status).toBe('NOT_MEASURED')
  expect(result.performance_claimed).toBe(false)
  expect(result.errors.join('\n')).toMatch(reason)
}

describe('performance budget contract', () => {
  it('accepts the frozen pre-baseline contract without claiming performance passed', () => {
    expect(BUDGET.schema_version).toBe(6)
    expect(validatePerformanceBudgets(BUDGET, SCHEMA)).toEqual({
      status: 'PASS',
      contract_id: 'posture-ai-pr09-performance-budgets-2026-07-22-v6',
      phase: 'pre_baseline',
      performance_status: 'NOT_MEASURED',
      performance_claimed: false,
      errors: [],
    })
  })

  it('freezes every numeric floor in unambiguous base units', () => {
    expect(BUDGET.budgets).toEqual({
      maximum_page_records: 50,
      maximum_response_bytes: 524288,
      seeded_api_p95_milliseconds: 750,
      lcp_p95_milliseconds: 2500,
      inp_p95_milliseconds: 200,
      cls_p95_ratio: 0.1,
      maximum_initial_application_javascript_gzip_bytes: 358400,
      cold_camera_readiness_p95_milliseconds: 20000,
      warm_camera_readiness_p95_milliseconds: 5000,
      maximum_cursor_duplicates: 0,
      maximum_cursor_omissions: 0,
    })
  })

  it('maps every budget metric ID exactly once to one observed field and unit', () => {
    expect(BUDGET.metric_registry).toEqual(EXPECTED_METRIC_REGISTRY)
    const budgetMetricIds = Object.keys(BUDGET.budgets).sort()
    const mappedMetricIds = BUDGET.metric_registry.map((mapping: { metric_id: string }) => mapping.metric_id)
    expect([...mappedMetricIds].sort()).toEqual(budgetMetricIds)
    expect(new Set(mappedMetricIds).size).toBe(mappedMetricIds.length)
    for (const mapping of BUDGET.metric_registry) {
      expect(mapping.calculation_fields_contract).toBe(
        mapping.aggregation === 'maximum'
          ? 'maximum_calculation_required_fields'
          : 'nearest_rank_p95_calculation_required_fields',
      )
    }
  })

  it('resolves every target metric ID to exactly one canonical mapping', () => {
    for (const metricId of targetMetricIds(BUDGET)) {
      expect(BUDGET.metric_registry.filter((mapping: { metric_id: string }) => mapping.metric_id === metricId)).toHaveLength(1)
    }
  })

  it('binds every metric to one frozen measurement profile without applying browser throttling to API or bundle metrics', () => {
    expect(BUDGET.measurement_profiles.map((profile: { profile_id: string }) => profile.profile_id)).toEqual([
      'api_local_ci',
      'throttled_browser_camera',
      'deterministic_bundle',
    ])
    const api = BUDGET.measurement_profiles[0].expected_actual_execution_profile
    expect(api).toMatchObject({
      database: 'local_supabase',
      application_mode: 'production_next_start',
      workers: 1,
      measurement_retries: 0,
      network_profile: 'unthrottled_local_loopback',
    })
    expect(api).not.toHaveProperty('download_bits_per_second')
    const browser = BUDGET.measurement_profiles[1].expected_actual_execution_profile
    expect(browser).toMatchObject({
      browser_engine: 'chromium',
      viewport_width_css_pixels: 1280,
      viewport_height_css_pixels: 720,
      device_pixel_ratio: 1,
      download_bits_per_second: 10000000,
      download_bytes_per_second: 1250000,
      cpu_slowdown_factor: 4,
      workers: 1,
      measurement_retries: 0,
      database: 'local_supabase',
      application_mode: 'production_next_start',
    })
    const bundle = BUDGET.measurement_profiles[2].expected_actual_execution_profile
    expect(bundle).toMatchObject({
      accounting_mode: 'deterministic_gzip',
      gzip_level: 9,
      gzip_mtime_seconds: 0,
    })
    expect(bundle).not.toHaveProperty('cpu_slowdown_factor')
  })

  it('catalogs exact seeded fixture identities and freezes one-fixture-per-receipt policies', () => {
    expect(BUDGET.fixtures.catalog).toEqual([
      { fixture_id: 'seeded_records_150', fixture_record_count: 150 },
      { fixture_id: 'seeded_records_300', fixture_record_count: 300 },
      { fixture_id: 'seeded_records_1000', fixture_record_count: 1000 },
    ])
    expect(BUDGET.fixtures.policies).toEqual([
      { fixture_policy_id: 'single_seeded_fixture', allowed_fixture_ids: ['seeded_records_150', 'seeded_records_300', 'seeded_records_1000'], one_fixture_per_receipt: true },
      { fixture_policy_id: 'largest_seeded_api_fixture', allowed_fixture_ids: ['seeded_records_1000'], required_fixture_record_count: 1000, one_fixture_per_receipt: true },
      { fixture_policy_id: 'not_applicable', allowed_fixture_ids: [], required_fixture_record_counts: [] },
    ])
  })

  it('freezes the controlled runner and measurement profiles before baseline', () => {
    expect(BUDGET.runner).toMatchObject({
      provider: 'github_actions',
      image: 'ubuntu-24.04',
      architecture: 'x64',
      node_major: 22,
      database: 'local_supabase',
      application_mode: 'production_next_start',
      workers: 1,
      measurement_retries: 0,
      browser: { engine: 'chromium', viewport_width_css_pixels: 1280, viewport_height_css_pixels: 720, device_pixel_ratio: 1 },
      benchmark_job: {
        future_workflow_path: '.github/workflows/performance.yml',
        runner_label: 'ubuntu-24.04',
        architecture: 'x64',
        node_major: 22,
        general_ci_runner_label: 'ubuntu-latest',
        general_ci_is_benchmark_job: false,
      },
    })
    expect(BUDGET.throttling).toEqual({
      download_bits_per_second: 10000000,
      download_bytes_per_second: 1250000,
      cpu_slowdown_factor: 4,
    })
    expect(BUDGET.measurement_protocols).toEqual({
      percentile_method: 'nearest_rank',
      api: { warmup_observations_per_target: 5, measured_observations_per_target: 40 },
      web_vitals: { warmup_navigations_per_route: 3, measured_navigations_per_route: 20 },
      camera: {
        cold_fresh_context_observations: 20,
        cold_context_policy: 'fresh_browser_context_with_empty_http_cache',
        warm_cached_observations: 20,
        warm_context_policy: 'same_throttling_profile_with_cached_assets',
      },
    })
  })

  it('freezes every pre-audit measurement target instead of allowing selective evidence', () => {
    expect(BUDGET.targets.audited_data_access_paths.map((target: { target_id: string }) => target.target_id)).toEqual([
      'clients_page_list',
      'clients_api_list',
      'assessment_client_picker',
      'client_assessment_history',
    ])
    expect(BUDGET.targets.chart_payloads.map((target: { target_id: string }) => target.target_id)).toEqual([
      'client_progress_chart',
      'client_comparison_payload',
    ])
    expect(BUDGET.targets.web_vitals_journeys.map((target: { target_id: string }) => target.target_id)).toEqual([
      'client_selection_journey',
      'assessment_start_journey',
      'client_history_progress_compare_journey',
      'assessment_results_journey',
    ])
    expect(BUDGET.targets.query_plan_target_ids).toEqual([
      'clients_page_list',
      'clients_api_list',
      'assessment_client_picker',
      'client_assessment_history',
    ])
  })

  it('freezes all eight initial-application-JavaScript routes in order', () => {
    expect(BUDGET.targets.initial_application_javascript_routes).toEqual([
      '/dashboard',
      '/clients',
      '/clients/new',
      '/clients/{client_id}',
      '/clients/{client_id}/edit',
      '/assessments/new',
      '/assessments/{assessment_id}',
      '/settings',
    ])
  })

  it.each([
    ['deletion', (value: typeof BUDGET) => { value.targets.initial_application_javascript_routes.splice(2, 1) }],
    ['reorder', (value: typeof BUDGET) => { value.targets.initial_application_javascript_routes.reverse() }],
    ['mutation', (value: typeof BUDGET) => { value.targets.initial_application_javascript_routes[0] = '/wrong' }],
  ])('rejects initial-JavaScript route %s even if the schema is loosened', (_name, mutate) => {
    expectInvalidWithSchema(
      mutate,
      schema => { schema.properties.targets = {} },
      /initial JavaScript route contract/i,
    )
  })

  it('allows only literal MediaPipe/viewer URL prefixes and never excludes Next application chunks', () => {
    expect(BUDGET.measurement_definitions.initial_application_javascript).toMatchObject({
      allowed_excluded_url_prefixes: ['/mediapipe/', '/muscle-viewer/'],
      never_excluded_url_prefixes: ['/_next/static/'],
      excluded_resource_receipt_rule: 'enumerate every excluded resource URL and its deterministic gzip_bytes',
    })
    expectInvalidWithSchema(
      value => { value.measurement_definitions.initial_application_javascript.allowed_excluded_url_prefixes.push('/_next/static/') },
      schema => { schema.properties.measurement_definitions = {} },
      /initial JavaScript exclusion contract/i,
    )
  })

  it('freezes response, INP, camera, and initial-JavaScript measurement boundaries', () => {
    expect(BUDGET.measurement_definitions.api_response_body).toEqual({
      budget_metric_id: 'maximum_response_bytes',
      observed_value_field: 'decoded_response_body_utf8_bytes',
      unit: 'bytes',
      body_definition: 'UTF-8 byte length of decoded response-body text',
      byte_calculation: "Buffer.byteLength(decoded_response_body_text, 'utf8')",
      response_headers_included: false,
      response_content_encoding_recorded: true,
    })
    for (const journey of BUDGET.targets.web_vitals_journeys) {
      expect(journey.inp_interaction_trace_id).toMatch(/^[a-z0-9_]+$/)
      expect(journey.inp_interaction_steps.length).toBeGreaterThan(0)
    }
    expect(BUDGET.targets.camera_readiness).toMatchObject({
      target_id: 'assessment_camera_readiness',
      timing_start_event: 'assessment_capture_route_navigation_start',
      timing_end_event: 'pose_runtime_ready_for_first_inference',
    })
    expect(BUDGET.measurement_definitions.initial_application_javascript).toMatchObject({
      budget_metric_id: 'maximum_initial_application_javascript_gzip_bytes',
      observed_value_field: 'total_included_gzip_bytes',
      unit: 'gzip_bytes',
      accounting_start_event: 'navigation_start',
      readiness_cutoff_event: 'route_hydrated_and_first_interaction_ready',
    })
  })

  it('requires per-target identity, complete timing/resource fields, and an actual runner fingerprint', () => {
    expect(BUDGET.receipt_contract.required_top_level_fields).toEqual([
      'commit_sha',
      'budget_file_sha256',
      'metric_id',
      'target_id',
      'raw_samples',
      'fixture_record_counts',
      'runner_fingerprint',
      'measurement_profile_id',
      'actual_execution_profile',
    ])
    expect(BUDGET.receipt_contract.required_top_level_fields).not.toEqual(expect.arrayContaining([
      'calculated_maximum',
      'calculated_nearest_rank',
      'calculated_p95',
    ]))
    expect(BUDGET.receipt_contract.maximum_calculation_required_fields).toEqual([
      'aggregation',
      'calculated_maximum',
    ])
    expect(BUDGET.receipt_contract.nearest_rank_p95_calculation_required_fields).toEqual([
      'aggregation',
      'calculated_nearest_rank',
      'calculated_p95',
    ])
    expect(BUDGET.receipt_contract.runner_fingerprint_required_fields).toEqual(expect.arrayContaining([
      'runner_image_version',
      'cpu_model',
      'logical_cpu_cores',
      'memory_bytes',
      'browser_build',
    ]))
    expect(BUDGET.receipt_contract.page_size_observation_required_fields).toEqual([
      'metric_id',
      'target_id',
      'measurement_context_id',
      'fixture_id',
      'fixture_record_count',
      'page_record_count',
    ])
    expect(BUDGET.receipt_contract.api_response_size_observation_required_fields).toEqual(expect.arrayContaining([
      'response_content_encoding',
      'decoded_response_body_utf8_bytes',
      'measurement_context_id',
      'fixture_id',
      'fixture_record_count',
    ]))
    expect(BUDGET.receipt_contract.api_latency_observation_required_fields).toEqual([
      'metric_id',
      'target_id',
      'measurement_context_id',
      'fixture_id',
      'fixture_record_count',
      'duration_milliseconds',
    ])
    expect(BUDGET.receipt_contract.cursor_duplicate_observation_required_fields).toEqual(expect.arrayContaining([
      'measurement_context_id',
      'fixture_id',
      'fixture_record_count',
      'duplicate_record_count',
    ]))
    expect(BUDGET.receipt_contract.cursor_omission_observation_required_fields).toEqual(expect.arrayContaining([
      'measurement_context_id',
      'fixture_id',
      'fixture_record_count',
      'omitted_record_count',
    ]))
    expect(BUDGET.receipt_contract.lcp_observation_required_fields).toEqual(expect.arrayContaining([
      'lcp_milliseconds',
      'timing_start_event',
      'timing_end_event',
    ]))
    expect(BUDGET.receipt_contract.inp_observation_required_fields).toEqual(expect.arrayContaining([
      'interaction_trace_id',
      'interaction_steps',
      'timing_start_event',
      'timing_end_event',
      'inp_milliseconds',
    ]))
    expect(BUDGET.receipt_contract.cls_observation_required_fields).toEqual([
      'metric_id',
      'target_id',
      'measurement_context_id',
      'timing_start_event',
      'timing_end_event',
      'cls_ratio',
    ])
    expect(BUDGET.receipt_contract.cls_observation_required_fields).not.toContain('duration_milliseconds')
    expect(BUDGET.receipt_contract.initial_javascript_route_required_fields).toEqual(expect.arrayContaining([
      'discovery_artifact_sha256',
      'discovery_inventory_sha256',
      'included_resource_inventory',
      'excluded_resource_inventory',
    ]))
    expect(BUDGET.receipt_contract.excluded_javascript_resource_required_fields).toEqual([
      'resource_url',
      'gzip_bytes',
      'matched_allowed_url_prefix',
    ])
    expect(BUDGET.receipt_contract.receipt_set_provenance).toEqual({
      expected_commit_source: 'externally_supplied',
      expected_commit_required: true,
      all_receipts_must_match_expected_commit: true,
      mixed_commits_allowed: false,
    })
    expect(BUDGET.receipt_contract.javascript_discovery_binding).toEqual({
      validation_source: 'externally_supplied_per_route_discovery',
      artifact_hash_algorithm: 'sha256',
      inventory_hash_algorithm: 'sha256',
      inventory_hash_scope: 'canonical_target_id_plus_exact_included_and_excluded_resource_inventories',
      self_attested_hash_sufficient: false,
      minimum_resource_gzip_bytes: 1,
    })
  })

  it('binds receipts to a frozen non-circular canonical budget hash', () => {
    expect(BUDGET.receipt_contract.budget_hash_binding).toEqual({
      receipt_field: 'budget_file_sha256',
      hash_algorithm: 'sha256',
      hash_scope: 'canonical_budget_excluding_expected_receipt_hash',
      canonicalization: 'recursively sorted object keys with preserved array order',
      excluded_json_pointer: '/receipt_contract/budget_hash_binding/expected_sha256',
      expected_sha256: 'fbfa60af7c5f3d3a72e0546de7b751a6b42be07896e0e5f51b4fa1f75059a888',
    })
    expect(receiptBudgetHash()).toBe('fbfa60af7c5f3d3a72e0546de7b751a6b42be07896e0e5f51b4fa1f75059a888')
    const changedExpectedHash = clone(BUDGET)
    changedExpectedHash.receipt_contract.budget_hash_binding.expected_sha256 = 'f'.repeat(64)
    const withoutExpected = clone(changedExpectedHash)
    delete withoutExpected.receipt_contract.budget_hash_binding.expected_sha256
    expect(createHash('sha256').update(stable(withoutExpected)).digest('hex')).toBe(receiptBudgetHash())
  })

  it.each([
    ['renamed', (value: typeof BUDGET) => { value.metric_registry[0].metric_id = 'page_records' }, /metric mapping.*(unmapped|unknown)/i],
    ['unmapped', (value: typeof BUDGET) => { value.metric_registry.pop() }, /metric mapping.*unmapped/i],
    ['duplicate', (value: typeof BUDGET) => { value.metric_registry.push(clone(value.metric_registry[0])) }, /metric mapping.*duplicate/i],
  ])('rejects a %s metric mapping even if its schema branch is loosened', (_name, mutate, reason) => {
    expectInvalidWithSchema(
      mutate,
      schema => { schema.properties.metric_registry = {} },
      reason,
    )
  })

  it('rejects an unmapped target metric even if its schema branch is loosened', () => {
    expectInvalidWithSchema(
      value => { value.targets.web_vitals_journeys[0].metric_ids[0] = 'renamed_lcp' },
      schema => { schema.properties.targets = {} },
      /target metric.*exactly one mapping/i,
    )
  })

  it('rejects measurement definitions that rename canonical budget metrics', () => {
    expectInvalidWithSchema(
      value => { value.measurement_definitions.api_response_body.budget_metric_id = 'decoded_response_body_utf8_bytes' },
      schema => { schema.properties.measurement_definitions = {} },
      /measurement definition mapping/i,
    )
    expectInvalidWithSchema(
      value => { value.measurement_definitions.initial_application_javascript.budget_metric_id = 'initial_application_javascript_gzip_bytes' },
      schema => { schema.properties.measurement_definitions = {} },
      /measurement definition mapping/i,
    )
  })

  it('rejects a CLS receipt that records a duration instead of a unitless ratio', () => {
    expectInvalidWithSchema(
      value => {
        value.receipt_contract.cls_observation_required_fields = [
          'metric_id',
          'target_id',
          'timing_start_event',
          'timing_end_event',
          'duration_milliseconds',
        ]
      },
      schema => { schema.properties.receipt_contract = {} },
      /CLS observation contract/i,
    )
  })

  it('rejects aggregation and calculation-contract mismatches', () => {
    expectInvalidWithSchema(
      value => { value.metric_registry[0].calculation_fields_contract = 'nearest_rank_p95_calculation_required_fields' },
      schema => { schema.properties.metric_registry = {} },
      /metric calculation contract.*mismatch/i,
    )
  })

  it.each([
    ['missing', (value: typeof BUDGET) => { delete value.metric_registry[0].calculation_fields_contract }],
    ['unmapped', (value: typeof BUDGET) => { value.metric_registry[0].calculation_fields_contract = 'unknown_calculation_required_fields' }],
  ])('rejects a %s metric calculation contract binding', (_name, mutate) => {
    expectInvalidWithSchema(
      mutate,
      schema => { schema.properties.metric_registry = {} },
      /metric calculation contract.*unmapped/i,
    )
  })

  it.each([
    ['missing', (value: typeof BUDGET) => { value.receipt_contract.maximum_calculation_required_fields.splice(1, 1) }, /calculation result.*missing/i],
    ['duplicate', (value: typeof BUDGET) => { value.receipt_contract.nearest_rank_p95_calculation_required_fields.push('calculated_maximum') }, /calculation result.*duplicate/i],
    ['unmapped', (value: typeof BUDGET) => { value.receipt_contract.maximum_calculation_required_fields.push('calculated_median') }, /calculation result.*unmapped/i],
  ])('rejects a %s aggregation result field', (_name, mutate, reason) => {
    expectInvalidWithSchema(
      mutate,
      schema => { schema.properties.receipt_contract = {} },
      reason,
    )
  })

  it('rejects the old shared p95-only top-level calculation shape', () => {
    expectInvalidWithSchema(
      value => {
        value.receipt_contract.required_top_level_fields.push('calculated_nearest_rank', 'calculated_p95')
        delete value.receipt_contract.maximum_calculation_required_fields
        delete value.receipt_contract.nearest_rank_p95_calculation_required_fields
      },
      schema => { schema.properties.receipt_contract = {} },
      /top-level calculation result/i,
    )
  })

  it('accepts receipts bound to the exact fixture and applied measurement profile', () => {
    expect(validatePerformanceReceipt(validApiLatencyReceipt(), BUDGET, receiptValidationContext())).toEqual({ status: 'PASS', errors: [] })
    expect(validatePerformanceReceipt(validLcpReceipt(), BUDGET, receiptValidationContext())).toEqual({ status: 'PASS', errors: [] })
  })

  it('rejects API p95 evidence borrowed from the smaller fixture', () => {
    const receipt = validApiLatencyReceipt()
    receipt.raw_samples[0].fixture_id = 'seeded_records_150'
    receipt.raw_samples[0].fixture_record_count = 150
    receipt.fixture_record_counts = [150]
    expect(validatePerformanceReceipt(receipt, BUDGET).errors.join('\n')).toMatch(/required fixture.*1000/i)
  })

  it('rejects mislabeled and mixed 150/1000 fixture observations', () => {
    const mislabeled = validApiLatencyReceipt()
    mislabeled.raw_samples[0].fixture_id = 'seeded_records_150'
    expect(validatePerformanceReceipt(mislabeled, BUDGET).errors.join('\n')).toMatch(/fixture label mismatch/i)

    const mixed = validApiLatencyReceipt()
    const smaller = clone(mixed.raw_samples[0])
    smaller.fixture_id = 'seeded_records_150'
    smaller.fixture_record_count = 150
    smaller.measurement_context_id = 'clients_api_list_seeded_records_150'
    mixed.raw_samples.push(smaller)
    mixed.fixture_record_counts = [150, 1000]
    expect(validatePerformanceReceipt(mixed, BUDGET).errors.join('\n')).toMatch(/mixed fixture group/i)
  })

  it('rejects an API receipt that borrows another profile or changes local-CI execution', () => {
    const borrowed = validApiLatencyReceipt()
    borrowed.measurement_profile_id = 'throttled_browser_camera'
    borrowed.actual_execution_profile = clone(BUDGET.measurement_profiles[1].expected_actual_execution_profile)
    expect(validatePerformanceReceipt(borrowed, BUDGET).errors.join('\n')).toMatch(/measurement profile ID mismatch/i)

    const development = validApiLatencyReceipt()
    development.actual_execution_profile.application_mode = 'next_dev'
    expect(validatePerformanceReceipt(development, BUDGET).errors.join('\n')).toMatch(/actual profile mismatch.*application_mode/i)
  })

  it('rejects a browser receipt that omits the actual throttle', () => {
    const receipt = validLcpReceipt()
    delete receipt.actual_execution_profile.download_bits_per_second
    expect(validatePerformanceReceipt(receipt, BUDGET).errors.join('\n')).toMatch(/actual profile missing.*download_bits_per_second/i)
  })

  it('rejects invented targets, malformed provenance, and contradictory actual-profile extras', () => {
    const inventedTarget = validApiLatencyReceipt()
    inventedTarget.target_id = 'invented_target'
    inventedTarget.raw_samples.forEach((sample: Record<string, unknown>) => { sample.target_id = 'invented_target' })
    expect(validatePerformanceReceipt(inventedTarget, BUDGET).errors.join('\n')).toMatch(/target.*not authorized/i)

    const malformedCommit = validApiLatencyReceipt()
    malformedCommit.commit_sha = 'not-a-commit'
    expect(validatePerformanceReceipt(malformedCommit, BUDGET).errors.join('\n')).toMatch(/commit.*sha/i)

    const wrongBudget = validApiLatencyReceipt()
    wrongBudget.budget_file_sha256 = 'b'.repeat(64)
    expect(validatePerformanceReceipt(wrongBudget, BUDGET).errors.join('\n')).toMatch(/budget.*hash/i)

    const missingFingerprint = validApiLatencyReceipt()
    delete missingFingerprint.runner_fingerprint.cpu_model
    expect(validatePerformanceReceipt(missingFingerprint, BUDGET).errors.join('\n')).toMatch(/runner fingerprint.*cpu_model/i)

    const contradictoryApiProfile = validApiLatencyReceipt()
    contradictoryApiProfile.actual_execution_profile.download_bits_per_second = 10000000
    expect(validatePerformanceReceipt(contradictoryApiProfile, BUDGET).errors.join('\n')).toMatch(/actual profile.*key/i)
  })

  it('rejects nonnumeric samples, insufficient observations, wrong calculations, and threshold failures', () => {
    const nonnumeric = validApiLatencyReceipt()
    nonnumeric.raw_samples[0].duration_milliseconds = 'fast'
    expect(validatePerformanceReceipt(nonnumeric, BUDGET).errors.join('\n')).toMatch(/finite nonnegative/i)

    const tooFew = validApiLatencyReceipt()
    tooFew.raw_samples.pop()
    expect(validatePerformanceReceipt(tooFew, BUDGET).errors.join('\n')).toMatch(/sample.*40/i)

    const wrongP95 = validApiLatencyReceipt()
    wrongP95.calculated_nearest_rank = 1
    wrongP95.calculated_p95 = 1
    expect(validatePerformanceReceipt(wrongP95, BUDGET).errors.join('\n')).toMatch(/calculated.*mismatch/i)

    const thresholdFailure = validApiLatencyReceipt()
    thresholdFailure.raw_samples.forEach((sample: Record<string, unknown>) => { sample.duration_milliseconds = 751 })
    thresholdFailure.calculated_p95 = 751
    expect(validatePerformanceReceipt(thresholdFailure, BUDGET).errors.join('\n')).toMatch(/threshold.*750/i)

    const wrongMaximum = validMaximumPageReceipt()
    wrongMaximum.calculated_maximum = 1
    expect(validatePerformanceReceipt(wrongMaximum, BUDGET).errors.join('\n')).toMatch(/calculated.*mismatch/i)
  })

  it('rejects forged web-vitals timing and incomplete or reordered INP traces', () => {
    const wrongLcpTiming = validLcpReceipt()
    wrongLcpTiming.raw_samples[0].timing_end_event = 'route_hydrated'
    expect(validatePerformanceReceipt(wrongLcpTiming, BUDGET).errors.join('\n')).toMatch(/timing.*mismatch/i)

    const wrongTrace = validInpReceipt()
    wrongTrace.raw_samples[0].interaction_trace_id = 'invented_trace'
    expect(validatePerformanceReceipt(wrongTrace, BUDGET).errors.join('\n')).toMatch(/interaction trace.*mismatch/i)

    const incompleteTrace = validInpReceipt()
    ;(incompleteTrace.raw_samples[0].interaction_steps as Array<Record<string, unknown>>).pop()
    expect(validatePerformanceReceipt(incompleteTrace, BUDGET).errors.join('\n')).toMatch(/interaction steps.*mismatch/i)

    const reorderedTrace = validInpReceipt()
    ;(reorderedTrace.raw_samples[0].interaction_steps as Array<Record<string, unknown>>).reverse()
    expect(validatePerformanceReceipt(reorderedTrace, BUDGET).errors.join('\n')).toMatch(/interaction steps.*mismatch/i)
  })

  it('rejects camera cache/timing/readiness drift and malformed JavaScript accounting', () => {
    const wrongCamera = validColdCameraReceipt()
    wrongCamera.raw_samples[0].cache_profile = 'warm_cached'
    wrongCamera.raw_samples[0].timing_start_event = 'wrong'
    wrongCamera.raw_samples[0].readiness_outcome = 'failed'
    expect(validatePerformanceReceipt(wrongCamera, BUDGET).errors.join('\n')).toMatch(/camera.*(cache|timing|readiness)/i)

    const inventedRoute = validJavascriptReceipt('/invented')
    expect(validatePerformanceReceipt(inventedRoute, BUDGET).errors.join('\n')).toMatch(/target.*not authorized/i)

    const excludedApplicationChunk = validJavascriptReceipt()
    ;(excludedApplicationChunk.raw_samples[0].excluded_resource_inventory as Array<Record<string, unknown>>).push({
      resource_url: '/_next/static/chunks/hidden.js',
      gzip_bytes: 1,
      matched_allowed_url_prefix: '/mediapipe/',
    })
    expect(validatePerformanceReceipt(excludedApplicationChunk, BUDGET).errors.join('\n')).toMatch(/never.*excluded|exclusion prefix/i)

    const wrongTotal = validJavascriptReceipt()
    wrongTotal.raw_samples[0].total_included_gzip_bytes = 1
    wrongTotal.calculated_maximum = 1
    expect(validatePerformanceReceipt(wrongTotal, BUDGET).errors.join('\n')).toMatch(/javascript.*total/i)
  })

  it('accepts only the complete frozen metric-target-fixture receipt matrix', () => {
    const receipts = completeReceiptSet()
    expect(validatePerformanceReceiptSet(receipts, BUDGET, receiptValidationContext())).toEqual({ status: 'PASS', errors: [] })

    const missing = receipts.slice(1)
    expect(validatePerformanceReceiptSet(missing, BUDGET, receiptValidationContext()).errors.join('\n')).toMatch(/matrix.*missing/i)

    const duplicate = [...receipts, clone(receipts[0])]
    expect(validatePerformanceReceiptSet(duplicate, BUDGET, receiptValidationContext()).errors.join('\n')).toMatch(/matrix.*duplicate/i)
  })

  it.each(['garbage', null, {}, 0])('rejects malformed non-fixture fixture_record_counts value %j', (malformed) => {
    const receipt = validLcpReceipt()
    receipt.fixture_record_counts = malformed as unknown as number[]
    expect(validatePerformanceReceipt(receipt, BUDGET, receiptValidationContext()).errors.join('\n')).toMatch(/fixture_record_counts must be an array/i)

    const receipts = completeReceiptSet()
    const nonFixture = receipts.find((row: { metric_id: string }) => row.metric_id === 'lcp_p95_milliseconds')
    expect(nonFixture).toBeDefined()
    if (!nonFixture) throw new Error('complete receipt set is missing the LCP fixture')
    nonFixture.fixture_record_counts = malformed as unknown as number[]
    const errors = validatePerformanceReceiptSet(receipts, BUDGET, receiptValidationContext()).errors.join('\n')
    expect(errors).toMatch(/fixture_record_counts must be an array/i)
    expect(errors).toMatch(/matrix.*missing/i)
  })

  it('rejects missing, wrong, and mixed externally expected commit provenance', () => {
    const receipts = completeReceiptSet()
    expect(validatePerformanceReceiptSet(receipts, BUDGET).errors.join('\n')).toMatch(/expected commit.*required/i)

    const wrongCommonCommit = clone(receipts)
    wrongCommonCommit.forEach((receipt: { commit_sha: string }) => { receipt.commit_sha = 'b'.repeat(40) })
    expect(validatePerformanceReceiptSet(wrongCommonCommit, BUDGET, receiptValidationContext()).errors.join('\n')).toMatch(/commit.*expected/i)

    const mixedCommits = clone(receipts)
    mixedCommits[0].commit_sha = 'b'.repeat(40)
    expect(validatePerformanceReceiptSet(mixedCommits, BUDGET, receiptValidationContext()).errors.join('\n')).toMatch(/commit.*expected|mixed commit/i)
  })

  it('rejects fabricated, omitted, resized, and wrong-artifact JavaScript discovery evidence', () => {
    const context = receiptValidationContext()

    const fabricated = validJavascriptReceipt()
    fabricated.raw_samples[0].included_resource_inventory = [{ resource_url: '/_next/static/chunks/fake.js', gzip_bytes: 0 }]
    fabricated.raw_samples[0].total_included_gzip_bytes = 0
    fabricated.calculated_maximum = 0
    expect(validatePerformanceReceipt(fabricated, BUDGET, context).errors.join('\n')).toMatch(/discovery|resource.*positive/i)

    const omitted = validJavascriptReceipt()
    ;(omitted.raw_samples[0].included_resource_inventory as Array<Record<string, unknown>>).pop()
    omitted.raw_samples[0].total_included_gzip_bytes = 100000
    omitted.calculated_maximum = 100000
    expect(validatePerformanceReceipt(omitted, BUDGET, context).errors.join('\n')).toMatch(/discovery.*inventory/i)

    const resized = validJavascriptReceipt()
    ;(resized.raw_samples[0].included_resource_inventory as Array<Record<string, unknown>>)[0].gzip_bytes = 99999
    resized.raw_samples[0].total_included_gzip_bytes = 149999
    resized.calculated_maximum = 149999
    expect(validatePerformanceReceipt(resized, BUDGET, context).errors.join('\n')).toMatch(/discovery.*inventory/i)

    const wrongArtifact = validJavascriptReceipt()
    wrongArtifact.raw_samples[0].discovery_artifact_sha256 = 'e'.repeat(64)
    expect(validatePerformanceReceipt(wrongArtifact, BUDGET, context).errors.join('\n')).toMatch(/discovery.*artifact.*hash/i)
  })

  it.each([
    ['faster network', 'download_bits_per_second', 20000000],
    ['wrong byte rate', 'download_bytes_per_second', 2500000],
    ['faster CPU', 'cpu_slowdown_factor', 1],
    ['viewport width', 'viewport_width_css_pixels', 1440],
    ['viewport height', 'viewport_height_css_pixels', 900],
    ['device pixel ratio', 'device_pixel_ratio', 2],
    ['workers', 'workers', 2],
    ['retries', 'measurement_retries', 1],
    ['database', 'database', 'remote_supabase'],
    ['application mode', 'application_mode', 'next_dev'],
  ])('rejects browser profile drift in %s', (_name, field, value) => {
    const receipt = validLcpReceipt()
    receipt.actual_execution_profile[field] = value
    expect(validatePerformanceReceipt(receipt, BUDGET).errors.join('\n')).toMatch(new RegExp(`actual profile mismatch.*${field}`, 'i'))
  })

  it('rejects registry profile rebinding and a loosened frozen browser profile', () => {
    expectInvalidWithSchema(
      value => { value.metric_registry[0].measurement_profile_id = 'throttled_browser_camera' },
      schema => { schema.properties.metric_registry = {} },
      /metric measurement profile.*mismatch/i,
    )
    expectInvalidWithSchema(
      value => { value.measurement_profiles[1].expected_actual_execution_profile.cpu_slowdown_factor = 1 },
      schema => { schema.properties.measurement_profiles = {} },
      /measurement profile.*drift/i,
    )
  })

  it.each([
    ['page size', (value: typeof BUDGET) => { value.budgets.maximum_page_records = 51 }],
    ['response bytes', (value: typeof BUDGET) => { value.budgets.maximum_response_bytes = 524289 }],
    ['API p95', (value: typeof BUDGET) => { value.budgets.seeded_api_p95_milliseconds = 751 }],
    ['LCP', (value: typeof BUDGET) => { value.budgets.lcp_p95_milliseconds = 2501 }],
    ['INP', (value: typeof BUDGET) => { value.budgets.inp_p95_milliseconds = 201 }],
    ['CLS', (value: typeof BUDGET) => { value.budgets.cls_p95_ratio = 0.1001 }],
    ['initial JS', (value: typeof BUDGET) => { value.budgets.maximum_initial_application_javascript_gzip_bytes = 358401 }],
    ['cold camera', (value: typeof BUDGET) => { value.budgets.cold_camera_readiness_p95_milliseconds = 20001 }],
    ['warm camera', (value: typeof BUDGET) => { value.budgets.warm_camera_readiness_p95_milliseconds = 5001 }],
    ['cursor duplicates', (value: typeof BUDGET) => { value.budgets.maximum_cursor_duplicates = 1 }],
    ['cursor omissions', (value: typeof BUDGET) => { value.budgets.maximum_cursor_omissions = 1 }],
  ])('rejects a loosened %s budget', (_name, mutate) => {
    expectInvalid(mutate, /schema const/i)
  })

  it.each([
    ['runner image', (value: typeof BUDGET) => { value.runner.image = 'ubuntu-latest' }],
    ['worker count', (value: typeof BUDGET) => { value.runner.workers = 2 }],
    ['measurement retries', (value: typeof BUDGET) => { value.runner.measurement_retries = 1 }],
    ['network bits', (value: typeof BUDGET) => { value.throttling.download_bits_per_second = 9000000 }],
    ['network bytes', (value: typeof BUDGET) => { value.throttling.download_bytes_per_second = 10000000 }],
    ['CPU profile', (value: typeof BUDGET) => { value.throttling.cpu_slowdown_factor = 3 }],
    ['percentile method', (value: typeof BUDGET) => { value.measurement_protocols.percentile_method = 'linear_interpolation' }],
    ['API sample count', (value: typeof BUDGET) => { value.measurement_protocols.api.measured_observations_per_target = 10 }],
    ['web-vitals sample count', (value: typeof BUDGET) => { value.measurement_protocols.web_vitals.measured_navigations_per_route = 10 }],
    ['camera sample count', (value: typeof BUDGET) => { value.measurement_protocols.camera.cold_fresh_context_observations = 10 }],
  ])('rejects drift in the frozen %s', (_name, mutate) => {
    expectInvalid(mutate, /schema const/i)
  })

  it('rejects unknown fields, missing targets, duplicate target IDs, and performance claims', () => {
    expectInvalid(value => { value.surprise = true }, /additionalProperties/i)
    expectInvalid(value => { delete value.targets.audited_data_access_paths }, /schema (required|const)/i)
    expectInvalid(value => { value.targets.web_vitals_journeys.push(value.targets.web_vitals_journeys[0]) }, /duplicate target/i)
    expectInvalid(value => { value.change_control.performance_claimed = true }, /schema const/i)
  })

  it('rejects dangling query-plan references', () => {
    expectInvalid(value => { value.targets.query_plan_target_ids[0] = 'not_a_target' }, /unknown target reference/i)
  })

  it('fails closed when the checked-in schema uses unsupported validation keywords', () => {
    const schema = clone(SCHEMA)
    schema.anyOf = []
    const result = validatePerformanceBudgets(BUDGET, schema)
    expect(result.status).toBe('FAIL')
    expect(result.errors.join('\n')).toMatch(/unsupported schema keyword anyOf/i)
  })

  it('rejects illegal supported-keyword forms instead of treating them as truthy', () => {
    const value = clone(BUDGET)
    value.surprise = true
    const schema = clone(SCHEMA)
    schema.additionalProperties = 'false'
    const result = validatePerformanceBudgets(value, schema)
    expect(result.status).toBe('FAIL')
    expect(result.errors.join('\n')).toMatch(/additionalProperties must be a boolean/i)
  })

  it.each([
    ['metadata', (schema: typeof SCHEMA) => { schema.title = 42 }, /title must be a string/i],
    ['type', (schema: typeof SCHEMA) => { schema.type = ['object', 'object'] }, /type has an illegal form/i],
    ['required', (schema: typeof SCHEMA) => { schema.required.push(schema.required[0]) }, /required must contain unique strings/i],
    ['enum', (schema: typeof SCHEMA) => { schema.enum = [] }, /enum must be a non-empty unique array/i],
    ['pattern', (schema: typeof SCHEMA) => { schema.pattern = '[' }, /pattern is invalid/i],
    ['array bound', (schema: typeof SCHEMA) => { schema.minItems = -1 }, /minItems must be a non-negative integer/i],
    ['numeric bound', (schema: typeof SCHEMA) => { schema.minimum = '0' }, /minimum must be a finite number/i],
    ['uniqueItems', (schema: typeof SCHEMA) => { schema.uniqueItems = 'true' }, /uniqueItems must be a boolean/i],
    ['properties', (schema: typeof SCHEMA) => { schema.properties = [] }, /properties must be an object/i],
    ['$defs', (schema: typeof SCHEMA) => { schema.$defs = [] }, /\$defs must be an object/i],
    ['items', (schema: typeof SCHEMA) => { schema.items = true }, /items must be an object schema/i],
    ['$ref', (schema: typeof SCHEMA) => { schema.$ref = '#/$defs/missing' }, /unresolved local \$ref/i],
  ])('rejects an illegal %s schema keyword value', (_name, mutate, reason) => {
    const schema = clone(SCHEMA)
    mutate(schema)
    const result = validatePerformanceBudgets(BUDGET, schema)
    expect(result.status).toBe('FAIL')
    expect(result.errors.join('\n')).toMatch(reason)
  })

  it('rejects a coupled budget and schema loosening through the independent frozen-contract invariant', () => {
    expectInvalidWithSchema(
      value => { value.budgets.maximum_page_records = 500 },
      schema => { schema.properties.budgets.properties.maximum_page_records.const = 500 },
      /frozen contract drift/i,
    )
  })

  it('binds machine-readable output to the exact budget, schema, and checker bytes', () => {
    expect(checkPerformanceBudgetFiles()).toMatchObject({
      status: 'PASS',
      contract_id: BUDGET.contract_id,
      phase: 'pre_baseline',
      performance_status: 'NOT_MEASURED',
      performance_claimed: false,
      budget_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      schema_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      checker_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })

  it('CLI passes the canonical contract and fails an altered copy without writing reports', () => {
    const stdout = execFileSync(process.execPath, [CHECKER_PATH], { cwd: ROOT, encoding: 'utf8' })
    expect(JSON.parse(stdout)).toMatchObject({
      status: 'PASS',
      phase: 'pre_baseline',
      performance_status: 'NOT_MEASURED',
      performance_claimed: false,
    })

    const directory = mkdtempSync(join(tmpdir(), 'posture-performance-budgets-'))
    TEMPORARY_DIRECTORIES.push(directory)
    const invalidPath = join(directory, 'invalid.json')
    const invalid = clone(BUDGET)
    invalid.budgets.maximum_page_records = 500
    writeFileSync(invalidPath, `${JSON.stringify(invalid)}\n`)
    const failed = spawnSync(process.execPath, [CHECKER_PATH, '--budget', invalidPath], { cwd: ROOT, encoding: 'utf8' })
    expect(failed.status).toBe(1)
    expect(JSON.parse(failed.stdout)).toMatchObject({ status: 'FAIL', performance_claimed: false })
  })

  it('keeps the contract-only command distinct from measured-receipt commands', () => {
    expect(PACKAGE.scripts['performance:budgets:check']).toBe('node scripts/check-performance-budgets.mjs')
    expect(PACKAGE.scripts['performance:check']).toBe('node scripts/performance/check-receipts.mjs')
    expect(PACKAGE.scripts['performance:official']).toBe('node scripts/performance/run-official.mjs')
    expect(PACKAGE.scripts['performance:local']).toBe('node scripts/performance/run-official.mjs --local')
  })
})

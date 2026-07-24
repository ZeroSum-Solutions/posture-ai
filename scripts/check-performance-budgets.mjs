#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHECKER_PATH = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(CHECKER_PATH), '..')
const DEFAULT_BUDGET_PATH = resolve(ROOT, 'docs/qa/performance-budgets.json')
const DEFAULT_SCHEMA_PATH = resolve(ROOT, 'docs/qa/performance-budgets.schema.json')
const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  '$schema', '$id', 'title', 'description', '$defs', '$ref', 'type', 'additionalProperties',
  'required', 'properties', 'const', 'enum', 'items', 'pattern', 'minItems', 'maxItems',
  'minimum', 'maximum', 'uniqueItems',
])
const SUPPORTED_SCHEMA_TYPES = new Set(['object', 'array', 'integer', 'number', 'string', 'boolean', 'null'])
const FROZEN_BUDGET_CANONICAL_SHA256 = 'd021a1058b9fc18d0380f5a72f87a96a94baa69855a2a577e533e2990477ceb2'
const FROZEN_INITIAL_JAVASCRIPT_ROUTES = [
  '/dashboard',
  '/clients',
  '/clients/new',
  '/clients/{client_id}',
  '/clients/{client_id}/edit',
  '/assessments/new',
  '/assessments/{assessment_id}',
  '/settings',
]
const FROZEN_ALLOWED_JAVASCRIPT_EXCLUSION_PREFIXES = ['/mediapipe/', '/muscle-viewer/']
const FROZEN_NEVER_EXCLUDED_JAVASCRIPT_PREFIXES = ['/_next/static/']
const FROZEN_METRIC_MAPPINGS = {
  maximum_page_records: ['page_record_count', 'count', 'maximum', 'page_size_observation_required_fields', 'maximum_calculation_required_fields', 'api_local_ci', 'single_seeded_fixture'],
  maximum_response_bytes: ['decoded_response_body_utf8_bytes', 'bytes', 'maximum', 'api_response_size_observation_required_fields', 'maximum_calculation_required_fields', 'api_local_ci', 'single_seeded_fixture'],
  seeded_api_p95_milliseconds: ['duration_milliseconds', 'milliseconds', 'nearest_rank_p95', 'api_latency_observation_required_fields', 'nearest_rank_p95_calculation_required_fields', 'api_local_ci', 'largest_seeded_api_fixture'],
  lcp_p95_milliseconds: ['lcp_milliseconds', 'milliseconds', 'nearest_rank_p95', 'lcp_observation_required_fields', 'nearest_rank_p95_calculation_required_fields', 'throttled_browser_camera', 'not_applicable'],
  inp_p95_milliseconds: ['inp_milliseconds', 'milliseconds', 'nearest_rank_p95', 'inp_observation_required_fields', 'nearest_rank_p95_calculation_required_fields', 'throttled_browser_camera', 'not_applicable'],
  cls_p95_ratio: ['cls_ratio', 'unitless_ratio', 'nearest_rank_p95', 'cls_observation_required_fields', 'nearest_rank_p95_calculation_required_fields', 'throttled_browser_camera', 'not_applicable'],
  maximum_initial_application_javascript_gzip_bytes: ['total_included_gzip_bytes', 'gzip_bytes', 'maximum', 'initial_javascript_route_required_fields', 'maximum_calculation_required_fields', 'deterministic_bundle', 'not_applicable'],
  cold_camera_readiness_p95_milliseconds: ['duration_milliseconds', 'milliseconds', 'nearest_rank_p95', 'camera_observation_required_fields', 'nearest_rank_p95_calculation_required_fields', 'throttled_browser_camera', 'not_applicable'],
  warm_camera_readiness_p95_milliseconds: ['duration_milliseconds', 'milliseconds', 'nearest_rank_p95', 'camera_observation_required_fields', 'nearest_rank_p95_calculation_required_fields', 'throttled_browser_camera', 'not_applicable'],
  maximum_cursor_duplicates: ['duplicate_record_count', 'count', 'maximum', 'cursor_duplicate_observation_required_fields', 'maximum_calculation_required_fields', 'api_local_ci', 'single_seeded_fixture'],
  maximum_cursor_omissions: ['omitted_record_count', 'count', 'maximum', 'cursor_omission_observation_required_fields', 'maximum_calculation_required_fields', 'api_local_ci', 'single_seeded_fixture'],
}
const CALCULATION_CONTRACTS = {
  maximum_calculation_required_fields: {
    aggregation: 'maximum',
    resultFields: ['calculated_maximum'],
  },
  nearest_rank_p95_calculation_required_fields: {
    aggregation: 'nearest_rank_p95',
    resultFields: ['calculated_nearest_rank', 'calculated_p95'],
  },
}

export function validatePerformanceBudgets(budget, schema) {
  const errors = validateJsonWithSchema(budget, schema)
  validateSemanticInvariants(budget, errors)
  return {
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    contract_id: typeof budget?.contract_id === 'string' ? budget.contract_id : null,
    phase: budget?.phase ?? null,
    performance_status: 'NOT_MEASURED',
    performance_claimed: false,
    errors: [...new Set(errors)],
  }
}

export function validatePerformanceReceipt(receipt, budget, validationContext = {}) {
  const errors = []
  if (!isObject(receipt)) return { status: 'FAIL', errors: ['RECEIPT_INVALID: receipt must be an object'] }
  for (const field of array(budget.receipt_contract?.required_top_level_fields)) {
    if (!Object.hasOwn(receipt, field)) errors.push(`RECEIPT_FIELD_MISSING: receipt missing required field ${field}`)
  }
  const mappings = array(budget.metric_registry).filter(mapping => mapping?.metric_id === receipt.metric_id)
  if (mappings.length !== 1) {
    errors.push(`RECEIPT_METRIC_UNMAPPED: receipt metric ${receipt.metric_id} must resolve exactly once`)
    return { status: 'FAIL', errors }
  }
  const mapping = mappings[0]
  validateReceiptProvenance(receipt, budget, validationContext, errors)
  validateReceiptTarget(receipt, mapping, budget, errors)
  validateReceiptObservations(receipt, mapping, budget, validationContext, errors)
  validateReceiptProfile(receipt, mapping, budget, errors)
  validateReceiptFixtures(receipt, mapping, budget, errors)
  validateReceiptCalculation(receipt, mapping, budget, errors)
  return { status: errors.length === 0 ? 'PASS' : 'FAIL', errors: [...new Set(errors)] }
}

export function validatePerformanceReceiptSet(receipts, budget, validationContext = {}) {
  const errors = []
  if (!Array.isArray(receipts)) return { status: 'FAIL', errors: ['RECEIPT_SET_INVALID: receipts must be an array'] }
  const expectedCommitSha = validationContext?.expectedCommitSha
  if (!validCommitSha(expectedCommitSha)) {
    errors.push('RECEIPT_SET_EXPECTED_COMMIT_REQUIRED: externally expected commit SHA is required and must be lowercase 40-character hex')
  }
  receipts.forEach((receipt, index) => {
    const result = validatePerformanceReceipt(receipt, budget, validationContext)
    for (const error of result.errors) errors.push(`RECEIPT_SET_MEMBER_INVALID: receipt ${index}: ${error}`)
  })
  const observedCommits = new Set(receipts.filter(isObject).map(receipt => receipt.commit_sha))
  if (observedCommits.size > 1) errors.push('RECEIPT_SET_MIXED_COMMITS: every receipt must use the same externally expected commit SHA')
  const expectedKeys = requiredReceiptMatrixKeys(budget)
  const actualCounts = new Map()
  receipts.forEach(receipt => {
    if (!isObject(receipt)) return
    if (!Array.isArray(receipt.fixture_record_counts)) return
    const key = receiptMatrixKey(receipt.metric_id, receipt.target_id, receipt.fixture_record_counts)
    actualCounts.set(key, (actualCounts.get(key) ?? 0) + 1)
  })
  for (const key of expectedKeys) {
    const count = actualCounts.get(key) ?? 0
    if (count === 0) errors.push(`RECEIPT_MATRIX_MISSING: missing required metric-target-fixture receipt ${key}`)
    else if (count > 1) errors.push(`RECEIPT_MATRIX_DUPLICATE: duplicate metric-target-fixture receipt ${key}`)
  }
  for (const key of actualCounts.keys()) {
    if (!expectedKeys.has(key)) errors.push(`RECEIPT_MATRIX_UNEXPECTED: unexpected metric-target-fixture receipt ${key}`)
  }
  return { status: errors.length === 0 ? 'PASS' : 'FAIL', errors: [...new Set(errors)] }
}

function requiredReceiptMatrixKeys(budget) {
  const keys = new Set()
  for (const mapping of array(budget.metric_registry)) {
    if (!isObject(mapping) || !nonEmptyString(mapping.metric_id)) continue
    const policy = array(budget.fixtures?.policies).find(row => row?.fixture_policy_id === mapping.fixture_policy_id)
    const fixtureCounts = mapping.fixture_policy_id === 'not_applicable'
      ? [[]]
      : array(policy?.allowed_fixture_ids).map(fixtureId => {
          const fixture = array(budget.fixtures?.catalog).find(row => row?.fixture_id === fixtureId)
          return [fixture?.fixture_record_count]
        })
    for (const targetId of allowedTargetIds(mapping.metric_id, budget)) {
      for (const counts of fixtureCounts) keys.add(receiptMatrixKey(mapping.metric_id, targetId, counts))
    }
  }
  return keys
}

function receiptMatrixKey(metricId, targetId, fixtureRecordCounts) {
  return stable([metricId, targetId, [...array(fixtureRecordCounts)].sort((left, right) => left - right)])
}

function validateReceiptCalculation(receipt, mapping, budget, errors) {
  for (const field of array(budget.receipt_contract?.[mapping.calculation_fields_contract])) {
    if (!Object.hasOwn(receipt, field)) errors.push(`RECEIPT_CALCULATION_MISSING: receipt missing calculation field ${field}`)
  }
  if (receipt.aggregation !== mapping.aggregation) {
    errors.push(`RECEIPT_AGGREGATION_MISMATCH: receipt aggregation does not match ${mapping.aggregation}`)
  }
  const samples = array(receipt.raw_samples).filter(isObject)
  const values = samples.map(sample => sample[mapping.observed_value_field])
  if (values.length === 0 || values.some(value => !finiteNonnegative(value))) return
  let calculatedResult
  if (mapping.aggregation === 'maximum') {
    calculatedResult = Math.max(...values)
    if (receipt.calculated_maximum !== calculatedResult) {
      errors.push(`RECEIPT_CALCULATED_RESULT_MISMATCH: calculated maximum mismatch for ${mapping.metric_id}`)
    }
  } else if (mapping.aggregation === 'nearest_rank_p95') {
    const rank = Math.ceil(0.95 * values.length)
    const sorted = [...values].sort((left, right) => left - right)
    calculatedResult = sorted[rank - 1]
    if (receipt.calculated_nearest_rank !== rank || receipt.calculated_p95 !== calculatedResult) {
      errors.push(`RECEIPT_CALCULATED_RESULT_MISMATCH: calculated nearest-rank p95 mismatch for ${mapping.metric_id}`)
    }
  }
  const threshold = budget.budgets?.[mapping.metric_id]
  if (!finiteNonnegative(threshold) || !finiteNonnegative(calculatedResult)) {
    errors.push(`RECEIPT_THRESHOLD_INVALID: threshold is invalid for ${mapping.metric_id}`)
  } else if (calculatedResult > threshold) {
    errors.push(`RECEIPT_THRESHOLD_EXCEEDED: ${mapping.metric_id} result ${calculatedResult} exceeds frozen threshold ${threshold}`)
  }
}

function validateReceiptObservations(receipt, mapping, budget, validationContext, errors) {
  if (!Array.isArray(receipt.raw_samples) || receipt.raw_samples.length === 0) {
    errors.push('RECEIPT_SAMPLES_MISSING: receipt raw_samples must be a non-empty array')
    return
  }
  const requiredFields = array(budget.receipt_contract?.[mapping.receipt_fields_contract])
  const expectedCount = expectedReceiptSampleCount(mapping, budget)
  if (receipt.raw_samples.length !== expectedCount) {
    errors.push(`RECEIPT_SAMPLE_COUNT_MISMATCH: ${mapping.metric_id} requires exactly ${expectedCount} measured samples`)
  }
  const contextIds = new Set()
  receipt.raw_samples.forEach((sample, index) => {
    if (!isObject(sample)) {
      errors.push(`RECEIPT_SAMPLE_INVALID: raw sample ${index} must be an object`)
      return
    }
    for (const field of requiredFields) {
      if (!Object.hasOwn(sample, field)) errors.push(`RECEIPT_SAMPLE_FIELD_MISSING: raw sample ${index} missing ${field}`)
    }
    if (sample.metric_id !== receipt.metric_id || sample.target_id !== receipt.target_id) {
      errors.push(`RECEIPT_SAMPLE_IDENTITY_MISMATCH: raw sample ${index} does not match receipt metric and target`)
    }
    const observedValue = sample[mapping.observed_value_field]
    if (!finiteNonnegative(observedValue)) {
      errors.push(`RECEIPT_SAMPLE_VALUE_INVALID: raw sample ${index} ${mapping.observed_value_field} must be a finite nonnegative number`)
    } else if (['count', 'bytes', 'gzip_bytes'].includes(mapping.unit) && !Number.isInteger(observedValue)) {
      errors.push(`RECEIPT_SAMPLE_VALUE_INVALID: raw sample ${index} ${mapping.observed_value_field} must be an integer ${mapping.unit}`)
    }
    if (Object.hasOwn(sample, 'measurement_context_id')) {
      if (!nonEmptyString(sample.measurement_context_id)) {
        errors.push(`RECEIPT_CONTEXT_INVALID: raw sample ${index} measurement_context_id must be nonempty`)
      } else if (contextIds.has(sample.measurement_context_id)) {
        errors.push(`RECEIPT_CONTEXT_DUPLICATE: raw sample ${index} duplicates measurement_context_id`)
      } else {
        contextIds.add(sample.measurement_context_id)
      }
    }
    validateMetricSpecificObservation(sample, index, mapping, receipt.target_id, budget, validationContext, errors)
  })
}

function validateReceiptProvenance(receipt, budget, validationContext, errors) {
  if (!validCommitSha(receipt.commit_sha)) {
    errors.push('RECEIPT_COMMIT_SHA_INVALID: commit_sha must be a lowercase 40-character commit SHA')
  }
  const expectedCommitSha = validationContext?.expectedCommitSha
  if (!validCommitSha(expectedCommitSha)) {
    errors.push('RECEIPT_EXPECTED_COMMIT_REQUIRED: externally expected commit SHA is required and must be lowercase 40-character hex')
  } else if (receipt.commit_sha !== expectedCommitSha) {
    errors.push('RECEIPT_COMMIT_SHA_MISMATCH: receipt commit does not match the externally expected commit SHA')
  }
  const binding = budget.receipt_contract?.budget_hash_binding
  if (!isObject(binding)
    || binding.receipt_field !== 'budget_file_sha256'
    || binding.hash_algorithm !== 'sha256'
    || binding.hash_scope !== 'canonical_budget_excluding_expected_receipt_hash'
    || typeof binding.expected_sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(binding.expected_sha256)) {
    errors.push('RECEIPT_BUDGET_HASH_CONTRACT_INVALID: frozen non-circular budget hash binding is malformed')
  } else {
    const computed = computeReceiptBudgetHash(budget)
    if (computed !== binding.expected_sha256) {
      errors.push('RECEIPT_BUDGET_HASH_CONTRACT_DRIFT: frozen budget receipt hash does not match the current contract')
    }
    if (receipt.budget_file_sha256 !== binding.expected_sha256) {
      errors.push('RECEIPT_BUDGET_HASH_MISMATCH: receipt budget hash does not match the frozen contract')
    }
  }
  validateRunnerFingerprint(receipt.runner_fingerprint, receipt.actual_execution_profile, budget, errors)
}

export function computeReceiptBudgetHash(budget) {
  const projection = JSON.parse(JSON.stringify(budget))
  if (isObject(projection.receipt_contract?.budget_hash_binding)) {
    delete projection.receipt_contract.budget_hash_binding.expected_sha256
  }
  return sha256(stable(projection))
}

function validateRunnerFingerprint(fingerprint, actualProfile, budget, errors) {
  if (!isObject(fingerprint)) {
    errors.push('RUNNER_FINGERPRINT_INVALID: runner fingerprint must be an object')
    return
  }
  for (const field of array(budget.receipt_contract?.runner_fingerprint_required_fields)) {
    if (!Object.hasOwn(fingerprint, field)) errors.push(`RUNNER_FINGERPRINT_MISSING: runner fingerprint missing ${field}`)
  }
  for (const field of ['runner_provider', 'runner_image', 'runner_image_version', 'runner_architecture', 'cpu_model', 'node_version', 'browser_name', 'browser_build']) {
    if (Object.hasOwn(fingerprint, field) && !nonEmptyString(fingerprint[field])) {
      errors.push(`RUNNER_FINGERPRINT_INVALID: runner fingerprint ${field} must be a nonempty string`)
    }
  }
  for (const field of ['logical_cpu_cores', 'memory_bytes']) {
    if (Object.hasOwn(fingerprint, field) && (!Number.isInteger(fingerprint[field]) || fingerprint[field] <= 0)) {
      errors.push(`RUNNER_FINGERPRINT_INVALID: runner fingerprint ${field} must be a positive integer`)
    }
  }
  if (!isObject(actualProfile)) return
  const linkedFields = [
    ['runner_provider', 'runner_provider'],
    ['runner_image', 'runner_image'],
    ['runner_architecture', 'runner_architecture'],
  ]
  for (const [fingerprintField, profileField] of linkedFields) {
    if (fingerprint[fingerprintField] !== actualProfile[profileField]) {
      errors.push(`RUNNER_FINGERPRINT_MISMATCH: runner fingerprint ${fingerprintField} does not match actual execution profile`)
    }
  }
  const nodeMajor = Number.parseInt(String(fingerprint.node_version).split('.')[0], 10)
  if (nodeMajor !== actualProfile.node_major) errors.push('RUNNER_FINGERPRINT_MISMATCH: runner fingerprint node_version does not match node_major')
  const expectedBrowser = actualProfile.browser_engine ?? 'not_applicable'
  if (fingerprint.browser_name !== expectedBrowser) errors.push('RUNNER_FINGERPRINT_MISMATCH: runner fingerprint browser_name does not match actual execution profile')
  if (expectedBrowser === 'not_applicable' && fingerprint.browser_build !== 'not_applicable') {
    errors.push('RUNNER_FINGERPRINT_MISMATCH: non-browser profile must record browser_build as not_applicable')
  }
}

function validateReceiptTarget(receipt, mapping, budget, errors) {
  const allowedTargets = allowedTargetIds(mapping.metric_id, budget)
  if (!nonEmptyString(receipt.target_id) || !allowedTargets.includes(receipt.target_id)) {
    errors.push(`RECEIPT_TARGET_NOT_AUTHORIZED: target ${receipt.target_id} is not authorized for metric ${mapping.metric_id}`)
  }
}

function allowedTargetIds(metricId, budget) {
  const ids = []
  for (const collectionName of ['audited_data_access_paths', 'chart_payloads', 'web_vitals_journeys']) {
    for (const target of array(budget.targets?.[collectionName])) {
      if (array(target?.metric_ids).includes(metricId)) ids.push(target.target_id)
    }
  }
  if (budget.targets?.initial_application_javascript_metric_id === metricId) {
    ids.push(...array(budget.targets?.initial_application_javascript_routes))
  }
  if (array(budget.targets?.camera_readiness?.metric_ids).includes(metricId)) {
    ids.push(budget.targets.camera_readiness.target_id)
  }
  return [...new Set(ids.filter(nonEmptyString))]
}

function expectedReceiptSampleCount(mapping, budget) {
  if (mapping.measurement_profile_id === 'api_local_ci') return budget.measurement_protocols?.api?.measured_observations_per_target
  if (['lcp_p95_milliseconds', 'inp_p95_milliseconds', 'cls_p95_ratio'].includes(mapping.metric_id)) {
    return budget.measurement_protocols?.web_vitals?.measured_navigations_per_route
  }
  if (mapping.metric_id === 'cold_camera_readiness_p95_milliseconds') return budget.measurement_protocols?.camera?.cold_fresh_context_observations
  if (mapping.metric_id === 'warm_camera_readiness_p95_milliseconds') return budget.measurement_protocols?.camera?.warm_cached_observations
  if (mapping.metric_id === 'maximum_initial_application_javascript_gzip_bytes') return 1
  return 0
}

function validateMetricSpecificObservation(sample, index, mapping, targetId, budget, validationContext, errors) {
  if (mapping.metric_id === 'lcp_p95_milliseconds') {
    validateTiming(sample, index, budget.measurement_definitions?.web_vitals?.lcp, 'web-vitals', errors)
  } else if (mapping.metric_id === 'inp_p95_milliseconds') {
    validateTiming(sample, index, budget.measurement_definitions?.web_vitals?.inp, 'web-vitals', errors)
    validateInpTrace(sample, index, targetId, budget, errors)
  } else if (mapping.metric_id === 'cls_p95_ratio') {
    validateTiming(sample, index, budget.measurement_definitions?.web_vitals?.cls, 'web-vitals', errors)
  } else if (['cold_camera_readiness_p95_milliseconds', 'warm_camera_readiness_p95_milliseconds'].includes(mapping.metric_id)) {
    validateCameraObservation(sample, index, mapping.metric_id, budget, errors)
  } else if (mapping.metric_id === 'maximum_initial_application_javascript_gzip_bytes') {
    validateJavascriptObservation(sample, index, targetId, budget, validationContext, errors)
  } else if (['maximum_cursor_duplicates', 'maximum_cursor_omissions'].includes(mapping.metric_id)
    && sample.concurrent_insert_case !== true) {
    errors.push(`CURSOR_CONCURRENT_INSERT_MISSING: raw sample ${index} must exercise the frozen concurrent-insert case`)
  }
}

function validateTiming(sample, index, definition, label, errors) {
  if (!isObject(definition)
    || sample.timing_start_event !== definition.timing_start_event
    || sample.timing_end_event !== definition.timing_end_event) {
    errors.push(`${label.toUpperCase().replace('-', '_')}_TIMING_MISMATCH: raw sample ${index} timing boundary mismatch`)
  }
}

function validateInpTrace(sample, index, targetId, budget, errors) {
  const target = array(budget.targets?.web_vitals_journeys).find(journey => journey?.target_id === targetId)
  if (!target || sample.interaction_trace_id !== target.inp_interaction_trace_id) {
    errors.push(`INP_INTERACTION_TRACE_MISMATCH: raw sample ${index} interaction trace mismatch`)
    return
  }
  const steps = sample.interaction_steps
  const expectedSteps = array(target.inp_interaction_steps)
  if (!Array.isArray(steps)
    || stable(steps.map(step => step?.interaction_step_id)) !== stable(expectedSteps)) {
    errors.push(`INP_INTERACTION_STEPS_MISMATCH: raw sample ${index} interaction steps mismatch`)
    return
  }
  const requiredFields = array(budget.receipt_contract?.inp_interaction_step_required_fields)
  const durations = []
  steps.forEach((step, stepIndex) => {
    if (!isObject(step)) {
      errors.push(`INP_INTERACTION_STEP_INVALID: raw sample ${index} step ${stepIndex} must be an object`)
      return
    }
    for (const field of requiredFields) {
      if (!Object.hasOwn(step, field)) errors.push(`INP_INTERACTION_STEP_INVALID: raw sample ${index} step ${stepIndex} missing ${field}`)
    }
    if (!finiteNonnegative(step.duration_milliseconds)) {
      errors.push(`INP_INTERACTION_STEP_INVALID: raw sample ${index} step ${stepIndex} duration must be a finite nonnegative number`)
    } else {
      durations.push(step.duration_milliseconds)
    }
  })
  if (durations.length === steps.length && sample.inp_milliseconds !== Math.max(...durations)) {
    errors.push(`INP_INTERACTION_RESULT_MISMATCH: raw sample ${index} inp_milliseconds must equal the longest named interaction duration`)
  }
}

function validateCameraObservation(sample, index, metricId, budget, errors) {
  const definition = budget.measurement_definitions?.camera_readiness
  const expectedCache = metricId === 'cold_camera_readiness_p95_milliseconds'
    ? definition?.cold?.cache_profile
    : definition?.warm?.cache_profile
  if (sample.cache_profile !== expectedCache) errors.push(`CAMERA_CACHE_MISMATCH: raw sample ${index} camera cache profile mismatch`)
  if (sample.timing_start_event !== definition?.timing_start_event || sample.timing_end_event !== definition?.timing_end_event) {
    errors.push(`CAMERA_TIMING_MISMATCH: raw sample ${index} camera timing boundary mismatch`)
  }
  if (sample.readiness_outcome !== 'success') errors.push(`CAMERA_READINESS_MISMATCH: raw sample ${index} camera readiness outcome must be success`)
}

function validateJavascriptObservation(sample, index, targetId, budget, validationContext, errors) {
  const definition = budget.measurement_definitions?.initial_application_javascript
  if (sample.accounting_start_event !== definition?.accounting_start_event
    || sample.readiness_cutoff_event !== definition?.readiness_cutoff_event) {
    errors.push(`JAVASCRIPT_TIMING_MISMATCH: raw sample ${index} JavaScript accounting boundary mismatch`)
  }
  const included = sample.included_resource_inventory
  const excluded = sample.excluded_resource_inventory
  if (!Array.isArray(included) || included.length === 0 || !Array.isArray(excluded)) {
    errors.push(`JAVASCRIPT_INVENTORY_INVALID: raw sample ${index} must contain a nonempty included inventory and an excluded inventory`)
    return
  }
  const includedUrls = new Set()
  let includedTotal = 0
  for (const [resourceIndex, resource] of included.entries()) {
    if (!validJavascriptResource(resource, budget.receipt_contract?.included_javascript_resource_required_fields)) {
      errors.push(`JAVASCRIPT_RESOURCE_INVALID: included resource ${resourceIndex} is malformed`)
      continue
    }
    if (includedUrls.has(resource.resource_url)) errors.push(`JAVASCRIPT_RESOURCE_DUPLICATE: included resource URL ${resource.resource_url} is duplicated`)
    includedUrls.add(resource.resource_url)
    includedTotal += resource.gzip_bytes
  }
  if (![...includedUrls].some(url => url.startsWith('/_next/static/'))) {
    errors.push('JAVASCRIPT_APPLICATION_CHUNK_MISSING: included inventory must contain an application /_next/static/ resource')
  }
  const excludedUrls = new Set()
  const allowedPrefixes = array(definition?.allowed_excluded_url_prefixes)
  const neverPrefixes = array(definition?.never_excluded_url_prefixes)
  for (const [resourceIndex, resource] of excluded.entries()) {
    if (!validJavascriptResource(resource, budget.receipt_contract?.excluded_javascript_resource_required_fields)) {
      errors.push(`JAVASCRIPT_RESOURCE_INVALID: excluded resource ${resourceIndex} is malformed`)
      continue
    }
    if (excludedUrls.has(resource.resource_url) || includedUrls.has(resource.resource_url)) {
      errors.push(`JAVASCRIPT_RESOURCE_DUPLICATE: resource URL ${resource.resource_url} is duplicated or both included and excluded`)
    }
    excludedUrls.add(resource.resource_url)
    const matched = allowedPrefixes.find(prefix => resource.resource_url.startsWith(prefix))
    if (!matched || resource.matched_allowed_url_prefix !== matched) {
      errors.push(`JAVASCRIPT_EXCLUSION_PREFIX_MISMATCH: excluded resource ${resource.resource_url} does not match its literal allowed exclusion prefix`)
    }
    if (neverPrefixes.some(prefix => resource.resource_url.startsWith(prefix))) {
      errors.push(`JAVASCRIPT_NEVER_EXCLUDED: resource ${resource.resource_url} uses a never-excluded application prefix`)
    }
  }
  if (sample.total_included_gzip_bytes !== includedTotal) {
    errors.push(`JAVASCRIPT_TOTAL_MISMATCH: raw sample ${index} JavaScript included total does not equal the resource inventory sum`)
  }
  validateJavascriptDiscoveryBinding(sample, targetId, included, excluded, budget, validationContext, errors)
}

function validJavascriptResource(resource, requiredFields) {
  if (!isObject(resource)) return false
  if (array(requiredFields).some(field => !Object.hasOwn(resource, field))) return false
  return nonEmptyString(resource.resource_url) && Number.isInteger(resource.gzip_bytes) && resource.gzip_bytes > 0
}

function validateJavascriptDiscoveryBinding(sample, targetId, included, excluded, budget, validationContext, errors) {
  const discoveries = validationContext?.expectedJavascriptDiscoveries
  const expected = isObject(discoveries) ? discoveries[targetId] : undefined
  if (!isObject(expected)) {
    errors.push(`JAVASCRIPT_DISCOVERY_REQUIRED: externally discovered JavaScript inventory is required for route ${targetId}`)
    return
  }
  if (!sha256String(expected.discovery_artifact_sha256)) {
    errors.push(`JAVASCRIPT_DISCOVERY_ARTIFACT_INVALID: external discovery artifact hash is invalid for route ${targetId}`)
    return
  }
  if (sample.discovery_artifact_sha256 !== expected.discovery_artifact_sha256) {
    errors.push(`JAVASCRIPT_DISCOVERY_ARTIFACT_HASH_MISMATCH: receipt discovery artifact hash does not match route ${targetId}`)
  }

  const includedFields = budget.receipt_contract?.included_javascript_resource_required_fields
  const excludedFields = budget.receipt_contract?.excluded_javascript_resource_required_fields
  const expectedIncluded = normalizeJavascriptInventory(expected.included_resource_inventory, includedFields)
  const expectedExcluded = normalizeJavascriptInventory(expected.excluded_resource_inventory, excludedFields)
  if (!expectedIncluded || !expectedExcluded) {
    errors.push(`JAVASCRIPT_DISCOVERY_INVENTORY_INVALID: external discovery inventory is malformed for route ${targetId}`)
    return
  }
  if (new Set(expectedIncluded.map(resource => resource.resource_url)).size !== expectedIncluded.length
    || new Set(expectedExcluded.map(resource => resource.resource_url)).size !== expectedExcluded.length
    || expectedIncluded.some(resource => expectedExcluded.some(excludedResource => excludedResource.resource_url === resource.resource_url))) {
    errors.push(`JAVASCRIPT_DISCOVERY_INVENTORY_INVALID: external discovery inventory contains duplicate route resources for ${targetId}`)
    return
  }
  const actualIncluded = normalizeJavascriptInventory(included, includedFields)
  const actualExcluded = normalizeJavascriptInventory(excluded, excludedFields)
  if (!actualIncluded || !actualExcluded
    || stable(actualIncluded) !== stable(expectedIncluded)
    || stable(actualExcluded) !== stable(expectedExcluded)) {
    errors.push(`JAVASCRIPT_DISCOVERY_INVENTORY_MISMATCH: receipt inventory does not equal the externally discovered inventory for route ${targetId}`)
  }
  const expectedInventoryHash = javascriptDiscoveryInventoryHash(targetId, expectedIncluded, expectedExcluded)
  if (sample.discovery_inventory_sha256 !== expectedInventoryHash) {
    errors.push(`JAVASCRIPT_DISCOVERY_INVENTORY_HASH_MISMATCH: receipt discovery inventory hash does not match route ${targetId}`)
  }
}

function normalizeJavascriptInventory(inventory, requiredFields) {
  if (!Array.isArray(inventory)) return null
  const fields = array(requiredFields)
  const normalized = []
  for (const resource of inventory) {
    if (!validJavascriptResource(resource, fields)) return null
    normalized.push(Object.fromEntries(fields.map(field => [field, resource[field]])))
  }
  return normalized.sort((left, right) => stable(left).localeCompare(stable(right)))
}

function javascriptDiscoveryInventoryHash(targetId, included, excluded) {
  return sha256(stable({
    target_id: targetId,
    included_resource_inventory: included,
    excluded_resource_inventory: excluded,
  }))
}

function validateReceiptProfile(receipt, mapping, budget, errors) {
  if (receipt.measurement_profile_id !== mapping.measurement_profile_id) {
    errors.push(`MEASUREMENT_PROFILE_ID_MISMATCH: measurement profile ID mismatch for ${mapping.metric_id}`)
  }
  const profiles = array(budget.measurement_profiles).filter(profile => profile?.profile_id === mapping.measurement_profile_id)
  if (profiles.length !== 1) {
    errors.push(`MEASUREMENT_PROFILE_UNMAPPED: measurement profile ${mapping.measurement_profile_id} must resolve exactly once`)
    return
  }
  const expected = profiles[0].expected_actual_execution_profile
  const actual = receipt.actual_execution_profile
  if (!isObject(actual)) {
    errors.push('ACTUAL_PROFILE_MISSING: actual profile missing from receipt')
    return
  }
  if (stable(Object.keys(actual).sort()) !== stable(Object.keys(expected).sort())) {
    errors.push('ACTUAL_PROFILE_KEYSET_MISMATCH: actual profile key set must exactly match the frozen measurement profile')
  }
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (!Object.hasOwn(actual, field)) errors.push(`ACTUAL_PROFILE_MISSING: actual profile missing ${field}`)
    else if (stable(actual[field]) !== stable(expectedValue)) errors.push(`ACTUAL_PROFILE_MISMATCH: actual profile mismatch for ${field}`)
  }
}

function validateReceiptFixtures(receipt, mapping, budget, errors) {
  if (!Array.isArray(receipt.fixture_record_counts)) {
    errors.push('FIXTURE_COUNT_PROVENANCE_INVALID: fixture_record_counts must be an array')
    return
  }
  const policies = array(budget.fixtures?.policies).filter(policy => policy?.fixture_policy_id === mapping.fixture_policy_id)
  if (policies.length !== 1) {
    errors.push(`FIXTURE_POLICY_UNMAPPED: fixture policy ${mapping.fixture_policy_id} must resolve exactly once`)
    return
  }
  const policy = policies[0]
  const samples = array(receipt.raw_samples).filter(isObject)
  if (policy.fixture_policy_id === 'not_applicable') {
    if (array(receipt.fixture_record_counts).length !== 0) errors.push('FIXTURE_NOT_APPLICABLE: non-fixture receipt must record an empty fixture_record_counts array')
    return
  }
  const catalog = new Map(array(budget.fixtures?.catalog).map(row => [row?.fixture_id, row?.fixture_record_count]))
  const groups = new Set()
  for (const sample of samples) {
    const expectedCount = catalog.get(sample.fixture_id)
    if (expectedCount !== sample.fixture_record_count) errors.push(`FIXTURE_LABEL_MISMATCH: fixture label mismatch for ${sample.fixture_id}`)
    if (!array(policy.allowed_fixture_ids).includes(sample.fixture_id)) {
      errors.push(`REQUIRED_FIXTURE_MISMATCH: required fixture record count ${policy.required_fixture_record_count ?? 'from the frozen catalog'}`)
    }
    if (Number.isFinite(policy.required_fixture_record_count) && sample.fixture_record_count !== policy.required_fixture_record_count) {
      errors.push(`REQUIRED_FIXTURE_MISMATCH: required fixture record count ${policy.required_fixture_record_count}`)
    }
    groups.add(stable([sample.fixture_id, sample.fixture_record_count]))
  }
  if (groups.size !== 1) errors.push('MIXED_FIXTURE_GROUP: mixed fixture group observations are forbidden')
  const observedCounts = [...new Set(samples.map(sample => sample.fixture_record_count))].sort((left, right) => left - right)
  const declaredCounts = [...array(receipt.fixture_record_counts)].sort((left, right) => left - right)
  if (stable(observedCounts) !== stable(declaredCounts)) errors.push('FIXTURE_COUNT_PROVENANCE_MISMATCH: fixture_record_counts must equal the raw sample fixture group')
}

export function validateJsonWithSchema(value, schema) {
  const definitionErrors = []
  inspectSchemaNode(schema, '#', definitionErrors, schema)
  if (definitionErrors.length > 0) return definitionErrors
  const validationErrors = []
  applySchemaNode(value, schema, schema, '#', validationErrors)
  return validationErrors
}

export function checkPerformanceBudgetFiles({
  budgetPath = DEFAULT_BUDGET_PATH,
  schemaPath = DEFAULT_SCHEMA_PATH,
} = {}) {
  let budgetBytes = ''
  let schemaBytes = ''
  try {
    budgetBytes = readFileSync(resolve(budgetPath), 'utf8')
    schemaBytes = readFileSync(resolve(schemaPath), 'utf8')
    const result = validatePerformanceBudgets(JSON.parse(budgetBytes), JSON.parse(schemaBytes))
    return {
      ...result,
      budget_sha256: sha256(budgetBytes),
      schema_sha256: sha256(schemaBytes),
      checker_sha256: sha256(readFileSync(CHECKER_PATH, 'utf8')),
    }
  } catch (caught) {
    return {
      status: 'FAIL',
      contract_id: null,
      phase: null,
      performance_status: 'NOT_MEASURED',
      performance_claimed: false,
      errors: [`FILE_OR_JSON_INVALID: ${caught instanceof Error ? caught.message : String(caught)}`],
      budget_sha256: budgetBytes ? sha256(budgetBytes) : null,
      schema_sha256: schemaBytes ? sha256(schemaBytes) : null,
      checker_sha256: sha256(readFileSync(CHECKER_PATH, 'utf8')),
    }
  }
}

function inspectSchemaNode(node, path, errors, root) {
  if (!isObject(node)) {
    errors.push(`SCHEMA_DEFINITION_INVALID: ${path} must be an object schema`)
    return
  }
  for (const keyword of Object.keys(node)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(keyword)) errors.push(`SCHEMA_UNSUPPORTED_KEYWORD: unsupported schema keyword ${keyword} at ${path}`)
  }
  for (const keyword of ['$schema', '$id', 'title', 'description']) {
    if (node[keyword] !== undefined && typeof node[keyword] !== 'string') errors.push(`SCHEMA_DEFINITION_INVALID: ${path}.${keyword} must be a string`)
  }
  if (node.type !== undefined) {
    const types = Array.isArray(node.type) ? node.type : [node.type]
    if (types.length === 0 || types.some(type => typeof type !== 'string' || !SUPPORTED_SCHEMA_TYPES.has(type)) || new Set(types).size !== types.length) {
      errors.push(`SCHEMA_DEFINITION_INVALID: ${path}.type has an illegal form`)
    }
  }
  if (node.additionalProperties !== undefined && typeof node.additionalProperties !== 'boolean') {
    errors.push(`SCHEMA_DEFINITION_INVALID: ${path}.additionalProperties must be a boolean`)
  }
  if (node.required !== undefined && (!Array.isArray(node.required)
    || node.required.some(value => typeof value !== 'string')
    || new Set(node.required).size !== node.required.length)) {
    errors.push(`SCHEMA_DEFINITION_INVALID: ${path}.required must contain unique strings`)
  }
  if (node.enum !== undefined && (!Array.isArray(node.enum) || node.enum.length === 0 || new Set(node.enum.map(stable)).size !== node.enum.length)) {
    errors.push(`SCHEMA_DEFINITION_INVALID: ${path}.enum must be a non-empty unique array`)
  }
  if (node.pattern !== undefined) {
    if (typeof node.pattern !== 'string') errors.push(`SCHEMA_DEFINITION_INVALID: ${path}.pattern must be a string`)
    else try { new RegExp(node.pattern) } catch { errors.push(`SCHEMA_DEFINITION_INVALID: ${path}.pattern is invalid`) }
  }
  for (const keyword of ['minItems', 'maxItems']) {
    if (node[keyword] !== undefined && (!Number.isInteger(node[keyword]) || node[keyword] < 0)) errors.push(`SCHEMA_DEFINITION_INVALID: ${path}.${keyword} must be a non-negative integer`)
  }
  if (Number.isInteger(node.minItems) && Number.isInteger(node.maxItems) && node.minItems > node.maxItems) {
    errors.push(`SCHEMA_DEFINITION_INVALID: ${path}.minItems cannot exceed maxItems`)
  }
  for (const keyword of ['minimum', 'maximum']) {
    if (node[keyword] !== undefined && (typeof node[keyword] !== 'number' || !Number.isFinite(node[keyword]))) errors.push(`SCHEMA_DEFINITION_INVALID: ${path}.${keyword} must be a finite number`)
  }
  if (Number.isFinite(node.minimum) && Number.isFinite(node.maximum) && node.minimum > node.maximum) {
    errors.push(`SCHEMA_DEFINITION_INVALID: ${path}.minimum cannot exceed maximum`)
  }
  if (node.uniqueItems !== undefined && typeof node.uniqueItems !== 'boolean') {
    errors.push(`SCHEMA_DEFINITION_INVALID: ${path}.uniqueItems must be a boolean`)
  }
  for (const container of ['$defs', 'properties']) {
    if (node[container] === undefined) continue
    if (!isObject(node[container])) {
      errors.push(`SCHEMA_DEFINITION_INVALID: ${path}.${container} must be an object`)
    } else {
      for (const [key, child] of Object.entries(node[container])) inspectSchemaNode(child, `${path}.${container}.${key}`, errors, root)
    }
  }
  if (node.items !== undefined) {
    if (!isObject(node.items)) errors.push(`SCHEMA_DEFINITION_INVALID: ${path}.items must be an object schema`)
    else inspectSchemaNode(node.items, `${path}.items`, errors, root)
  }
  if (node.$ref !== undefined) {
    if (typeof node.$ref !== 'string' || !node.$ref.startsWith('#/')) errors.push(`SCHEMA_DEFINITION_INVALID: ${path} contains a non-local $ref`)
    else if (!isObject(resolveSchemaRef(root, node.$ref))) errors.push(`SCHEMA_DEFINITION_INVALID: ${path} contains an unresolved local $ref`)
  }
}

function applySchemaNode(value, node, root, path, errors) {
  if (typeof node.$ref === 'string') {
    const target = resolveSchemaRef(root, node.$ref)
    if (!isObject(target)) {
      errors.push(`SCHEMA_DEFINITION_INVALID: unresolved local $ref ${node.$ref}`)
      return
    }
    applySchemaNode(value, target, root, path, errors)
  }
  if (Object.hasOwn(node, 'const') && stable(value) !== stable(node.const)) errors.push(`SCHEMA_VALIDATION: ${path} violates schema const`)
  if (Array.isArray(node.enum) && !node.enum.some(candidate => stable(candidate) === stable(value))) errors.push(`SCHEMA_VALIDATION: ${path} violates schema enum`)

  const allowedTypes = Array.isArray(node.type) ? node.type : node.type === undefined ? [] : [node.type]
  if (allowedTypes.length > 0 && !allowedTypes.some(type => schemaTypeMatches(value, type))) {
    errors.push(`SCHEMA_VALIDATION: ${path} violates schema type`)
    return
  }
  if (typeof value === 'string' && typeof node.pattern === 'string') {
    try {
      if (!new RegExp(node.pattern).test(value)) errors.push(`SCHEMA_VALIDATION: ${path} violates schema pattern`)
    } catch {
      errors.push(`SCHEMA_DEFINITION_INVALID: ${path} contains an invalid pattern`)
    }
  }
  if (typeof value === 'number') {
    if (Number.isFinite(node.minimum) && value < node.minimum) errors.push(`SCHEMA_VALIDATION: ${path} violates schema minimum`)
    if (Number.isFinite(node.maximum) && value > node.maximum) errors.push(`SCHEMA_VALIDATION: ${path} violates schema maximum`)
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(node.minItems) && value.length < node.minItems) errors.push(`SCHEMA_VALIDATION: ${path} violates schema minItems`)
    if (Number.isInteger(node.maxItems) && value.length > node.maxItems) errors.push(`SCHEMA_VALIDATION: ${path} violates schema maxItems`)
    if (node.uniqueItems === true && new Set(value.map(stable)).size !== value.length) errors.push(`SCHEMA_VALIDATION: ${path} violates schema uniqueItems`)
    if (isObject(node.items)) value.forEach((item, index) => applySchemaNode(item, node.items, root, `${path}[${index}]`, errors))
  }
  if (isObject(value)) {
    const properties = isObject(node.properties) ? node.properties : {}
    for (const required of array(node.required)) {
      if (!Object.hasOwn(value, required)) errors.push(`SCHEMA_VALIDATION: ${path}.${required} violates schema required`)
    }
    if (node.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) errors.push(`SCHEMA_VALIDATION: ${path}.${key} violates schema additionalProperties`)
      }
    }
    for (const [key, child] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) applySchemaNode(value[key], child, root, `${path}.${key}`, errors)
    }
  }
}

function validateSemanticInvariants(budget, errors) {
  if (!isObject(budget)) return
  if (sha256(stable(budget)) !== FROZEN_BUDGET_CANONICAL_SHA256) {
    errors.push('FROZEN_CONTRACT_DRIFT: frozen contract drift from the independently hashed canonical budget')
  }
  if (budget.change_control?.performance_claimed !== false || budget.change_control?.baseline_recorded !== false) {
    errors.push('PRE_BASELINE_ONLY: this contract cannot contain performance results or claims')
  }
  validateMetricMappings(budget, errors)
  const bits = budget.throttling?.download_bits_per_second
  const bytes = budget.throttling?.download_bytes_per_second
  if (!Number.isFinite(bits) || !Number.isFinite(bytes) || bits !== bytes * 8) {
    errors.push('NETWORK_UNIT_MISMATCH: bits/s must equal eight times bytes/s')
  }
  const targetCollections = [
    budget.targets?.audited_data_access_paths,
    budget.targets?.chart_payloads,
    budget.targets?.web_vitals_journeys,
  ]
  for (const collection of targetCollections) {
    if (!Array.isArray(collection)) continue
    const ids = collection.map(target => target?.target_id).filter(id => typeof id === 'string')
    if (new Set(ids).size !== ids.length) errors.push('TARGET_ID_DUPLICATE: duplicate target ID')
  }
  const auditedIds = new Set(array(budget.targets?.audited_data_access_paths).map(target => target?.target_id))
  if (array(budget.targets?.query_plan_target_ids).some(id => !auditedIds.has(id))) {
    errors.push('TARGET_REFERENCE_UNKNOWN: unknown target reference in query-plan target IDs')
  }
  if (stable(budget.targets?.initial_application_javascript_routes) !== stable(FROZEN_INITIAL_JAVASCRIPT_ROUTES)) {
    errors.push('INITIAL_JAVASCRIPT_ROUTE_CONTRACT: initial JavaScript route contract was deleted, reordered, or mutated')
  }
  const javascriptDefinition = budget.measurement_definitions?.initial_application_javascript
  if (stable(javascriptDefinition?.allowed_excluded_url_prefixes) !== stable(FROZEN_ALLOWED_JAVASCRIPT_EXCLUSION_PREFIXES)
    || stable(javascriptDefinition?.never_excluded_url_prefixes) !== stable(FROZEN_NEVER_EXCLUDED_JAVASCRIPT_PREFIXES)) {
    errors.push('INITIAL_JAVASCRIPT_EXCLUSION_CONTRACT: initial JavaScript exclusion contract is not the literal approved prefix set')
  }
  const fixtureCounts = budget.fixtures?.record_counts
  if (!Array.isArray(fixtureCounts) || Math.max(...fixtureCounts) !== budget.fixtures?.largest_seeded_api_fixture_records) {
    errors.push('FIXTURE_MAX_MISMATCH: largest fixture must match the fixture count list')
  }
}

function validateMetricMappings(budget, errors) {
  const mappings = array(budget.metric_registry)
  const budgetMetricIds = isObject(budget.budgets) ? Object.keys(budget.budgets) : []
  const budgetMetricIdSet = new Set(budgetMetricIds)
  const mappingsById = new Map()
  validateCalculationContracts(budget.receipt_contract, errors)
  validateMeasurementProfiles(budget, errors)

  for (const mapping of mappings) {
    if (!isObject(mapping) || typeof mapping.metric_id !== 'string') continue
    const entries = mappingsById.get(mapping.metric_id) ?? []
    entries.push(mapping)
    mappingsById.set(mapping.metric_id, entries)
  }

  for (const [metricId, entries] of mappingsById) {
    if (entries.length > 1) errors.push(`METRIC_MAPPING_DUPLICATE: metric mapping duplicate for ${metricId}`)
    if (!budgetMetricIdSet.has(metricId)) errors.push(`METRIC_MAPPING_UNKNOWN: metric mapping unknown budget metric ${metricId}`)
  }
  for (const metricId of budgetMetricIds) {
    if ((mappingsById.get(metricId) ?? []).length === 0) errors.push(`METRIC_MAPPING_UNMAPPED: metric mapping unmapped budget metric ${metricId}`)
  }

  for (const [metricId, expected] of Object.entries(FROZEN_METRIC_MAPPINGS)) {
    const entries = mappingsById.get(metricId) ?? []
    if (entries.length !== 1) continue
    const mapping = entries[0]
    const [observedValueField, unit, aggregation, receiptFieldsContract, calculationFieldsContract, measurementProfileId, fixturePolicyId] = expected
    if (mapping.budget_field !== `budgets.${metricId}`
      || mapping.observed_value_field !== observedValueField
      || mapping.unit !== unit
      || mapping.aggregation !== aggregation
      || mapping.comparison_operator !== 'less_than_or_equal'
      || mapping.receipt_fields_contract !== receiptFieldsContract
      || mapping.calculation_fields_contract !== calculationFieldsContract
      || mapping.measurement_profile_id !== measurementProfileId
      || mapping.fixture_policy_id !== fixturePolicyId) {
      errors.push(`METRIC_MAPPING_SEMANTICS: metric mapping for ${metricId} does not match its frozen value semantics`)
    }
    if (mapping.measurement_profile_id !== measurementProfileId) {
      errors.push(`METRIC_MEASUREMENT_PROFILE_MISMATCH: metric measurement profile mismatch for ${metricId}`)
    }
    if (array(budget.measurement_profiles).filter(profile => profile?.profile_id === mapping.measurement_profile_id).length !== 1) {
      errors.push(`METRIC_MEASUREMENT_PROFILE_UNMAPPED: metric measurement profile for ${metricId} must resolve exactly once`)
    }
    if (array(budget.fixtures?.policies).filter(policy => policy?.fixture_policy_id === mapping.fixture_policy_id).length !== 1) {
      errors.push(`METRIC_FIXTURE_POLICY_UNMAPPED: metric fixture policy for ${metricId} must resolve exactly once`)
    }
    const receiptFields = budget.receipt_contract?.[receiptFieldsContract]
    if (!Array.isArray(receiptFields)
      || !receiptFields.includes('metric_id')
      || !receiptFields.includes('target_id')
      || !receiptFields.includes(observedValueField)) {
      errors.push(`METRIC_RECEIPT_MAPPING: metric mapping for ${metricId} does not resolve to a receipt containing ${observedValueField}`)
    }
    const calculationContract = CALCULATION_CONTRACTS[mapping.calculation_fields_contract]
    if (!calculationContract) {
      errors.push(`METRIC_CALCULATION_CONTRACT_UNMAPPED: metric calculation contract for ${metricId} is unmapped`)
    } else if (calculationContract.aggregation !== mapping.aggregation) {
      errors.push(`METRIC_CALCULATION_CONTRACT_MISMATCH: metric calculation contract mismatch for ${metricId} and aggregation ${mapping.aggregation}`)
    }
  }

  for (const { metricId, targetId } of collectTargetMetricReferences(budget)) {
    if ((mappingsById.get(metricId) ?? []).length !== 1) {
      errors.push(`TARGET_METRIC_MAPPING: target metric ${metricId} on ${targetId} must resolve to exactly one mapping`)
    }
  }

  const definitions = budget.measurement_definitions
  validateDefinitionMapping(definitions?.api_response_body, mappingsById, 'maximum_response_bytes', 'api_response_body', errors)
  validateDefinitionMapping(definitions?.web_vitals?.lcp, mappingsById, 'lcp_p95_milliseconds', 'web_vitals.lcp', errors)
  validateDefinitionMapping(definitions?.web_vitals?.inp, mappingsById, 'inp_p95_milliseconds', 'web_vitals.inp', errors)
  validateDefinitionMapping(definitions?.web_vitals?.cls, mappingsById, 'cls_p95_ratio', 'web_vitals.cls', errors)
  validateDefinitionMapping(definitions?.camera_readiness?.cold, mappingsById, 'cold_camera_readiness_p95_milliseconds', 'camera_readiness.cold', errors)
  validateDefinitionMapping(definitions?.camera_readiness?.warm, mappingsById, 'warm_camera_readiness_p95_milliseconds', 'camera_readiness.warm', errors)
  validateDefinitionMapping(definitions?.initial_application_javascript, mappingsById, 'maximum_initial_application_javascript_gzip_bytes', 'initial_application_javascript', errors)

  const clsFields = budget.receipt_contract?.cls_observation_required_fields
  if (!Array.isArray(clsFields) || !clsFields.includes('cls_ratio') || clsFields.includes('duration_milliseconds')) {
    errors.push('CLS_OBSERVATION_CONTRACT: CLS observation contract must record cls_ratio and must not record duration_milliseconds')
  }
}

function validateMeasurementProfiles(budget, errors) {
  if (stable(budget.measurement_profiles) !== stable(expectedMeasurementProfiles(budget))) {
    errors.push('MEASUREMENT_PROFILE_DRIFT: measurement profile drift from frozen runner, throttle, or deterministic accounting')
  }
}

function expectedMeasurementProfiles(budget) {
  const runner = budget.runner ?? {}
  const browser = runner.browser ?? {}
  const common = {
    runner_provider: runner.provider,
    runner_image: runner.image,
    runner_architecture: runner.architecture,
    node_major: runner.node_major,
    database: runner.database,
    application_mode: runner.application_mode,
    workers: runner.workers,
    measurement_retries: runner.measurement_retries,
  }
  const browserContext = {
    browser_engine: browser.engine,
    viewport_width_css_pixels: browser.viewport_width_css_pixels,
    viewport_height_css_pixels: browser.viewport_height_css_pixels,
    device_pixel_ratio: browser.device_pixel_ratio,
  }
  return [
    {
      profile_id: 'api_local_ci',
      expected_actual_execution_profile: { ...common, network_profile: 'unthrottled_local_loopback' },
    },
    {
      profile_id: 'throttled_browser_camera',
      expected_actual_execution_profile: {
        ...common,
        ...browserContext,
        network_profile: 'fixed_throttle',
        download_bits_per_second: budget.throttling?.download_bits_per_second,
        download_bytes_per_second: budget.throttling?.download_bytes_per_second,
        cpu_slowdown_factor: budget.throttling?.cpu_slowdown_factor,
      },
    },
    {
      profile_id: 'deterministic_bundle',
      expected_actual_execution_profile: {
        ...common,
        ...browserContext,
        accounting_mode: 'deterministic_gzip',
        gzip_level: 9,
        gzip_mtime_seconds: 0,
      },
    },
  ]
}

function validateCalculationContracts(receiptContract, errors) {
  const receipt = isObject(receiptContract) ? receiptContract : {}
  const resultOwners = new Map()

  for (const field of array(receipt.required_top_level_fields)) {
    if (typeof field === 'string' && field.startsWith('calculated_')) {
      errors.push(`TOP_LEVEL_CALCULATION_RESULT: top-level calculation result ${field} is not aggregation-neutral`)
    }
  }

  const knownResultFields = new Set(Object.values(CALCULATION_CONTRACTS).flatMap(contract => contract.resultFields))
  for (const [contractName, contract] of Object.entries(CALCULATION_CONTRACTS)) {
    const fields = array(receipt[contractName])
    if (!fields.includes('aggregation')) {
      errors.push(`CALCULATION_CONTRACT_INVALID: ${contractName} must require aggregation`)
    }
    for (const field of fields.filter(value => typeof value === 'string' && value.startsWith('calculated_'))) {
      if (!knownResultFields.has(field)) {
        errors.push(`CALCULATION_RESULT_UNMAPPED: calculation result unmapped for field ${field}`)
        continue
      }
      const owners = resultOwners.get(field) ?? []
      owners.push(contractName)
      resultOwners.set(field, owners)
    }
    for (const expectedField of contract.resultFields) {
      if (!fields.includes(expectedField)) {
        errors.push(`CALCULATION_RESULT_MISSING: calculation result ${expectedField} is missing from ${contractName}`)
      }
    }
  }

  for (const [field, owners] of resultOwners) {
    if (owners.length > 1) {
      errors.push(`CALCULATION_RESULT_DUPLICATE: calculation result ${field} is duplicated across aggregation contracts`)
    }
  }
}

function collectTargetMetricReferences(budget) {
  const references = []
  for (const collectionName of ['audited_data_access_paths', 'chart_payloads', 'web_vitals_journeys']) {
    for (const target of array(budget.targets?.[collectionName])) {
      for (const metricId of array(target?.metric_ids)) references.push({ metricId, targetId: target?.target_id ?? collectionName })
    }
  }
  references.push({
    metricId: budget.targets?.initial_application_javascript_metric_id,
    targetId: 'initial_application_javascript_routes',
  })
  for (const metricId of array(budget.targets?.camera_readiness?.metric_ids)) {
    references.push({ metricId, targetId: budget.targets?.camera_readiness?.target_id ?? 'camera_readiness' })
  }
  return references.filter(reference => typeof reference.metricId === 'string')
}

function validateDefinitionMapping(definition, mappingsById, metricId, definitionName, errors) {
  const mapping = (mappingsById.get(metricId) ?? [])[0]
  if (!isObject(definition)
    || definition.budget_metric_id !== metricId
    || !isObject(mapping)
    || definition.observed_value_field !== mapping.observed_value_field
    || definition.unit !== mapping.unit) {
    errors.push(`MEASUREMENT_DEFINITION_MAPPING: measurement definition mapping for ${definitionName} must use canonical metric ${metricId}`)
  }
}

function resolveSchemaRef(root, ref) {
  let cursor = root
  for (const token of ref.slice(2).split('/').map(value => value.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    cursor = isObject(cursor) ? cursor[token] : undefined
  }
  return cursor
}

function schemaTypeMatches(value, type) {
  if (type === 'object') return isObject(value)
  if (type === 'array') return Array.isArray(value)
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'string') return typeof value === 'string'
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'null') return value === null
  return false
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteNonnegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function validCommitSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
}

function sha256String(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function array(value) {
  return Array.isArray(value) ? value : []
}

function parseCliArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--budget' || argument === '--schema') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a path`)
      options[argument === '--budget' ? 'budgetPath' : 'schemaPath'] = value
      index += 1
    } else {
      throw new Error(`unknown argument ${argument}`)
    }
  }
  return options
}

function main() {
  let result
  try {
    result = checkPerformanceBudgetFiles(parseCliArgs(process.argv.slice(2)))
  } catch (caught) {
    result = {
      status: 'FAIL',
      contract_id: null,
      phase: null,
      performance_status: 'NOT_MEASURED',
      performance_claimed: false,
      errors: [`CLI_INVALID: ${caught instanceof Error ? caught.message : String(caught)}`],
    }
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (result.status !== 'PASS') process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === CHECKER_PATH) main()

#!/usr/bin/env node

import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ALLOWED_KINDS = new Set(['engineering', 'human', 'provider'])
const ALLOWED_STATUSES = new Set(['pending', 'in_progress', 'completed', 'frozen'])
const ALLOWED_OUTCOMES = new Set(['passed', 'not_applicable'])
const SHA256 = /^[a-f0-9]{64}$/i
const COMMIT_SHA = /^[a-f0-9]{40}$/i
const CANONICALIZATION = 'UTF-8 JSON with recursively sorted object keys and preserved array order'
const SOURCE_INVENTORY_HASH = '55adbb38a11652aeb945a1bb80a38b7405001463a9c4db20babfdea73c17ede4'
const DEVICE_CONTRACT_SOURCE_ID = 'posture-ai-device-release-contract-2026-07-21-pr08'
const DEVICE_CONTRACT_SOURCE_PATH = 'docs/qa/device-release-contract.json'
const DEVICE_VALIDATOR_SOURCE_ID = 'posture-ai-device-evidence-validator-2026-07-21-pr08'
const DEVICE_VALIDATOR_SOURCE_PATH = 'scripts/check-device-evidence.mjs'
const DEVICE_SCHEMA_SOURCE_ID = 'posture-ai-device-evidence-schema-2026-07-21-pr08'
const DEVICE_SCHEMA_SOURCE_PATH = 'docs/qa/device-evidence.schema.json'
const REQUIRED_COUNCIL_SEATS = ['Codex', 'Fable 5 medium', 'Kimi K3']
const PR08_REBOUND_TASKS = ['PR-00', 'PR-01', 'PR-02', 'PR-03', 'PR-04', 'PR-05', 'PR-06', 'PR-07']
const REQUIRED_CONFIG_COVERAGE = [
  'release_boundary',
  'release_configuration',
  'intended_beta_rehearsal_contract',
  'owner_approval_contract',
  'executed_playwright_report_contract',
  'not_applicable_completion_contracts',
  'ci_contract',
  'exclusions',
  'audit_findings[*].id',
  'audit_findings[*].severity',
  'audit_findings[*].verdict',
  'audit_findings[*].applicability',
  'audit_findings[*].engineering_task',
  'audit_findings[*].human_provider_gates',
  'audit_findings[*].dependencies',
  'audit_findings[*].release_condition',
  'criteria[*].id',
  'criteria[*].task_id',
  'criteria[*].kind',
  'criteria[*].dependencies',
  'tasks[*].id',
  'tasks[*].kind',
  'tasks[*].criterion_id',
  'tasks[*].dependencies',
  'tasks[*].applicability',
  'e2e.inventory_id',
  'e2e.project_order',
  'e2e.projects',
  'e2e.expected_total',
  'e2e.expected_files',
  'e2e.inventory_hash',
  'e2e.execution',
  'e2e.retry_policy',
  'e2e.approved_skips',
  'e2e.skip_policy',
]
const REQUIRED_E2E_COVERAGE = [
  'inventory_id',
  'source_config',
  'source_runner',
  'inventory_command',
  'project_order',
  'projects',
  'expected_total',
  'expected_files',
  'execution',
  'retry_policy',
  'axe_receipts',
  'approved_skips',
  'skip_policy',
]
const LEGACY_E2E_COVERAGE = REQUIRED_E2E_COVERAGE.filter(field => field !== 'axe_receipts')
const PR08_ATOMIC_PROJECTION_PATHS = new Set(REQUIRED_CONFIG_COVERAGE.filter(path => path.startsWith('e2e.')))

export function validateProductionReadiness({ mode, state, manifest, sourceInventory, actualSources, liveRepository, artifacts = {}, now = new Date().toISOString() } = {}) {
  const buildErrors = []
  const launchErrors = []

  if (mode !== 'build' && mode !== 'launch') {
    buildErrors.push('MODE_INVALID: mode must be build or launch')
  }
  if (!isObject(state)) buildErrors.push('STATE_INVALID: state must be a JSON object')
  if (!isObject(manifest)) buildErrors.push('MANIFEST_INVALID: manifest must be a JSON object')

  if (buildErrors.length === 0) {
    buildErrors.push(...validateManifestContract(manifest, sourceInventory))
    validateSourceRuntime(sourceInventory, actualSources, state, buildErrors)
    validateTasks(state, manifest, sourceInventory, artifacts, buildErrors)
    validateReleaseBoundary(manifest.release_boundary, state, artifacts, buildErrors)
    validateRepositoryAndCi(state, manifest, sourceInventory, liveRepository, artifacts, now, buildErrors)
  }

  const autonomousBuildComplete = buildErrors.length === 0
  if (mode === 'launch' && autonomousBuildComplete) {
    validateLaunch(state, manifest, sourceInventory, artifacts, now, launchErrors)
  }

  const errors = unique([...buildErrors, ...launchErrors])
  return {
    autonomous_build_complete: autonomousBuildComplete,
    launch_authorized: mode === 'launch' && errors.length === 0,
    errors,
  }
}

export function validateManifestContract(manifest, sourceInventory) {
  const errors = []
  if (!isObject(manifest)) return ['MANIFEST_INVALID: manifest must be a JSON object']
  validateManifest(manifest, errors)
  validateSourceInventory(manifest, sourceInventory, errors)
  return unique(errors)
}

export function computeSourceInventoryHash(sourceInventory) {
  if (!isObject(sourceInventory)) return null
  const payload = { ...sourceInventory }
  delete payload.inventory_hash
  return sha256(stable(payload))
}

export function computeManifestConfigurationHash(manifest, { allowLegacyE2eCoverage = false } = {}) {
  const contract = manifest?.configuration_hash_contract
  const coverage = contract?.covered_fields
  if (contract?.algorithm !== 'sha256' || contract?.canonicalization !== CANONICALIZATION) return null
  if (!exactMembers(coverage, REQUIRED_CONFIG_COVERAGE)) return null
  const payload = manifestConfigurationProjection(manifest, { allowLegacyE2eCoverage })
  return payload ? sha256(stable(payload)) : null
}

export function manifestConfigurationProjection(manifest, { allowLegacyE2eCoverage = false } = {}) {
  const e2eHash = computeE2eInventoryHash(manifest, { allowLegacyCoverage: allowLegacyE2eCoverage })
  if (!e2eHash || !Array.isArray(manifest?.audit_findings) || !Array.isArray(manifest?.criteria) || !Array.isArray(manifest?.tasks)) return null
  return {
    release_boundary: manifest.release_boundary,
    release_configuration: manifest.release_configuration,
    intended_beta_rehearsal_contract: manifest.intended_beta_rehearsal_contract,
    owner_approval_contract: manifest.owner_approval_contract,
    executed_playwright_report_contract: manifest.executed_playwright_report_contract,
    not_applicable_completion_contracts: manifest.not_applicable_completion_contracts,
    ci_contract: manifest.ci_contract,
    exclusions: manifest.exclusions,
    audit_findings: manifest.audit_findings.map(({ id, severity, verdict, applicability, engineering_task, human_provider_gates, dependencies, release_condition }) => ({ id, severity, verdict, applicability, engineering_task, human_provider_gates, dependencies, release_condition })),
    criteria: manifest.criteria.map(({ id, task_id, kind, dependencies }) => ({ id, task_id, kind, dependencies })),
    tasks: manifest.tasks.map(({ id, kind, criterion_id, dependencies, applicability }) => ({ id, kind, criterion_id, dependencies, applicability })),
    e2e: {
      inventory_id: manifest.e2e.inventory_id,
      project_order: manifest.e2e.project_order,
      projects: manifest.e2e.projects,
      expected_total: manifest.e2e.expected_total,
      expected_files: manifest.e2e.expected_files,
      inventory_hash: e2eHash,
      execution: manifest.e2e.execution,
      retry_policy: manifest.e2e.retry_policy,
      approved_skips: manifest.e2e.approved_skips,
      skip_policy: manifest.e2e.skip_policy,
    },
  }
}

export function buildPr08ConfigurationDeltaContract(baseManifest, currentManifest, baseCommit) {
  const oldProjection = manifestConfigurationProjection(baseManifest, { allowLegacyE2eCoverage: true })
  const newProjection = manifestConfigurationProjection(currentManifest)
  const oldConfigurationHash = computeManifestConfigurationHash(baseManifest, { allowLegacyE2eCoverage: true })
  const newConfigurationHash = computeManifestConfigurationHash(currentManifest)
  if (!oldProjection || !newProjection || !COMMIT_SHA.test(baseCommit ?? '') || !oldConfigurationHash || !newConfigurationHash) return null
  if (baseManifest.configuration_hash !== oldConfigurationHash || baseManifest.configuration_hash_contract?.expected_hash !== oldConfigurationHash) return null
  if (currentManifest.configuration_hash !== newConfigurationHash || currentManifest.configuration_hash_contract?.expected_hash !== newConfigurationHash) return null
  const changes = configurationProjectionChanges(oldProjection, newProjection)
  return {
    id: 'PR-08-CONFIGURATION-DELTA-PROJECTION-v1',
    base_commit: baseCommit,
    old_configuration_hash: oldConfigurationHash,
    new_configuration_hash: newConfigurationHash,
    old_projection_sha256: sha256(stable(oldProjection)),
    new_projection_sha256: sha256(stable(newProjection)),
    changed_covered_fields: changes.map(change => change.path),
    changes_sha256: sha256(stable(changes)),
    changes,
  }
}

function configurationProjectionChanges(oldValue, newValue, path = '') {
  if (stable(oldValue) === stable(newValue)) return []
  if (!PR08_ATOMIC_PROJECTION_PATHS.has(path) && isObject(oldValue) && isObject(newValue)) {
    return [...new Set([...Object.keys(oldValue), ...Object.keys(newValue)])]
      .sort()
      .flatMap(key => configurationProjectionChanges(oldValue[key], newValue[key], path ? `${path}.${key}` : key))
  }
  return [{ path, old_value: oldValue ?? null, new_value: newValue ?? null }]
}

function computeE2eInventoryHash(manifest, { allowLegacyCoverage = false } = {}) {
  if (!isObject(manifest?.e2e)) return null
  const { inventory_id, source_config, source_runner, inventory_command, project_order, projects, expected_total, expected_files, execution, retry_policy, axe_receipts, approved_skips, skip_policy } = manifest.e2e
  const contract = manifest.e2e.inventory_hash_contract
  const coverage = contract?.covered_fields
  const usesCurrentCoverage = exactMembers(coverage, REQUIRED_E2E_COVERAGE)
  const usesLegacyCoverage = allowLegacyCoverage && exactMembers(coverage, LEGACY_E2E_COVERAGE)
  if (contract?.algorithm !== 'sha256' || contract?.canonicalization !== CANONICALIZATION || (!usesCurrentCoverage && !usesLegacyCoverage) || !nonEmpty(inventory_id) || !nonEmpty(source_config) || !nonEmpty(source_runner) || !nonEmpty(inventory_command) || !Array.isArray(project_order) || !isObject(projects) || !Number.isInteger(expected_total) || !Number.isInteger(expected_files) || !isObject(execution) || !isObject(retry_policy) || (usesCurrentCoverage && !isObject(axe_receipts)) || !Array.isArray(approved_skips) || !isObject(skip_policy)) return null
  const payload = { inventory_id, source_config, source_runner, inventory_command, project_order, projects, expected_total, expected_files, execution, retry_policy }
  if (usesCurrentCoverage) payload.axe_receipts = axe_receipts
  payload.approved_skips = approved_skips
  payload.skip_policy = skip_policy
  return sha256(stable(payload))
}

function validateManifest(manifest, errors) {
  if (!positiveInteger(manifest.schema_version)) errors.push('MANIFEST_SCHEMA: schema_version must be a positive integer')

  const findings = requireArray(manifest.audit_findings, 'MANIFEST_FINDINGS: audit_findings must be an array', errors)
  const criteria = requireArray(manifest.criteria, 'MANIFEST_CRITERIA: criteria must be an array', errors)
  const tasks = requireArray(manifest.tasks, 'MANIFEST_TASKS: tasks must be an array', errors)
  for (const field of ['release_boundary', 'release_configuration', 'intended_beta_rehearsal_contract', 'owner_approval_contract', 'executed_playwright_report_contract', 'not_applicable_completion_contracts', 'e2e', 'proof_contract', 'ci_contract', 'configuration_hash_contract']) {
    if (!isObject(manifest[field])) errors.push(`MANIFEST_CONTRACT: ${field} must be an object`)
  }
  validateReleaseConfigurationContract(manifest, errors)
  validateE2eContract(manifest.e2e, errors)

  const taskIds = uniqueIds(tasks, 'manifest task', errors)
  const criterionIds = uniqueIds(criteria, 'criterion', errors)
  const criterionTasks = new Map()
  for (const criterion of criteria) {
    if (!isObject(criterion)) continue
    const taskId = criterion.task_id ?? criterion.task
    if (!nonEmpty(taskId) || !taskIds.has(taskId)) {
      errors.push(`CRITERION_MAPPING: ${label(criterion.id)} does not map to a declared task`)
      continue
    }
    if (criterionTasks.has(taskId)) errors.push(`CRITERION_MAPPING: task ${taskId} maps to more than one criterion`)
    criterionTasks.set(taskId, criterion.id)
    if (!ALLOWED_KINDS.has(criterion.kind)) errors.push(`CRITERION_KIND: ${label(criterion.id)} has invalid kind ${label(criterion.kind)}`)
    if (!Array.isArray(criterion.dependencies)) errors.push(`DEPENDENCIES_INVALID: criterion ${label(criterion.id)} dependencies must be an array`)
    validateRowState(criterion, `criterion ${label(criterion.id)}`, errors)
  }

  for (const task of tasks) {
    if (!isObject(task) || !nonEmpty(task.id)) continue
    const criterionId = task.criterion_id ?? task.maps_to_criterion ?? criterionTasks.get(task.id)
    if (!nonEmpty(criterionId) || !criterionIds.has(criterionId) || criterionTasks.get(task.id) !== criterionId) {
      errors.push(`CRITERION_MAPPING: task ${task.id} is missing its unique criterion mapping`)
    }
    if (!ALLOWED_KINDS.has(task.kind)) errors.push(`TASK_KIND: manifest task ${task.id} has invalid kind ${label(task.kind)}`)
    if (!Array.isArray(task.dependencies)) errors.push(`DEPENDENCIES_INVALID: manifest task ${task.id} dependencies must be an array`)
    validateApplicabilityContract(task, errors)
    const criterion = criteria.find(row => isObject(row) && row.task_id === task.id)
    if (criterion && (criterion.kind !== task.kind || !exactMembers(criterion.dependencies, task.dependencies))) {
      errors.push(`CRITERION_MAPPING: criterion ${criterion.id} does not match task ${task.id} kind/dependencies`)
    }
  }
  findDependencyErrors(tasks, errors)

  const findingIds = uniqueIds(findings, 'audit finding', errors)
  for (const finding of findings) {
    if (!isObject(finding) || !findingIds.has(finding.id)) continue
    const engineering = values(finding.engineering_task ?? finding.engineering_tasks ?? finding.task_id)
    const gates = values(finding.human_provider_gates ?? finding.human_provider_gate_ids ?? finding.gates)
    if (engineering.length === 0 || engineering.some(id => !taskIds.has(id))) {
      errors.push(`AUDIT_MAPPING: finding ${finding.id} has no valid engineering task mapping`)
    }
    if (gates.some(id => !taskIds.has(id))) errors.push(`AUDIT_MAPPING: finding ${finding.id} maps to an unknown human/provider gate`)
    const engineeringTask = tasks.find(task => isObject(task) && task.id === engineering[0])
    if (!Array.isArray(finding.dependencies) || !engineeringTask || !exactMembers(finding.dependencies, engineeringTask.dependencies)) errors.push(`AUDIT_DEPENDENCIES: finding ${finding.id} dependencies do not match engineering task ${label(engineering[0])}`)
    if (!nonEmpty(finding.severity)) errors.push(`AUDIT_SEVERITY: finding ${finding.id} has no severity`)
    const applicabilityState = isObject(finding.applicability) ? finding.applicability.state : finding.applicability
    if (!['applicable', 'not_applicable'].includes(applicabilityState)) errors.push(`AUDIT_APPLICABILITY: finding ${finding.id} has invalid applicability`)
    validateRowState(finding, `audit finding ${finding.id}`, errors)
  }

  const declaredHash = expectedConfigurationHash(manifest)
  const computedHash = computeManifestConfigurationHash(manifest)
  if (!SHA256.test(declaredHash ?? '')) errors.push('CONFIG_HASH_CONTRACT: expected_hash must be a sha256 value')
  if (!computedHash || manifest.e2e.inventory_hash !== computeE2eInventoryHash(manifest)) errors.push('E2E_HASH_RECOMPUTE: manifest E2E inventory hash is stale or malformed')
  if (!computedHash || manifest.configuration_hash !== computedHash || declaredHash !== computedHash) {
    errors.push('CONFIG_HASH_RECOMPUTE: manifest configuration hash does not match canonical covered fields')
  }
  if (!isObject(manifest.e2e?.projects) || !SHA256.test(manifest.e2e?.inventory_hash ?? '')) {
    errors.push('E2E_CONTRACT: e2e projects or inventory_hash is malformed')
  }
}

function validateSourceInventory(manifest, sourceInventory, errors) {
  if (!isObject(sourceInventory) || sourceInventory.inventory_hash !== SOURCE_INVENTORY_HASH || computeSourceInventoryHash(sourceInventory) !== SOURCE_INVENTORY_HASH) {
    errors.push('SOURCE_INVENTORY_HASH: independent source inventory is absent, stale, or malformed')
    return
  }
  const auditIds = manifest.audit_findings.map(row => row.id)
  const criterionIds = manifest.criteria.map(row => row.id)
  const tasks = manifest.tasks.map(({ id, kind, dependencies, maps_to_criterion, applicability }) => ({ id, kind, dependencies, maps_to_criterion, applicability }))
  const auditContracts = manifest.audit_findings.map(({ id, severity, verdict, applicability, engineering_task, human_provider_gates, dependencies }) => ({ id, severity, verdict, applicability, engineering_task, human_provider_gates, dependencies }))
  if (manifest.manifest_id !== sourceInventory.manifest_id || stable(manifest.source) !== stable(sourceInventory.source)) errors.push('SOURCE_IDENTITY: manifest source identity does not match the independent inventory')
  if (stable(manifest.source_contracts) !== stable(sourceInventory.source_contracts) || stable(manifest.source_identity_contract) !== stable(sourceInventory.source_identity_contract)) errors.push('SOURCE_CONTRACT: manifest source contracts do not match the independent inventory')
  if (!exactMembers(auditIds, sourceInventory.audit_row_ids)) errors.push('SOURCE_AUDIT_IDS: audit finding IDs do not match the independent re-audit inventory')
  if (!exactMembers(criterionIds, sourceInventory.criterion_ids)) errors.push('SOURCE_CRITERION_IDS: PR/HG criterion IDs do not match the independent goal inventory')
  if (stable(tasks) !== stable(sourceInventory.tasks)) errors.push('SOURCE_TASK_GRAPH: task kinds/dependencies do not match the independent goal inventory')
  if (stable(tasks.map(({ id, applicability }) => ({ id, applicability }))) !== stable(sourceInventory.tasks.map(({ id, applicability }) => ({ id, applicability })))) errors.push('SOURCE_TASK_APPLICABILITY: task applicability expressions/defaults do not match the independent inventory')
  if (stable(auditContracts) !== stable(sourceInventory.audit_contracts)) {
    errors.push('SOURCE_AUDIT_CONTRACT: audit severity, verdict, applicability, dependencies, or mappings do not match the independent re-audit inventory')
    if (stable(auditContracts.map(({ id, dependencies }) => ({ id, dependencies }))) !== stable(values(sourceInventory.audit_contracts).map(({ id, dependencies }) => ({ id, dependencies })))) errors.push('SOURCE_AUDIT_DEPENDENCIES: audit dependencies do not match the independently pinned engineering-task graph')
  }
  if (stable(manifest.ci_contract) !== stable(sourceInventory.ci_contract)) errors.push('SOURCE_CI_CONTRACT: manifest CI contract does not match the independent freshness and command contract')
  if (stable(manifest.owner_approval_contract) !== stable(sourceInventory.owner_approval_contract)) errors.push('SOURCE_OWNER_APPROVAL_CONTRACT: owner approval contract does not match the independent final-packet contract')
  if (stable(manifest.executed_playwright_report_contract) !== stable(sourceInventory.executed_playwright_report_contract)) errors.push('SOURCE_E2E_REPORT_CONTRACT: executed Playwright report contract does not match the independent source inventory')
  if (stable(manifest.not_applicable_completion_contracts) !== stable(sourceInventory.not_applicable_completion_contracts)) errors.push('SOURCE_NA_CONTRACT: sanctioned not-applicable completion contracts do not match the independent source inventory')
  const manifestCommands = [...values(manifest.ci_contract?.global_commands), ...values(manifest.ci_contract?.pr17_additional_commands)]
  if (!exactMembers(manifestCommands, sourceInventory.pr17_required_commands)) errors.push('SOURCE_PR17_COMMANDS: manifest PR-17 commands do not match the independently frozen command set')
  const rehearsal = manifest.intended_beta_rehearsal_contract
  const pinnedRehearsal = sourceInventory.hg09_rehearsal_contract
  if (!isObject(rehearsal) || rehearsal.id !== pinnedRehearsal?.id || rehearsal.environment !== pinnedRehearsal?.environment || rehearsal.freshness_hours !== pinnedRehearsal?.freshness_hours || rehearsal.test_mode !== pinnedRehearsal?.test_mode || stable(rehearsal.required_absent_test_flags) !== stable(pinnedRehearsal?.required_absent_test_flags) || rehearsal.required_journey !== pinnedRehearsal?.required_journey) errors.push('SOURCE_HG09_CONTRACT: manifest HG-09 rehearsal contract does not match the independent recipe and 24-hour freshness window')
  const inventory = sourceInventory.playwright_inventory
  if (!isObject(inventory) || manifest.e2e?.inventory_command !== inventory.command || stable(manifest.e2e?.project_order) !== stable(inventory.project_order) || stable(manifest.e2e?.projects) !== stable(inventory.projects) || manifest.e2e?.expected_total !== inventory.expected_total || manifest.e2e?.expected_files !== inventory.expected_files) errors.push('E2E_SOURCE_DRIFT: manifest E2E inventory does not match the independent Playwright inventory')
}

function validateSourceRuntime(sourceInventory, actualSources, state, errors) {
  if (!isObject(actualSources) || !Array.isArray(actualSources.files)) {
    errors.push('SOURCE_RUNTIME: actual source files were not independently loaded')
    return
  }
  const expected = [...values(sourceInventory.source_contracts), ...values(sourceInventory.runtime_source_contracts)]
  const actualIds = actualSources.files.map(row => row?.id)
  if (!exactMembers(actualIds, expected.map(row => row.id))) errors.push('SOURCE_RUNTIME: actual source IDs do not match the independent inventory')
  for (const contract of expected) {
    const actual = actualSources.files.find(row => row?.id === contract.id)
    if (!isObject(actual) || actual.path !== contract.path || actual.is_regular_file !== true || actual.is_symlink !== false || actual.within_allowed_root !== true || !nonEmpty(actual.resolved_path) || typeof actual.content !== 'string') {
      errors.push(`SOURCE_RUNTIME: source ${contract.id} is missing, redirected, or not a regular allowed file`)
      continue
    }
    const computed = hashSourceContent(actual.content, contract)
    if (computed !== contract.sha256) errors.push(`SOURCE_DRIFT: source ${contract.id} content does not match its independently pinned hash`)
  }
  const parsed = parsePlaywrightList(actualSources.playwright?.stdout)
  const pinned = sourceInventory.playwright_inventory
  if (!isObject(actualSources.playwright) || actualSources.playwright.command !== pinned?.command || actualSources.playwright.exit_code !== 0 || !parsed || stable(parsed) !== stable({ project_order: pinned.project_order, projects: pinned.projects, expected_total: pinned.expected_total, expected_files: pinned.expected_files, test_ids_sha256: pinned.test_ids_sha256 })) {
    errors.push('E2E_SOURCE_DRIFT: live Playwright --list output does not match the independent inventory')
  }
  const stateContract = values(sourceInventory.source_contracts).find(contract => contract?.json_pointer === '/criteria')
  const expectedStatePath = stateContract?.path?.startsWith('~/') ? resolve(homedir(), stateContract.path.slice(2)) : null
  const validationState = actualSources.validation_state
  if (!isObject(validationState) || validationState.requested_path !== expectedStatePath || validationState.resolved_path !== expectedStatePath || validationState.is_regular_file !== true || validationState.is_symlink !== false || typeof validationState.content !== 'string') {
    errors.push('STATE_SOURCE_IDENTITY: validator state was not loaded from the canonical goal-state file')
  } else {
    try {
      if (stable(JSON.parse(validationState.content)) !== stable(state)) errors.push('STATE_SOURCE_DRIFT: parsed validator state does not match the canonical state file content')
    } catch {
      errors.push('STATE_SOURCE_DRIFT: canonical validator state content is malformed')
    }
  }
}

function hashSourceContent(content, contract) {
  if (contract.hash_scope === 'entire_file') return sha256(content)
  if (contract.hash_scope === 'canonical-json-sorted-keys-preserved-array-order-with-trailing-newline' && contract.json_pointer === '/criteria') {
    try {
      return sha256(`${stable(JSON.parse(content).criteria)}\n`)
    } catch {
      return null
    }
  }
  return null
}

function parsePlaywrightList(stdout) {
  if (typeof stdout !== 'string') return null
  const tests = []
  const projects = {}
  const projectOrder = []
  const files = new Set()
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s+\[([^\]]+)\] › (.+?):\d+:\d+ › (.+)$/)
    if (!match) continue
    const [, project, listedFile, title] = match
    const file = listedFile.includes('/') ? listedFile : `e2e/${listedFile}`
    if (!Object.hasOwn(projects, project)) {
      projects[project] = 0
      projectOrder.push(project)
    }
    projects[project] += 1
    files.add(file)
    tests.push({ project, file, title })
  }
  if (tests.length === 0) return null
  return { project_order: projectOrder, projects, expected_total: tests.length, expected_files: files.size, test_ids_sha256: sha256(stable(tests)) }
}

function validateTasks(state, manifest, sourceInventory, artifacts, errors) {
  const tasks = requireArray(state.tasks, 'STATE_TASKS: state.tasks must be an array', errors)
  const stateIds = uniqueIds(tasks, 'state task', errors)
  const definitions = new Map((Array.isArray(manifest.tasks) ? manifest.tasks : []).filter(isObject).map(task => [task.id, task]))
  const criteriaByTask = new Map((Array.isArray(manifest.criteria) ? manifest.criteria : []).filter(isObject).map(row => [row.task_id ?? row.task, row.id]))
  const stateCriteria = new Set((Array.isArray(state.criteria) ? state.criteria : []).map(row => isObject(row) ? row.id : row))
  const proofs = proofMap(state)
  const stateTaskContracts = new Map(values(sourceInventory.state_task_contracts).filter(isObject).map(row => [row.id, row]))

  if (stateCriteria.size !== (Array.isArray(state.criteria) ? state.criteria.length : 0)) errors.push('CRITERION_MAPPING: state criteria contain missing or duplicate ids')
  const manifestCriterionIds = new Set((Array.isArray(manifest.criteria) ? manifest.criteria : []).map(row => isObject(row) ? row.id : undefined))
  if (!sameSet([...stateCriteria], [...manifestCriterionIds])) errors.push('CRITERION_MAPPING: state criteria do not match the manifest')

  for (const taskId of definitions.keys()) {
    if (!stateIds.has(taskId)) errors.push(`TASK_MISSING: state is missing declared task ${taskId}`)
  }
  for (const taskId of stateIds) {
    if (!definitions.has(taskId)) errors.push(`TASK_UNDECLARED: state task ${taskId} is absent from the manifest`)
  }

  const byId = new Map(tasks.filter(isObject).map(task => [task.id, task]))
  for (const task of tasks) {
    if (!isObject(task) || !nonEmpty(task.id)) continue
    const definition = definitions.get(task.id)
    const criterionId = criteriaByTask.get(task.id)
    if (!definition) continue

    if (!ALLOWED_KINDS.has(task.kind)) errors.push(`TASK_KIND: ${task.id} has invalid kind ${label(task.kind)}`)
    else if (task.kind !== definition.kind) errors.push(`TASK_KIND: ${task.id} has kind ${task.kind}; expected ${definition.kind}`)
    if (!ALLOWED_STATUSES.has(task.status)) errors.push(`TASK_STATUS: ${task.id} has invalid status ${label(task.status)}`)

    const outcomeIsNull = task.outcome === null || task.outcome === undefined
    if (task.status === 'completed' && !ALLOWED_OUTCOMES.has(task.outcome)) {
      errors.push(`TASK_OUTCOME: completed task ${task.id} has invalid outcome ${label(task.outcome)}`)
    } else if (task.status !== 'completed' && !outcomeIsNull) {
      errors.push(`TASK_OUTCOME: non-completed task ${task.id} must not have outcome ${label(task.outcome)}`)
    }
    if (task.outcome === 'not_applicable' && (!nonEmpty(task.applicability_reason) || task.review_verdict !== 'PASS')) {
      errors.push(`TASK_APPLICABILITY: ${task.id} not_applicable outcome lacks a reason and PASS review`)
    }
    if (!['applicable', 'not_applicable'].includes(task.applicability)) {
      errors.push(`TASK_APPLICABILITY: ${task.id} has invalid applicability ${label(task.applicability)}`)
    } else if (task.outcome === 'not_applicable' && task.applicability !== 'not_applicable' && !hasSanctionedNotApplicableContract(task, manifest, sourceInventory)) {
      errors.push(`TASK_APPLICABILITY: ${task.id} not_applicable outcome conflicts with applicability`)
    }
    const expectedApplicability = deriveTaskApplicability(task.id, manifest)
    if (task.applicability !== expectedApplicability) errors.push(`TASK_APPLICABILITY: ${task.id} does not match manifest-derived applicability ${expectedApplicability}`)
    const pinnedStateContract = stateTaskContracts.get(task.id)
    if (!nonEmpty(task.applicability_reason) || !isObject(pinnedStateContract) || task.applicability !== pinnedStateContract.applicability || task.applicability_reason !== pinnedStateContract.applicability_reason) errors.push(`TASK_APPLICABILITY_REASON: ${task.id} applicability and reason do not match the canonical durable-state contract`)
    if (task.status === 'completed' && task.review_verdict !== 'PASS') errors.push(`PROOF_REVIEW: ${task.id} state lacks a PASS review verdict`)
    if ((task.status === 'completed' || task.status === 'frozen') && !nonEmpty(task.last_decision)) errors.push(`TASK_DECISION: ${task.id} lacks a last decision`)

    if (!Number.isInteger(task.attempts) || task.attempts < 0) {
      errors.push(`TASK_ATTEMPTS: ${task.id} attempts must be a non-negative integer`)
    } else if (task.attempts > 3) {
      errors.push(`TASK_ATTEMPTS: ${task.id} attempts exceed the maximum of 3`)
    } else if (task.attempts === 3 && !validReplan(task)) {
      errors.push(`TASK_REPLAN: ${task.id} used a third attempt without a valid evidence-based replan`)
    }

    const actualDependencies = Array.isArray(task.dependencies) ? task.dependencies : []
    if (!exactMembers(actualDependencies, Array.isArray(definition.dependencies) ? definition.dependencies : [])) {
      errors.push(`DEPENDENCIES_MISMATCH: ${task.id} dependencies do not match the manifest`)
    }
    if (task.status === 'completed' || task.status === 'in_progress') {
      for (const dependency of actualDependencies) {
        const prerequisite = byId.get(dependency)
        if (!prerequisite || prerequisite.status !== 'completed' || !ALLOWED_OUTCOMES.has(prerequisite.outcome)) {
          errors.push(`DEPENDENCY_UNMET: ${task.id} has unmet dependency ${dependency}`)
        }
      }
    }

    if (!nonEmpty(criterionId) || task.maps_to_criterion !== criterionId || !stateCriteria.has(criterionId)) {
      errors.push(`CRITERION_MAPPING: ${task.id} is missing criterion mapping ${label(criterionId)}`)
    }

    if (task.kind === 'engineering' && task.status !== 'completed') {
      errors.push(task.status === 'frozen' ? `ENGINEERING_FROZEN: engineering task ${task.id} is frozen` : `ENGINEERING_OPEN: engineering task ${task.id} is ${label(task.status)}`)
    } else if (task.kind !== 'engineering' && task.status !== 'completed' && task.status !== 'frozen') {
      errors.push(`LAUNCH_GATE_STATE: ${task.kind} task ${task.id} must be completed or explicitly frozen for build`)
    }

    if (task.status === 'completed') validateProof(task, proofs[task.id], state, manifest, sourceInventory, artifacts, errors)
    if (task.status === 'frozen' && task.kind !== 'engineering') validateFrozenRecord(task, state, sourceInventory, errors)
  }

  const pr17 = byId.get('PR-17')
  if (!pr17 || pr17.status !== 'completed' || !ALLOWED_OUTCOMES.has(pr17.outcome)) {
    errors.push('PR17_INCOMPLETE: PR-17 must be persisted completed before --build')
  }
  const completedIds = tasks.filter(task => isObject(task) && task.status === 'completed').map(task => task.id)
  if (!exactMembers(completedIds, state.completed)) {
    errors.push('COMPLETED_LEDGER: state.completed does not match completed task statuses')
  }
  const frozenIds = tasks.filter(task => isObject(task) && task.status === 'frozen' && task.kind !== 'engineering').map(task => task.id)
  const frozenLedgerIds = values(state.frozen).map(row => row?.task_id)
  if (!exactMembers(frozenIds, frozenLedgerIds)) errors.push('FROZEN_LEDGER: state.frozen does not exactly match frozen human/provider task statuses')
}

function deriveTaskApplicability(taskId, manifest) {
  const definition = manifest.tasks.find(task => task.id === taskId)
  const contract = definition?.applicability
  if (!isObject(contract) || !['applicable', 'not_applicable'].includes(contract.default_state)) return 'applicable'
  return evaluateApplicabilityExpression(contract.expression, manifest.release_boundary) ? 'applicable' : contract.default_state
}

function validateApplicabilityContract(task, errors) {
  const contract = task.applicability
  if (!isObject(contract) || !['applicable', 'not_applicable'].includes(contract.default_state) || !validApplicabilityExpression(contract.expression)) {
    errors.push(`TASK_APPLICABILITY_CONTRACT: manifest task ${task.id} has a malformed applicability expression/default`)
  }
}

function validApplicabilityExpression(expression) {
  if (!isObject(expression)) return false
  if (expression.constant === true) return Object.keys(expression).length === 1
  if (Array.isArray(expression.eq) && expression.eq.length === 2) return validBoundaryVariable(expression.eq[0])
  if (Array.isArray(expression.any_true) && expression.any_true.length > 0) return expression.any_true.every(validBoundaryVariable)
  return false
}

function validBoundaryVariable(value) {
  return isObject(value) && Object.keys(value).length === 1 && nonEmpty(value.var) && value.var.startsWith('release_boundary.') && !value.var.slice('release_boundary.'.length).includes('.')
}

function evaluateApplicabilityExpression(expression, boundary) {
  if (!validApplicabilityExpression(expression) || !isObject(boundary)) return false
  if (expression.constant === true) return true
  if (Array.isArray(expression.eq)) return boundaryValue(expression.eq[0], boundary) === expression.eq[1]
  return expression.any_true.some(variable => Boolean(boundaryValue(variable, boundary)))
}

function boundaryValue(variable, boundary) {
  return boundary[variable.var.slice('release_boundary.'.length)]
}

function validateProof(task, proof, state, manifest, sourceInventory, artifacts, errors) {
  if (!nonEmpty(task.proof_manifest)) errors.push(`PROOF_PATH: ${task.id} is missing its proof manifest path`)
  if (!isObject(proof)) {
    errors.push(`PROOF_MISSING: ${task.id} has no structured proof receipt`)
    return
  }
  if (proof.task_id !== task.id) errors.push(`PROOF_TASK: ${task.id} proof task_id is absent or mismatched`)
  if (proof.manifest_path !== task.proof_manifest) errors.push(`PROOF_PATH: ${task.id} proof path does not match state`)
  validateArtifactRef({ path: task.proof_manifest, sha256: task.proof_manifest_sha256 }, artifacts, `${task.id} proof manifest`, errors)
  if (proof.manifest_sha256 !== task.proof_manifest_sha256) errors.push(`PROOF_PATH: ${task.id} proof manifest hash does not match state`)

  if (!COMMIT_SHA.test(proof.commit ?? '') || proof.commit !== task.commit) errors.push(`PROOF_COMMIT: ${task.id} proof is not bound to its exact task commit`)
  if (task.commit !== proof.commit || !exactMembers(task.changed_files, proof.changed_files) || !exactMembers(task.allowed_changed_files, proof.allowed_changed_files)) errors.push(`PROOF_STATE_BINDING: ${task.id} proof commit/change set does not match the state task ledger`)
  if (!exactMembers(proof.changed_files, proof.allowed_changed_files)) errors.push(`PROOF_CHANGED_FILES: ${task.id} changed files do not exactly match its allowlist`)
  validateArtifactRef(proof.commit_receipt, artifacts, `${task.id} commit receipt`, errors)
  validateArtifactRef(proof.changed_files_receipt, artifacts, `${task.id} changed-files receipt`, errors)
  const commitReceipt = readArtifactJson(proof.commit_receipt, artifacts)
  const changedReceipt = readArtifactJson(proof.changed_files_receipt, artifacts)
  if (!isObject(commitReceipt) || commitReceipt.task_id !== task.id || commitReceipt.commit !== proof.commit) errors.push(`PROOF_COMMIT: ${task.id} commit receipt content is not bound to the task and commit`)
  if (!isObject(changedReceipt) || changedReceipt.task_id !== task.id || changedReceipt.commit !== proof.commit || stable(changedReceipt.changed_files) !== stable(proof.changed_files) || stable(changedReceipt.allowed_changed_files) !== stable(proof.allowed_changed_files)) errors.push(`PROOF_CHANGED_FILES: ${task.id} changed-file receipt content is not bound to its exact allowlist`)

  const evidence = Array.isArray(proof.criteria_evidence) ? proof.criteria_evidence : []
  const mapped = evidence.find(row => isObject(row) && row.criterion_id === task.maps_to_criterion && values(row.evidence).length > 0)
  if (!mapped) errors.push(`PROOF_CRITERION: ${task.id} proof does not map its acceptance criterion`)
  else for (const artifact of values(mapped.evidence)) validateArtifactRef(artifact, artifacts, `${task.id} criterion evidence`, errors)

  if (!Array.isArray(proof.commands) || proof.commands.length === 0) {
    errors.push(`PROOF_COMMAND: ${task.id} proof has no command receipt`)
  } else {
    for (const command of proof.commands) {
      if (!isObject(command) || !nonEmpty(command.command) || command.exit_code !== 0 || !isObject(command.receipt)) {
        errors.push(`PROOF_COMMAND: ${task.id} proof has a malformed command/exit-code receipt`)
      } else {
        validateArtifactRef(command.receipt, artifacts, `${task.id} command receipt`, errors)
        const receipt = readArtifactJson(command.receipt, artifacts)
        if (!isObject(receipt) || receipt.task_id !== task.id || receipt.command !== command.command || receipt.exit_code !== command.exit_code || receipt.commit !== proof.commit) errors.push(`PROOF_COMMAND: ${task.id} command receipt is not artifact-bound to its task, command, exit code, and commit`)
      }
    }
  }

  const review = proof.review
  if (!isObject(review) || review.verdict !== 'PASS' || !nonEmpty(review.reviewer) || !isObject(review.receipt) || review.independent !== true) {
    errors.push(`PROOF_REVIEW: ${task.id} proof is missing an independent PASS review`)
  } else {
    validateArtifactRef(review.receipt, artifacts, `${task.id} review receipt`, errors)
    const receipt = readArtifactJson(review.receipt, artifacts)
    const reviewCoreValid = isObject(receipt) && receipt.task_id === task.id && receipt.verdict === 'PASS' && receipt.reviewer === review.reviewer && receipt.independent === true && receipt.commit === proof.commit
    const reviewConfigurationValid = reviewCoreValid && (receipt.configuration_hash === expectedConfigurationHash(manifest) || validatePr08ConfigurationDelta(task, proof, receipt, state, manifest, sourceInventory, artifacts, errors))
    if (!reviewCoreValid || !reviewConfigurationValid) errors.push(`PROOF_REVIEW_RECEIPT: ${task.id} independent-review receipt is not bound to its task, reviewer, verdict, commit, and configuration`)
  }
  const rollback = proof.rollback
  if (!isObject(rollback) || !nonEmpty(rollback.notes) || rollback.verified !== true || !isObject(rollback.receipt)) errors.push(`PROOF_ROLLBACK: ${task.id} proof is missing verified rollback notes`)
  else validateArtifactRef(rollback.receipt, artifacts, `${task.id} rollback receipt`, errors)
  if (task.id === 'PR-17') validatePr17Proof(proof, state, sourceInventory, artifacts, errors)
  if (task.outcome === 'not_applicable' && task.applicability === 'applicable') validateSanctionedNotApplicable(task, proof, state, manifest, sourceInventory, artifacts, errors)
}

function validatePr08ConfigurationDelta(task, proof, originalReviewReceipt, state, manifest, sourceInventory, artifacts, errors) {
  const delta = proof.configuration_delta_review
  if (!PR08_REBOUND_TASKS.includes(task.id) || !isObject(delta) || !isObject(delta.receipt)) {
    errors.push(`PROOF_CONFIGURATION_DELTA: ${task.id} stale review requires the independent PR-08 configuration-delta receipt`)
    return false
  }
  validateArtifactRef(delta.receipt, artifacts, `${task.id} PR-08 configuration-delta review`, errors)
  const receipt = readArtifactJson(delta.receipt, artifacts)
  const pinnedProjection = sourceInventory?.pr08_configuration_delta_contract
  validateArtifactRef(receipt?.projection_receipt, artifacts, `${task.id} PR-08 exact configuration projection`, errors)
  const projectionArtifact = readArtifactJson(receipt?.projection_receipt, artifacts)
  const summary = { ...delta }
  delete summary.receipt
  const expectedConfiguration = expectedConfigurationHash(manifest)
  const fields = values(receipt?.changed_covered_fields)
  const valid = isObject(receipt)
    && stable(summary) === stable(receipt)
    && receipt.id === 'PR-08-CONFIGURATION-DELTA-v1'
    && receipt.task_id === 'PR-08'
    && receipt.verdict === 'PASS'
    && nonEmpty(receipt.reviewer)
    && receipt.reviewer !== originalReviewReceipt.reviewer
    && receipt.independent === true
    && receipt.commit === state.commit
    && isObject(pinnedProjection)
    && stable(projectionArtifact) === stable(pinnedProjection)
    && receipt.projection_id === pinnedProjection.id
    && receipt.base_commit === pinnedProjection.base_commit
    && SHA256.test(receipt.old_configuration_hash ?? '')
    && receipt.old_configuration_hash === originalReviewReceipt.configuration_hash
    && receipt.old_configuration_hash === pinnedProjection.old_configuration_hash
    && receipt.old_configuration_hash !== expectedConfiguration
    && receipt.new_configuration_hash === expectedConfiguration
    && receipt.new_configuration_hash === pinnedProjection.new_configuration_hash
    && receipt.old_projection_sha256 === pinnedProjection.old_projection_sha256
    && receipt.new_projection_sha256 === pinnedProjection.new_projection_sha256
    && receipt.changes_sha256 === pinnedProjection.changes_sha256
    && exactMembers(receipt.affected_tasks, PR08_REBOUND_TASKS)
    && exactMembers(receipt.rebound_tasks, PR08_REBOUND_TASKS)
    && receipt.affected_tasks.includes(task.id)
    && receipt.rebound_tasks.includes(task.id)
    && exactMembers(fields, pinnedProjection.changed_covered_fields)
    && receipt.prior_acceptance_semantics_unchanged === true
    && receipt.hg04_stays_frozen === true
  if (!valid) errors.push(`PROOF_CONFIGURATION_DELTA: ${task.id} configuration-delta review is malformed, stale, copied forward, or not bound to the exact base-versus-current covered projection`)
  return valid
}

function hasSanctionedNotApplicableContract(task, manifest, sourceInventory) {
  const manifestContract = manifest.not_applicable_completion_contracts?.[task.id]
  const pinnedContract = sourceInventory.not_applicable_completion_contracts?.[task.id]
  return isObject(manifestContract) && stable(manifestContract) === stable(pinnedContract) && manifestContract.task_id === task.id && manifestContract.task_applicability_must_remain === 'applicable' && manifestContract.allowed_completed_outcome === 'not_applicable'
}

function validateSanctionedNotApplicable(task, proof, state, manifest, sourceInventory, artifacts, errors) {
  const contract = sourceInventory.not_applicable_completion_contracts?.[task.id]
  const evidence = proof.not_applicable
  const hg05 = values(state.tasks).find(row => row?.id === 'HG-05')
  const required = values(contract?.required_proof_fields)
  const allowedHg05State = hg05?.status === 'frozen' || (hg05?.status === 'completed' && hg05?.outcome === 'passed')
  const expectedConfiguration = expectedConfigurationHash(manifest)
  if (!hasSanctionedNotApplicableContract(task, manifest, sourceInventory) || task.id !== 'PR-11' || task.status !== contract?.required_task_state?.status || task.outcome !== contract?.required_task_state?.outcome || task.review_verdict !== contract?.required_task_state?.review_verdict || !isObject(evidence) || required.some(field => !Object.hasOwn(evidence, field)) || evidence.contract_id !== contract.id || evidence.reason_category !== 'no-eligible-hg05-reliability-profile' || evidence.eligible_hg05_profile_count !== 0 || !allowedHg05State || !Array.isArray(evidence.exclusion_evidence) || evidence.exclusion_evidence.length === 0) {
    errors.push('TASK_NA_PROOF: PR-11 not_applicable requires the exact no-eligible-HG-05-profile exclusion contract')
    return
  }
  validateArtifactRef(evidence.profile_inventory_receipt, artifacts, 'PR-11 no-eligible-profile inventory', errors)
  validateArtifactRef(evidence.hg05_state_receipt, artifacts, 'PR-11 HG-05 state', errors)
  validateArtifactRef(evidence.consumer_fail_closed_receipt, artifacts, 'PR-11 fail-closed consumer state', errors)
  for (const reference of evidence.exclusion_evidence) validateArtifactRef(reference, artifacts, 'PR-11 verified exclusion evidence', errors)
  const review = evidence.independent_review
  if (!isObject(review) || review.verdict !== contract.independent_review_required_values?.verdict || review.independent !== contract.independent_review_required_values?.independent || !nonEmpty(review.reviewer) || !isObject(review.receipt)) {
    errors.push('TASK_NA_PROOF: PR-11 exclusion lacks an independent PASS review')
    return
  }
  validateArtifactRef(review.receipt, artifacts, 'PR-11 not-applicable independent review', errors)

  const profileInventory = readArtifactJson(evidence.profile_inventory_receipt, artifacts)
  const hg05State = readArtifactJson(evidence.hg05_state_receipt, artifacts)
  const consumer = readArtifactJson(evidence.consumer_fail_closed_receipt, artifacts)
  const reviewReceipt = readArtifactJson(review.receipt, artifacts)
  const commonBound = receipt => isObject(receipt) && receipt.commit === proof.commit && receipt.configuration_hash === expectedConfiguration
  const profileValid = commonBound(profileInventory) && profileInventory.task_id === 'PR-11' && profileInventory.eligible_hg05_profile_count === 0 && profileInventory.verified === true
  const hg05Valid = commonBound(hg05State) && hg05State.task_id === 'HG-05' && hg05State.status === hg05.status && hg05State.outcome === hg05.outcome && hg05State.verified === true
  const consumerValid = commonBound(consumer) && consumer.consumer_eligible_profile_active === contract.consumer_fail_closed_required_values?.consumer_eligible_profile_active && values(contract.consumer_fail_closed_required_values?.allowed_modes).includes(consumer.mode) && consumer.verified === true
  const reviewValid = commonBound(reviewReceipt) && reviewReceipt.task_id === 'PR-11' && reviewReceipt.contract_id === contract.id && reviewReceipt.verdict === review.verdict && reviewReceipt.reviewer === review.reviewer && reviewReceipt.independent === true
  const exclusionsValid = evidence.exclusion_evidence.every(reference => {
    const receipt = readArtifactJson(reference, artifacts)
    return commonBound(receipt) && receipt.contract_id === contract.id && receipt.reason_category === evidence.reason_category && receipt.verified === true
  })
  if (!profileValid || !hg05Valid || !consumerValid || !reviewValid || !exclusionsValid) errors.push('TASK_NA_PROOF: PR-11 exclusion artifacts do not prove zero eligible profiles, an allowed HG-05 state, an independently reviewed reason, and fail-closed consumer state')
}

function validatePr17Proof(proof, state, sourceInventory, artifacts, errors) {
  const expectedCommands = sourceInventory.pr17_required_commands
  const actualCommands = Array.isArray(proof.commands) ? proof.commands.map(row => row.command) : []
  if (!exactMembers(actualCommands, expectedCommands)) errors.push('PR17_COMMANDS: PR-17 proof does not contain the exact frozen global command set')
  if (proof.commit !== state.commit || proof.commit !== state.release_evidence?.repository?.head_sha || !COMMIT_SHA.test(proof.commit ?? '')) errors.push('PR17_COMMIT: PR-17 proof commit does not match state and release HEAD')
  const changedFiles = state.release_evidence?.repository?.changed_files
  if (!exactMembers(proof.changed_files, changedFiles)) errors.push('PR17_CHANGED_FILES: PR-17 changed-file receipt does not match repository evidence')
}

function validateFrozenRecord(task, state, sourceInventory, errors) {
  const row = (Array.isArray(state.frozen) ? state.frozen : []).find(value => isObject(value) && value.task_id === task.id)
  const expected = values(sourceInventory.frozen_gate_contracts).find(value => value?.task_id === task.id)
  if (!isObject(row) || !isObject(expected) || row.owner !== expected.owner || !exactMembers(values(row.dependencies), expected.dependencies) || row.acceptance_criteria !== expected.acceptance_criteria) {
    errors.push(`FROZEN_CONTRACT: ${task.id} does not match its independently frozen owner, dependency list, and exact acceptance criteria`)
  }
}

function validateReleaseBoundary(boundary, state, artifacts, errors) {
  if (!isObject(boundary)) return
  if (boundary.milestone !== 'invite-only U.S. practitioner beta' || boundary.platform !== 'responsive-web' || stable(boundary.jurisdictions) !== stable(['US']) || boundary.practitioner_access !== 'invitation-only' || boundary.client_population !== 'consented-adults') errors.push('BOUNDARY_SCOPE: release scope does not match the selected invite-only U.S. responsive-web beta')
  if (boundary.fitness_wellness_only !== true) errors.push('BOUNDARY_FITNESS: release boundary must remain fitness/wellness only')
  if (boundary.public_signup_enabled !== false) errors.push('BOUNDARY_PUBLIC_SIGNUP: release boundary must remain invite-only')
  if (boundary.billing_enabled !== false) errors.push('BOUNDARY_BILLING: billing must remain disabled')
  if (boundary.native_release_enabled !== false) errors.push('BOUNDARY_NATIVE: native release must remain excluded')
  if (boundary.covered_entities_allowed !== false || boundary.hipaa_mode !== false) errors.push('BOUNDARY_HIPAA: release boundary must remain non-HIPAA')
  if ([boundary.diagnosis_enabled, boundary.treatment_claims_enabled, boundary.population_norm_claims_enabled, boundary.clinical_validity_claims_enabled].some(value => value !== false)) errors.push('BOUNDARY_CLAIMS: diagnostic, treatment, population, and clinical-validity claims must remain disabled')
  if (boundary.pose_model_default !== 'lite') errors.push('BOUNDARY_POSE_MODEL: lite must remain the scoring default')
  if (boundary.follow_up_comparisons_enabled !== true || boundary.production_promotion !== 'manual-owner-approval-after-HG-09' || !nonEmpty(boundary.scope_change_rule)) errors.push('BOUNDARY_RELEASE: follow-up and manual promotion controls do not match the frozen boundary')
  if ('clinician_approval_present' in boundary) errors.push('BOUNDARY_CLINICAL_APPROVAL_FIELD: only clinical_approval_present is accepted')
  if (boundary.clinical_content_activation_gate !== 'HG-03' || boundary.clinical_content_default !== 'server-disabled-until-HG-03-passes') errors.push('BOUNDARY_CLINICAL_GATE: clinical content is not bound to completed HG-03 approval')

  const clinicalFields = ['recommendations_enabled', 'programs_enabled', 'workouts_enabled', 'knowledge_links_enabled']
  const clinicalEnabled = clinicalFields.some(field => boundary[field] === true) || boundary.assessment_only === false
  const approved = boundary.clinical_approval_present === true
  if (boundary.clinical_approval_present !== false || clinicalEnabled || boundary.assessment_only !== true || clinicalFields.some(field => boundary[field] !== false)) {
    errors.push('BOUNDARY_CLINICAL: this release must remain assessment-only with clinical approval absent and all clinical content disabled')
  }
  if (approved || clinicalEnabled) {
    const hg03 = state.tasks?.find(task => task.id === 'HG-03')
    const proof = state.proofs?.['HG-03']
    if (!hg03 || hg03.status !== 'completed' || hg03.outcome !== 'passed' || !isObject(proof?.receipt) || !validateArtifactRef(proof.receipt, artifacts, 'HG-03 clinical approval receipt', errors)) {
      errors.push('BOUNDARY_HG03: clinical content requires a completed, verified HG-03 approval receipt')
    }
  }
}

function validateReleaseConfigurationContract(manifest, errors) {
  const config = manifest.release_configuration
  const boundary = manifest.release_boundary
  if (!isObject(config) || !isObject(boundary)) return
  if (!nonEmpty(config.configuration_id) || config.environment !== 'intended-beta' || config.boundary_reference !== 'release_boundary' || config.pose_model !== boundary.pose_model_default || config.clinical_content_gate !== boundary.clinical_content_activation_gate) {
    errors.push('RELEASE_CONFIGURATION: release configuration is not bound to the frozen intended-beta boundary')
  }
  const names = ['POSTURE_TEST_MODE_ENABLED', 'NEXT_PUBLIC_POSTURE_TEST_MODE', 'NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT']
  const requiredAssertions = {
    POSTURE_TEST_MODE_ENABLED: 'absent',
    NEXT_PUBLIC_POSTURE_TEST_MODE: 'absent',
    NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT: 'absent-or-false',
  }
  if (!exactMembers(config.test_only_flag_names, names) || !Array.isArray(config.test_only_flags_allowed_at_launch) || config.test_only_flags_allowed_at_launch.length !== 0 || stable(config.required_environment_assertions) !== stable(requiredAssertions)) {
    errors.push('RELEASE_CONFIGURATION_FLAGS: launch test-only flag contract is malformed')
  }
  const surfaces = config.clinical_surface_assertions
  if (!isObject(surfaces) || surfaces.activation_requires !== 'HG-03.PASS' || ['recommendations_enabled', 'programs_enabled', 'workouts_enabled', 'knowledge_links_enabled'].some(field => surfaces[field] !== boundary[field])) {
    errors.push('RELEASE_CONFIGURATION_CLINICAL: configuration clinical surfaces do not match the assessment-only boundary')
  }
}

function validateE2eContract(e2e, errors) {
  if (!isObject(e2e)) return
  const projectKeys = isObject(e2e.projects) ? Object.keys(e2e.projects) : []
  if (!exactMembers(e2e.project_order, projectKeys) || !projectKeys.every(key => Number.isInteger(e2e.projects[key]) && e2e.projects[key] >= 0) || projectKeys.reduce((total, key) => total + e2e.projects[key], 0) !== e2e.expected_total || !Number.isInteger(e2e.expected_files) || e2e.expected_files < 1) {
    errors.push('E2E_CONTRACT: E2E project order, counts, total, or file inventory is malformed')
  }
  const skipKeys = new Set()
  const skipTestIds = new Set()
  for (const skip of values(e2e.approved_skips)) {
    const testIds = values(skip?.test_ids)
    const expectedFile = String(skip?.key ?? '').startsWith('ignore:') ? skip?.scope?.spec : String(skip?.source ?? '').split('::')[0]
    const testIdPrefix = `${skip?.scope?.project}::${expectedFile}::`
    const validTestIds = testIds.length > 0 && nonEmpty(expectedFile) && testIds.every(testId => nonEmpty(testId) && testId.startsWith(testIdPrefix) && testId.length > testIdPrefix.length && !skipTestIds.has(testId)) && new Set(testIds).size === testIds.length
    if (!isObject(skip) || !nonEmpty(skip.key) || skipKeys.has(skip.key) || !nonEmpty(skip.source) || !isObject(skip.scope) || !nonEmpty(skip.owner) || !nonEmpty(skip.expires_on) || !validTestIds) {
      errors.push('E2E_SKIP_CONTRACT: approved skip entries require unique key, source, scope, exact test IDs, owner, and expiry')
    }
    if (isObject(skip) && nonEmpty(skip.key)) skipKeys.add(skip.key)
    for (const testId of testIds) skipTestIds.add(testId)
  }
  if (e2e.skip_policy?.unapproved_skip_or_fixme_allowed !== false) errors.push('E2E_SKIP_CONTRACT: unapproved skip/fixme policy must fail closed')
  if (!manifestAxeTargets(e2e)) errors.push('E2E_AXE_CONTRACT: Axe receipt targets must be canonical, unique, and total exactly 73')
}

function manifestAxeTargets(e2e) {
  const contract = e2e?.axe_receipts
  if (!isObject(contract) || contract.schema_version !== 'posture-ai-axe-targets-v1' || contract.expected_total !== 73 || !Array.isArray(contract.projects) || !Array.isArray(contract.scans) || !Array.isArray(contract.targets)) return null
  if (contract.projects.length === 0 || new Set(contract.projects).size !== contract.projects.length || contract.projects.some(project => !nonEmpty(project) || !Object.hasOwn(e2e.projects ?? {}, project))) return null
  const targets = []
  for (const project of contract.projects) {
    for (const scan of contract.scans) {
      if (!isObject(scan) || !nonEmpty(scan.surface) || !nonEmpty(scan.path) || !isObject(scan.originating_test) || !nonEmpty(scan.originating_test.file) || !nonEmpty(scan.originating_test.title)) return null
      targets.push({
        project,
        surface: scan.surface,
        path: scan.path,
        originating_test: { project, file: scan.originating_test.file, title: scan.originating_test.title },
      })
    }
  }
  for (const target of contract.targets) {
    if (!isObject(target) || !nonEmpty(target.project) || !Object.hasOwn(e2e.projects ?? {}, target.project) || !nonEmpty(target.surface) || !nonEmpty(target.path) || !isObject(target.originating_test) || target.originating_test.project !== target.project || !nonEmpty(target.originating_test.file) || !nonEmpty(target.originating_test.title)) return null
    targets.push({
      project: target.project,
      surface: target.surface,
      path: target.path,
      originating_test: {
        project: target.originating_test.project,
        file: target.originating_test.file,
        title: target.originating_test.title,
      },
    })
  }
  const ordered = targets.sort((left, right) => stable(left).localeCompare(stable(right)))
  if (ordered.length !== contract.expected_total || new Set(ordered.map(stable)).size !== ordered.length) return null
  return ordered
}

function validateRepositoryAndCi(state, manifest, sourceInventory, liveRepository, artifacts, now, errors) {
  const evidence = releaseEvidence(state)
  if (!evidence) {
    errors.push('RELEASE_EVIDENCE: structured repository and CI evidence is missing')
    return
  }
  const repository = evidence.repository
  if (!isObject(repository)) {
    errors.push('REPOSITORY_EVIDENCE: repository evidence is missing')
  } else {
    if (!COMMIT_SHA.test(state.commit ?? '') || !COMMIT_SHA.test(repository.head_sha ?? '') || !COMMIT_SHA.test(repository.expected_sha ?? '') || repository.head_sha !== repository.expected_sha || state.commit !== repository.head_sha) {
      errors.push('COMMIT_MISMATCH: release commit is absent, stale, or mismatched')
    }
    if (repository.worktree_clean !== true) errors.push('DIRTY_WORKTREE: release evidence reports a dirty worktree')
    const changed = values(repository.changed_files)
    const allowed = values(repository.allowed_changed_files)
    if (!exactMembers(changed, allowed) || changed.length !== 0) errors.push('UNEXPECTED_DIFF: changed files must exactly equal the empty PR-17 allowlist')
    if (repository.diff_check_exit_code !== 0) errors.push('DIFF_CHECK: git diff --check did not pass')
    validateArtifactRef(repository.porcelain_receipt, artifacts, 'PR-17 live porcelain receipt', errors)
    validateArtifactRef(repository.diff_receipt, artifacts, 'PR-17 diff receipt', errors)
    const porcelainReceipt = readArtifactJson(repository.porcelain_receipt, artifacts)
    const diffReceipt = readArtifactJson(repository.diff_receipt, artifacts)
    if (!isObject(porcelainReceipt) || porcelainReceipt.command !== 'git status --porcelain=v1 --untracked-files=all' || porcelainReceipt.head_sha !== repository.head_sha || porcelainReceipt.output !== '' || !exactMembers(porcelainReceipt.changed_files, repository.changed_files)) errors.push('REPOSITORY_RECEIPT: porcelain artifact is not bound to the clean release HEAD')
    if (!isObject(diffReceipt) || diffReceipt.command !== 'git diff --check' || diffReceipt.head_sha !== repository.head_sha || diffReceipt.exit_code !== repository.diff_check_exit_code) errors.push('REPOSITORY_RECEIPT: diff artifact is not bound to the release HEAD and exit code')
  }
  validateLiveRepository(liveRepository, repository, state, sourceInventory, errors)
  validateCi(evidence.ci, repository, sourceInventory.ci_contract, artifacts, now, errors)
}

function validateLiveRepository(live, repository, state, sourceInventory, errors) {
  if (!isObject(live)) {
    errors.push('LIVE_REPOSITORY: independently collected git state is absent')
    return
  }
  const identity = sourceInventory.repository_identity
  if (live.remote_url !== identity?.remote_url || live.audited_commit !== identity?.audited_commit || live.audited_commit_exists !== true) errors.push('LIVE_REPOSITORY_IDENTITY: git remote or audited commit does not match the independent repository identity')
  if (live.head_commit_exists !== true || live.head_sha !== state.commit || live.head_sha !== repository?.head_sha) errors.push('LIVE_COMMIT: release commit does not exist at the live repository HEAD')
  if (live.worktree_clean !== true || live.porcelain !== '' || !exactMembers(live.changed_files, repository?.changed_files)) errors.push('LIVE_WORKTREE: live porcelain state does not match the clean repository receipt')
  if (live.diff_check_exit_code !== 0 || live.diff_check_exit_code !== repository?.diff_check_exit_code) errors.push('LIVE_DIFF: live git diff --check result does not match repository evidence')
  const completed = values(state.tasks).filter(task => task?.status === 'completed')
  const taskCommits = values(live.task_commits)
  if (!exactMembers(taskCommits.map(row => row?.task_id), completed.map(task => task?.id))) errors.push('LIVE_TASK_COMMIT: live commit inventory does not exactly match completed tasks')
  for (const task of completed) {
    const row = taskCommits.find(value => value?.task_id === task.id)
    if (!isObject(row) || !COMMIT_SHA.test(task.commit ?? '') || row.commit !== task.commit || row.exists !== true || row.reachable_from_head !== true) errors.push(`LIVE_TASK_COMMIT: ${task.id} task commit is nonexistent, mismatched, or unreachable from the release HEAD`)
  }
}

function validateCi(ci, repository, contract, artifacts, now, errors) {
  if (!isObject(ci)) {
    errors.push('CI_MISSING: CI receipt is missing')
    return
  }
  const success = isObject(contract) && nonEmpty(contract.success_status) ? contract.success_status : 'success'
  if (!nonEmpty(ci.run_id) || !nonEmpty(ci.url) || ci.status !== success) errors.push('CI_INVALID: CI receipt is incomplete or unsuccessful')
  if (!isObject(repository) || ci.commit !== repository.head_sha) errors.push('CI_COMMIT_MISMATCH: CI commit does not match release HEAD')
  validateArtifactRef(ci.receipt, artifacts, 'PR-17 CI receipt', errors)
  const receipt = readArtifactJson(ci.receipt, artifacts)
  if (!isObject(receipt) || receipt.run_id !== ci.run_id || receipt.url !== ci.url || receipt.commit !== ci.commit || receipt.status !== ci.status || receipt.completed_at !== ci.completed_at) errors.push('CI_RECEIPT: CI artifact content does not match the release CI evidence')
  const maxAge = isObject(contract) && Number.isFinite(contract.max_age_hours ?? contract.maximum_ci_age_hours) ? (contract.max_age_hours ?? contract.maximum_ci_age_hours) : 24
  if (!fresh(ci.completed_at, now, maxAge)) errors.push('CI_STALE: CI receipt is stale or has an invalid timestamp')
}

function validateLaunch(state, manifest, sourceInventory, artifacts, now, errors) {
  const findings = Array.isArray(manifest.audit_findings) ? manifest.audit_findings : []
  for (const finding of findings) {
    if (!isObject(finding) || !criticalSeverity(finding.severity)) continue
    if (applicable(finding.applicability) && finding.status !== 'completed') {
      errors.push(`S1S2_OPEN: applicable ${finding.severity} finding ${label(finding.id)} is ${label(finding.status)}`)
    }
    if (applicable(finding.applicability) && finding.outcome !== 'passed') errors.push(`S1S2_OUTCOME: applicable ${finding.severity} finding ${label(finding.id)} must have passed outcome`)
    if (!applicable(finding.applicability)) validateNotApplicableFinding(finding, state, artifacts, errors)
  }

  const proofs = proofMap(state)
  for (const task of Array.isArray(state.tasks) ? state.tasks : []) {
    if (!isObject(task) || task.kind === 'engineering') continue
    if (task.status !== 'completed' || !ALLOWED_OUTCOMES.has(task.outcome)) {
      errors.push(`HG_OPEN: ${task.id} is not completed for launch`)
      continue
    }
    const receipt = proofs[task.id]?.receipt
    if (!isObject(receipt) || receipt.verified !== true || !validateArtifactRef(receipt, artifacts, `${task.id} human/provider receipt`, errors)) {
      errors.push(`HG_RECEIPT: ${task.id} proof is missing its verified human/provider receipt`)
    } else {
      const receiptContent = readArtifactJson(receipt, artifacts)
      if (!isObject(receiptContent) || receiptContent.task_id !== task.id || receiptContent.verified !== true || receiptContent.commit !== state.commit) errors.push(`HG_RECEIPT: ${task.id} receipt content is not verified and bound to the release commit`)
    }
    if (task.id === 'HG-04') validateHg04DeviceEvidence(state, manifest, sourceInventory, artifacts, now, errors)
  }

  const evidence = releaseEvidence(state)
  if (!evidence) return
  validateConfiguration(evidence, manifest, artifacts, errors)
  validateCouncil(evidence.council, evidence, manifest, artifacts, errors)
  validateFlakes(evidence, manifest, sourceInventory, artifacts, now, errors)
  validateRehearsal(evidence.rehearsal, evidence, manifest, sourceInventory, artifacts, now, errors)
  validateOwnerApproval(evidence.owner_approval, evidence, manifest, artifacts, now, errors)
}

function validateHg04DeviceEvidence(state, manifest, sourceInventory, artifacts, now, errors) {
  const proof = proofMap(state)['HG-04']
  const deviceEvidence = proof?.device_evidence
  if (!isObject(deviceEvidence)) {
    errors.push('HG04_DEVICE_EVIDENCE: HG-04 requires specialized device validation, independent sampling, and a human transition')
    return
  }
  for (const [field, description] of [
    ['validator_receipt', 'device validator'],
    ['independent_review_receipt', 'independent sampling review'],
    ['human_transition_receipt', 'explicit human transition'],
  ]) validateArtifactRef(deviceEvidence[field], artifacts, `HG-04 ${description}`, errors)

  const validation = readArtifactJson(deviceEvidence.validator_receipt, artifacts)
  const reviewPacket = readArtifactJson(deviceEvidence.independent_review_receipt, artifacts)
  const transition = readArtifactJson(deviceEvidence.human_transition_receipt, artifacts)
  const configuration = releaseEvidence(state)?.configuration
  const configurationReceipt = readArtifactJson(configuration?.receipt, artifacts)
  const expectedConfiguration = expectedConfigurationHash(manifest)
  const canonicalSources = canonicalDeviceSourceHashes(sourceInventory)
  if (!canonicalSources) errors.push('HG04_DEVICE_EVIDENCE: device contract, validator, and schema are not independently pinned as entire-file runtime sources')
  if (!isObject(validation)
    || validation.task_id !== 'HG-04'
    || validation.status !== 'PASS'
    || validation.commit !== state.commit
    || validation.configuration_hash !== expectedConfiguration
    || validation.packet_structurally_valid !== true
    || validation.physical_packet_valid !== true
    || validation.hg04_launch_eligible !== false
    || validation.validator_is_necessary_not_sufficient !== true
    || !Array.isArray(validation.reason_codes)
    || validation.reason_codes.length !== 0
    || validation.mode !== 'physical'
    || validation.fixture !== false
    || validation.test_mode !== false
    || !SHA256.test(validation.contract_sha256 ?? '')
    || validation.contract_sha256 !== canonicalSources?.contract_sha256
    || validation.validator_sha256 !== canonicalSources?.validator_sha256
    || validation.schema_sha256 !== canonicalSources?.schema_sha256
    || !SHA256.test(validation.packet_sha256 ?? '')
    || !SHA256.test(validation.evidence_root_manifest_sha256 ?? '')
    || !nonEmpty(validation.operator_id)
    || !nonEmpty(validation.collection_completed_at)
    || !Number.isFinite(Date.parse(validation.collection_completed_at))
    || !validDeterministicSamples(validation.deterministic_samples)) {
    errors.push('HG04_DEVICE_EVIDENCE: validator receipt is not a physical, release-bound, necessary-not-sufficient HG-04 result')
  }

  const review = reviewPacket?.receipt
  const signature = reviewPacket?.signature
  const approved = configuration?.hg04_approved_reviewer_public_key_fingerprints
  if (!Array.isArray(approved) || approved.length === 0 || approved.some(hash => !SHA256.test(hash)) || !exactMembers(approved, configurationReceipt?.hg04_approved_reviewer_public_key_fingerprints)) {
    errors.push('HG04_DEVICE_EVIDENCE: approved reviewer keys are not bound to the release-configuration receipt')
  }
  if (!exactMembers(validation?.approved_reviewer_public_key_fingerprints, approved)) errors.push('HG04_DEVICE_EVIDENCE: validator reviewer-key authority is not release-configuration-bound')
  if (!isObject(review)
    || review.task_id !== 'HG-04'
    || review.verdict !== 'PASS'
    || review.commit !== validation?.commit
    || review.configuration_hash !== validation?.configuration_hash
    || review.contract_sha256 !== validation?.contract_sha256
    || review.packet_sha256 !== validation?.packet_sha256
    || review.evidence_root_manifest_sha256 !== validation?.evidence_root_manifest_sha256
    || review.operator_id !== validation?.operator_id
    || !nonEmpty(review.review_id)
    || !nonEmpty(review.reviewer_id)
    || review.reviewer_id === validation?.operator_id
    || !nonEmpty(review.reviewed_at)
    || !Number.isFinite(Date.parse(review.reviewed_at))
    || Date.parse(review.reviewed_at) > Date.parse(now)
    || Date.parse(review.reviewed_at) <= Date.parse(validation?.collection_completed_at)
    || !isObject(review.coverage)
    || review.coverage.all_four_core_recordings !== true
    || review.coverage.both_device_identity_artifacts !== true
    || review.coverage.every_exclusion !== true
    || review.coverage.deterministic_remaining_rows !== true
    || !Array.isArray(review.sampled_artifact_sha256)
    || review.sampled_artifact_sha256.length === 0
    || new Set(review.sampled_artifact_sha256).size !== review.sampled_artifact_sha256.length
    || review.sampled_artifact_sha256.some(hash => !SHA256.test(hash))
    || !exactMembers(review.sampled_artifact_sha256, validation?.deterministic_samples?.hashes)
    || !exactMembers(review.sampled_core_run_ids, validation?.deterministic_samples?.fields?.sampled_core_run_ids)
    || !exactMembers(review.sampled_device_classes, validation?.deterministic_samples?.fields?.sampled_device_classes)
    || !exactMembers(review.sampled_exclusion_keys, validation?.deterministic_samples?.fields?.sampled_exclusion_keys)
    || !exactMembers(review.sampled_remaining_row_keys, validation?.deterministic_samples?.fields?.sampled_remaining_row_keys)) {
    errors.push('HG04_DEVICE_EVIDENCE: independent review is missing required sampling, independence, or release bindings')
  }
  if (!validHg04Signature(review, signature, approved)) errors.push('HG04_DEVICE_EVIDENCE: independent review lacks an approved Ed25519 detached signature')
  if (!isObject(transition)
    || transition.task_id !== 'HG-04'
    || transition.human_owned !== true
    || transition.from_status !== 'frozen'
    || transition.to_status !== 'completed'
    || transition.verified !== true
    || transition.commit !== state.commit
    || transition.configuration_hash !== expectedConfiguration
    || !nonEmpty(transition.transitioned_by)
    || !nonEmpty(transition.transitioned_at)
    || !Number.isFinite(Date.parse(transition.transitioned_at))
    || Date.parse(transition.transitioned_at) <= Date.parse(review?.reviewed_at)
    || Date.parse(transition.transitioned_at) > Date.parse(now)) {
    errors.push('HG04_DEVICE_EVIDENCE: explicit human-owned HG-04 completion transition is absent or stale')
  }
}

function canonicalDeviceSourceHashes(sourceInventory) {
  const definitions = [
    ['contract_sha256', DEVICE_CONTRACT_SOURCE_PATH, DEVICE_CONTRACT_SOURCE_ID],
    ['validator_sha256', DEVICE_VALIDATOR_SOURCE_PATH, DEVICE_VALIDATOR_SOURCE_ID],
    ['schema_sha256', DEVICE_SCHEMA_SOURCE_PATH, DEVICE_SCHEMA_SOURCE_ID],
  ]
  const result = {}
  for (const [field, path, id] of definitions) {
    const matches = values(sourceInventory?.runtime_source_contracts).filter(contract => contract?.path === path)
    const contract = matches[0]
    if (matches.length !== 1 || contract.id !== id || contract.hash_algorithm !== 'sha256' || contract.hash_scope !== 'entire_file' || !SHA256.test(contract.sha256 ?? '')) return null
    result[field] = contract.sha256
  }
  return result
}

function validDeterministicSamples(samples) {
  if (!isObject(samples) || !exactMembers(Object.keys(samples), ['hashes', 'fields']) || !Array.isArray(samples.hashes) || samples.hashes.length === 0 || samples.hashes.some(hash => !SHA256.test(hash))) return false
  const fields = samples.fields
  const required = ['sampled_core_run_ids', 'sampled_device_classes', 'sampled_exclusion_keys', 'sampled_remaining_row_keys']
  return isObject(fields) && exactMembers(Object.keys(fields), required) && required.every(field => Array.isArray(fields[field]) && fields[field].length > 0 && new Set(fields[field]).size === fields[field].length)
}

function validHg04Signature(review, signature, approvedFingerprints) {
  if (!isObject(review) || !isObject(signature) || signature.algorithm !== 'Ed25519' || signature.key_class !== 'production' || !values(approvedFingerprints).includes(signature.public_key_fingerprint)) return false
  try {
    const key = createPublicKey(signature.public_key_pem)
    const fingerprint = sha256(key.export({ type: 'spki', format: 'der' }))
    return fingerprint === signature.public_key_fingerprint
      && verifySignature(null, Buffer.from(stable(review)), key, Buffer.from(signature.value_base64 ?? '', 'base64'))
  } catch {
    return false
  }
}

function validateNotApplicableFinding(finding, state, artifacts, errors) {
  if (finding.status !== 'completed' || finding.outcome !== 'not_applicable' || !nonEmpty(finding.applicability?.reason)) {
    errors.push(`S1S2_NA_PROOF: not-applicable finding ${finding.id} does not reconcile boundary reason, state, and outcome`)
    return
  }
  const evidence = values(finding.proof)
  if (evidence.length === 0) errors.push(`S1S2_NA_PROOF: not-applicable finding ${finding.id} has no exclusion proof`)
  for (const artifact of evidence) validateArtifactRef(artifact, artifacts, `${finding.id} exclusion proof`, errors)
  const task = state.tasks.find(row => row.id === finding.engineering_task)
  const review = state.proofs?.[finding.engineering_task]?.review
  if (!task || task.review_verdict !== 'PASS' || review?.verdict !== 'PASS' || review?.independent !== true) errors.push(`S1S2_NA_PROOF: not-applicable finding ${finding.id} lacks independent reviewer/state agreement`)
}

function validateConfiguration(evidence, manifest, artifacts, errors) {
  const configuration = evidence.configuration
  const expected = expectedConfigurationHash(manifest)
  if (!SHA256.test(expected ?? '')) errors.push('CONFIG_HASH_CONTRACT: frozen manifest configuration hash is absent or malformed')
  if (!isObject(configuration) || !SHA256.test(configuration.actual_hash ?? '')) {
    errors.push('CONFIG_HASH_ABSENT: release configuration hash is absent')
    return
  }
  if (configuration.expected_hash !== expected || configuration.actual_hash !== expected) {
    errors.push('CONFIG_HASH_MISMATCH: release configuration hash does not match the frozen manifest')
  }
  if (configuration.environment !== 'intended-beta') errors.push('CONFIG_ENVIRONMENT: release configuration is not intended-beta')
  const flags = values(configuration.test_only_flags)
  const allowedFlags = new Set(values(manifest.release_configuration?.test_only_flags_allowed_at_launch))
  const unexpectedFlags = flags.filter(flag => !allowedFlags.has(flag))
  if (unexpectedFlags.length > 0) errors.push(`TEST_FLAGS_NOT_ALLOWED: launch evidence contains non-allowlisted test-only flags ${unexpectedFlags.join(', ')}`)
  const env = configuration.environment_variables
  if (!isObject(env)) {
    errors.push('TEST_FLAG_ASSERTION: launch environment assertion evidence must be an object')
    validateArtifactRef(configuration.receipt, artifacts, 'HG-09 release configuration receipt', errors)
    return
  }
  const assertions = manifest.release_configuration?.required_environment_assertions
  for (const [key, assertion] of Object.entries(isObject(assertions) ? assertions : {})) {
    const declaredAsFlag = flags.some(flag => flag === key || String(flag).startsWith(`${key}=`))
    if (assertion === 'absent' && (Object.hasOwn(env, key) || declaredAsFlag)) errors.push(`TEST_FLAG_PRESENCE: ${key} must be absent from launch environment evidence`)
    if (assertion === 'absent-or-false' && Object.hasOwn(env, key) && env[key] !== false) errors.push(`TEST_FLAG_ASSERTION: ${key} must be absent or the boolean false in launch environment evidence`)
    const enabled = truthyFlag(env[key]) || flags.some(flag => flag === key || (String(flag).startsWith(`${key}=`) && truthyFlag(String(flag).slice(key.length + 1))))
    if ((assertion === 'absent' || assertion === 'absent-or-false') && enabled) errors.push(`TEST_FLAG_ENABLED: ${key} is enabled in launch evidence`)
  }
  validateArtifactRef(configuration.receipt, artifacts, 'HG-09 release configuration receipt', errors)
}

function validateCouncil(council, evidence, manifest, artifacts, errors) {
  if (!Array.isArray(council) || council.length === 0) {
    errors.push('COUNCIL_MISSING: final launch council receipt is absent')
    return
  }
  const seats = council.map(row => row?.seat)
  if (!exactMembers(seats, REQUIRED_COUNCIL_SEATS)) errors.push('COUNCIL_SEATS: final council must contain exactly Codex, Fable 5 medium, and Kimi K3')
  for (const seat of council) {
    if (!isObject(seat) || !nonEmpty(seat.seat) || !isObject(seat.receipt)) errors.push('COUNCIL_INVALID: council receipt is malformed')
    else validateArtifactRef(seat.receipt, artifacts, `${seat.seat} council receipt`, errors)
    if (!['GO', 'CONDITIONAL-GO', 'NO-GO'].includes(seat?.verdict)) errors.push(`COUNCIL_VERDICT: invalid council verdict ${label(seat?.verdict)} from ${label(seat?.seat)}`)
    if (seat?.verdict !== 'GO' || seat?.resolved !== true) errors.push(`COUNCIL_NO_GO: final council seat ${label(seat?.seat)} is not strict GO`)
    if (seat?.commit !== evidence.repository?.head_sha || seat?.configuration_hash !== expectedConfigurationHash(manifest)) errors.push(`COUNCIL_BINDING: final council seat ${label(seat?.seat)} is stale for the release commit or configuration`)
    const receipt = readArtifactJson(seat?.receipt, artifacts)
    if (!isObject(receipt) || receipt.seat !== seat?.seat || receipt.verdict !== seat?.verdict || receipt.commit !== seat?.commit || receipt.configuration_hash !== seat?.configuration_hash) errors.push(`COUNCIL_BINDING: final council receipt ${label(seat?.seat)} is not artifact-bound to its verdict, commit, and configuration`)
  }
}

function validateFlakes(evidence, manifest, sourceInventory, artifacts, now, errors) {
  if (!Array.isArray(evidence.flakes)) errors.push('FLAKES_MISSING: flaky-test disposition ledger is absent')
  for (const flake of Array.isArray(evidence.flakes) ? evidence.flakes : []) {
    if (!isObject(flake) || flake.status !== 'disposed' || !nonEmpty(flake.owner) || !nonEmpty(flake.root_cause) || !isObject(flake.receipt)) {
      errors.push(`FLAKE_UNDISPOSED: flake ${label(flake?.id)} has no complete disposition`)
    } else validateArtifactRef(flake.receipt, artifacts, `flake ${flake.id} disposition`, errors)
  }
  const actual = evidence.e2e
  if (!isObject(actual)) {
    errors.push('E2E_EVIDENCE: E2E inventory and retry evidence is absent')
    return
  }
  if (actual.inventory_hash !== manifest.e2e?.inventory_hash || stable(actual.projects) !== stable(manifest.e2e?.projects)) {
    errors.push('E2E_DRIFT: E2E project/test inventory does not match the frozen manifest')
  }
  validatePlaywrightInventory(actual, manifest, artifacts, errors)
  validateExecutedPlaywrightReport(actual, evidence, manifest, sourceInventory, artifacts, errors)
  const approved = new Map(values(manifest.e2e?.approved_skips).map(row => [isObject(row) ? row.key : row, row]))
  for (const skip of values(actual.observed_skips)) {
    const key = isObject(skip) ? skip.key : skip
    const allow = approved.get(key)
    const expiry = isObject(allow) ? Date.parse(`${allow.expires_on}T23:59:59.999Z`) : Number.POSITIVE_INFINITY
    const source = isObject(skip) ? skip.source : null
    const scope = isObject(skip) ? skip.scope : null
    const matches = isObject(allow) && allow.source === source && stable(allow.scope) === stable(scope)
    if (!approved.has(key) || !matches || !Number.isFinite(expiry) || expiry < Date.parse(now)) errors.push(`E2E_SKIP: unapproved, expired, or source/scope-mismatched E2E skip ${label(key)}`)
  }
  for (const retry of values(actual.retry_results)) {
    const disposition = retry?.disposition
    const complete = isObject(disposition)
      ? nonEmpty(disposition.root_cause) && nonEmpty(disposition.owner) && nonEmpty(disposition.receipt) && disposition.independently_reviewed === true
      : nonEmpty(disposition) && nonEmpty(retry?.root_cause) && nonEmpty(retry?.owner) && nonEmpty(retry?.receipt) && retry?.independently_reviewed === true
    if (!isObject(retry) || !complete) {
      errors.push(`E2E_RETRY: retry result ${label(retry?.test_id)} has no root-cause disposition`)
    } else validateArtifactRef(isObject(disposition) ? disposition.receipt : retry.receipt, artifacts, `retry ${retry.test_id} disposition`, errors)
  }
}

function validateExecutedPlaywrightReport(actual, evidence, manifest, sourceInventory, artifacts, errors) {
  const contract = sourceInventory.executed_playwright_report_contract
  const reference = actual.report_receipt
  if (!isObject(contract) || !isObject(reference) || !validateArtifactRef(reference, artifacts, 'executed Playwright JSON report', errors)) {
    errors.push('E2E_REPORT_BINDING: executed Playwright JSON report receipt is missing or unpinned')
    return
  }
  const report = readArtifactJson(reference, artifacts)
  const requiredEvidence = values(contract.required_evidence_fields)
  const requiredReport = values(contract.report_content_required_fields)
  if (!isObject(report) || requiredEvidence.some(field => !Object.hasOwn(actual, field)) || requiredReport.some(field => !Object.hasOwn(report, field))) {
    errors.push('E2E_REPORT_BINDING: executed Playwright evidence/report is missing required fields')
    return
  }
  const expectedConfiguration = expectedConfigurationHash(manifest)
  const pinnedE2e = sourceInventory.playwright_inventory
  if (actual.inventory_id !== manifest.e2e.inventory_id || actual.report_format !== contract.report_format || actual.commit !== evidence.repository?.head_sha || actual.configuration_hash !== expectedConfiguration || actual.status !== contract.required_evidence_values?.status || actual.started_at !== report.started_at || actual.completed_at !== report.completed_at || stable(actual.observed_skips) !== stable(report.observed_skips) || stable(retryProjection(actual.retry_results)) !== stable(report.retry_results)) {
    errors.push('E2E_REPORT_BINDING: state E2E evidence is not bound to the executed report')
  }
  if (report.format !== contract.report_format || report.command !== sourceInventory.ci_contract?.engineering_e2e_only || report.commit !== evidence.repository?.head_sha || report.configuration_hash !== expectedConfiguration || report.inventory_id !== manifest.e2e.inventory_id || report.inventory_hash !== manifest.e2e.inventory_hash || stable(report.project_order) !== stable(manifest.e2e.project_order) || stable(report.projects) !== stable(manifest.e2e.projects) || report.expected_total !== manifest.e2e.expected_total || report.expected_files !== manifest.e2e.expected_files || report.status !== 'passed' || !validInterval(report.started_at, report.completed_at)) {
    errors.push('E2E_REPORT_BINDING: executed report is not bound to the command, commit, configuration, inventory, and successful interval')
  }

  const tests = Array.isArray(report.tests) ? report.tests : []
  const testRows = []
  const projectOrder = []
  const projects = {}
  const files = new Set()
  const observedSkips = []
  const retryResults = []
  const observedFlakes = []
  let malformed = tests.length === 0
  const approvedSkips = new Map(values(manifest.e2e.approved_skips).filter(isObject).map(skip => [skip.key, skip]))
  for (const test of tests) {
    if (!isObject(test) || !nonEmpty(test.project) || !nonEmpty(test.file) || !nonEmpty(test.title) || !Array.isArray(test.results) || test.results.length === 0) {
      malformed = true
      continue
    }
    const row = { project: test.project, file: test.file, title: test.title }
    testRows.push(row)
    if (!Object.hasOwn(projects, test.project)) {
      projects[test.project] = 0
      projectOrder.push(test.project)
    }
    projects[test.project] += 1
    files.add(test.file)
    const testId = `${test.project}::${test.file}::${test.title}`
    const statuses = test.results.map(result => result?.status)
    if (statuses.some(status => !['passed', 'skipped', 'failed', 'timedOut', 'interrupted'].includes(status))) malformed = true
    const finalStatus = statuses.at(-1)
    if (!['passed', 'skipped'].includes(finalStatus)) malformed = true
    if (finalStatus === 'skipped') {
      const annotations = values(test.annotations).filter(value => value?.type === 'production-readiness-skip')
      try {
        if (annotations.length !== 1) throw new Error('invalid skip annotation count')
        const skip = JSON.parse(annotations[0]?.description)
        const approved = approvedSkips.get(skip?.key)
        if (!isObject(skip) || !exactMembers(Object.keys(skip), ['key', 'source', 'scope']) || !nonEmpty(skip.key) || !nonEmpty(skip.source) || !isObject(skip.scope) || !isObject(approved) || approved.source !== skip.source || stable(approved.scope) !== stable(skip.scope) || !values(approved.test_ids).includes(testId)) throw new Error('invalid skip annotation')
        observedSkips.push({ key: skip.key, source: skip.source, scope: skip.scope })
      } catch {
        malformed = true
      }
    }
    if (test.results.length > 1 || test.results.some(result => Number.isInteger(result?.retry) && result.retry > 0)) {
      const retry = { test_id: testId, status: finalStatus === 'passed' ? 'passed-on-retry' : `${finalStatus}-on-retry`, attempts: test.results.length }
      retryResults.push(retry)
      if (statuses.slice(0, -1).some(status => status !== 'passed') && finalStatus === 'passed') observedFlakes.push({ id: testId })
    }
  }
  const inventoryMatches = testRows.length === manifest.e2e.expected_total && files.size === manifest.e2e.expected_files && stable(projectOrder) === stable(manifest.e2e.project_order) && stable(projects) === stable(manifest.e2e.projects) && sha256(stable(testRows)) === pinnedE2e?.test_ids_sha256
  const reportSummariesMatch = stable(report.observed_skips) === stable(observedSkips) && stable(report.retry_results) === stable(retryResults)
  const stateSummariesMatch = stable(actual.observed_skips) === stable(observedSkips) && stable(retryProjection(actual.retry_results)) === stable(retryResults)
  const flakeLedgerMatches = stable(values(evidence.flakes).map(flake => ({ id: flake?.id }))) === stable(observedFlakes)
  if (malformed || !inventoryMatches || !reportSummariesMatch || !stateSummariesMatch || !flakeLedgerMatches) errors.push('E2E_REPORT_BINDING: skips, retries, flakes, or test inventory do not derive exactly from the executed Playwright report')
  validateAxeReportBinding(report, tests, manifest, errors)
}

function validateAxeReportBinding(report, tests, manifest, errors) {
  const manifestTargets = manifestAxeTargets(manifest.e2e)
  const validation = report.axe_receipt_validation
  if (!manifestTargets || !Array.isArray(report.skip_validation_failures) || report.skip_validation_failures.length !== 0 || !Array.isArray(report.a11y_receipt_failures) || report.a11y_receipt_failures.length !== 0 || !isObject(validation)) {
    errors.push('E2E_AXE_REPORT_BINDING: Playwright skip and Axe receipt validation must fail closed with empty failure arrays')
    return
  }
  const passedOrigins = new Set(values(tests)
    .filter(test => isObject(test) && values(test.results).at(-1)?.status === 'passed')
    .map(test => stable({ project: test.project, file: test.file, title: test.title })))
  const expectedRunTargets = manifestTargets.filter(target => passedOrigins.has(stable(target.originating_test)))
  const expectedValidation = {
    schema_version: manifest.e2e.axe_receipts.schema_version,
    manifest_expected_total: 73,
    expected_run_total: expectedRunTargets.length,
    materialized_total: expectedRunTargets.length,
    expected_run_targets: expectedRunTargets,
    materialized_targets: expectedRunTargets,
    status: 'passed',
  }
  if (stable(validation) !== stable(expectedValidation)) {
    errors.push('E2E_AXE_REPORT_BINDING: Axe validation must exactly match canonical manifest targets materialized by passed report tests')
  }
}

function retryProjection(retries) {
  return values(retries).map(retry => ({ test_id: retry?.test_id, status: retry?.status, attempts: retry?.attempts }))
}

function validInterval(startedAt, completedAt) {
  const started = Date.parse(startedAt)
  const completed = Date.parse(completedAt)
  return Number.isFinite(started) && Number.isFinite(completed) && completed >= started
}

function validatePlaywrightInventory(actual, manifest, artifacts, errors) {
  if (actual.inventory_format !== 'playwright-json-list' || !validateArtifactRef(actual.inventory_receipt, artifacts, 'Playwright JSON/list inventory', errors)) {
    errors.push('E2E_INVENTORY_RECEIPT: hashed Playwright JSON/list inventory is missing')
    return
  }
  const content = artifacts[actual.inventory_receipt.path]?.content
  try {
    const receipt = JSON.parse(content)
    if (receipt.format !== 'playwright-json-list' || receipt.inventory_id !== manifest.e2e.inventory_id || stable(receipt.project_order) !== stable(manifest.e2e.project_order) || stable(receipt.projects) !== stable(manifest.e2e.projects) || receipt.expected_total !== manifest.e2e.expected_total || receipt.expected_files !== manifest.e2e.expected_files || receipt.inventory_hash !== manifest.e2e.inventory_hash) throw new Error('mismatch')
  } catch {
    errors.push('E2E_INVENTORY_RECEIPT: Playwright JSON/list receipt does not match the frozen manifest')
  }
}

function validateRehearsal(rehearsal, evidence, manifest, sourceInventory, artifacts, now, errors) {
  const expected = expectedConfigurationHash(manifest)
  const head = evidence.repository?.head_sha
  const contract = manifest.intended_beta_rehearsal_contract
  const pinnedRecipe = sourceInventory.hg09_rehearsal_contract
  const maximumAge = pinnedRecipe?.freshness_hours
  const maxAge = Number.isFinite(maximumAge) ? maximumAge : 24
  const ciTestCommand = contract?.engineering_e2e_command ?? manifest.e2e?.execution?.required_local_release_command ?? 'CI=1 npm run test:e2e'
  const clinicalExpected = manifest.release_boundary?.clinical_approval_present === true ? 'passed' : 'not_applicable'
  if (!isObject(rehearsal) || rehearsal.id !== contract?.id || !isObject(rehearsal.receipt) || !isObject(rehearsal.configuration_receipt) || rehearsal.commit !== head || rehearsal.configuration_hash !== expected || rehearsal.environment !== contract?.environment || rehearsal.test_mode !== contract?.test_mode || rehearsal.test_flags_off !== true || !nonEmpty(rehearsal.command) || rehearsal.command === ciTestCommand || /test:e2e/i.test(rehearsal.command) || rehearsal.exit_code !== 0 || !isObject(rehearsal.environment_variables) || !isObject(rehearsal.journey_evidence) || !Array.isArray(rehearsal.provider_receipts) || rehearsal.provider_receipts.length === 0 || !nonEmpty(rehearsal.legal_version) || rehearsal.clinical_gate_state !== clinicalExpected || !Array.isArray(rehearsal.council_receipts) || rehearsal.council_receipts.length !== REQUIRED_COUNCIL_SEATS.length) {
    errors.push('REHEARSAL_INVALID: intended-beta configuration rehearsal is absent or mismatched')
    return
  }
  if (rehearsal.command !== pinnedRecipe?.command || rehearsal.id !== pinnedRecipe?.id || rehearsal.environment !== pinnedRecipe?.environment || rehearsal.test_mode !== pinnedRecipe?.test_mode) errors.push('REHEARSAL_COMMAND: intended-beta rehearsal command/recipe does not match the independently frozen HG-09 contract')
  for (const flag of values(contract?.required_absent_test_flags)) {
    if (Object.hasOwn(rehearsal.environment_variables, flag) || truthyFlag(rehearsal.environment_variables[flag])) {
      errors.push(`REHEARSAL_TEST_FLAG: ${flag} must be absent from the intended-beta rehearsal environment`)
    }
  }
  validateArtifactRef(rehearsal.receipt, artifacts, 'HG-09 intended-beta rehearsal receipt', errors)
  validateArtifactRef(rehearsal.configuration_receipt, artifacts, 'HG-09 test-flags-off configuration receipt', errors)
  const rehearsalReceipt = readArtifactJson(rehearsal.receipt, artifacts)
  const configurationReceipt = readArtifactJson(rehearsal.configuration_receipt, artifacts)
  if (!isObject(rehearsalReceipt) || rehearsalReceipt.id !== rehearsal.id || rehearsalReceipt.command !== rehearsal.command || rehearsalReceipt.exit_code !== rehearsal.exit_code || rehearsalReceipt.commit !== rehearsal.commit || rehearsalReceipt.configuration_hash !== rehearsal.configuration_hash || rehearsalReceipt.environment !== rehearsal.environment || rehearsalReceipt.test_mode !== rehearsal.test_mode || rehearsalReceipt.test_flags_off !== rehearsal.test_flags_off) errors.push('REHEARSAL_RECEIPT: intended-beta rehearsal receipt is not bound to the exact recipe, commit, and configuration')
  if (!isObject(configurationReceipt) || configurationReceipt.commit !== rehearsal.commit || configurationReceipt.configuration_hash !== rehearsal.configuration_hash || configurationReceipt.environment !== rehearsal.environment || stable(configurationReceipt.environment_variables) !== stable(rehearsal.environment_variables)) errors.push('REHEARSAL_RECEIPT: intended-beta configuration receipt is not bound to the exact flags-off environment')
  validateArtifactRef(rehearsal.journey_evidence, artifacts, 'HG-09 intended-beta journey evidence', errors)
  for (const receipt of rehearsal.provider_receipts) validateArtifactRef(receipt, artifacts, 'HG-09 provider receipt', errors)
  for (const receipt of rehearsal.council_receipts) validateArtifactRef(receipt, artifacts, 'HG-09 council receipt', errors)
  const rehearsalCouncilRefs = rehearsal.council_receipts.map(reference => stable(reference))
  const finalCouncilRefs = values(evidence.council).map(row => stable(row?.receipt))
  if (!exactMembers(rehearsalCouncilRefs, finalCouncilRefs)) errors.push('REHEARSAL_COUNCIL: intended-beta rehearsal council receipts do not match the final strict-GO council')
  if (!fresh(rehearsal.completed_at, now, maxAge)) errors.push('REHEARSAL_STALE: intended-beta rehearsal is stale')
}

function validateOwnerApproval(approval, evidence, manifest, artifacts, now, errors) {
  const expected = expectedConfigurationHash(manifest)
  const contract = manifest.owner_approval_contract
  if (!isObject(approval) || !isObject(contract) || approval.approved !== contract.required_evidence_values?.approved || !nonEmpty(approval.approved_at) || !isObject(approval.receipt) || approval.commit !== evidence.repository?.head_sha || approval.configuration_hash !== expected) {
    errors.push('OWNER_APPROVAL: explicit owner production-promotion approval is absent or mismatched')
    return
  }
  validateArtifactRef(approval.receipt, artifacts, 'HG-10 owner approval receipt', errors)
  const receipt = readArtifactJson(approval.receipt, artifacts)
  const finalAudit = receipt?.final_audit_receipt
  const rollbackPacket = receipt?.rollback_packet_receipt
  const requiredFields = values(contract.receipt_content_required_fields)
  const finalAuditContent = readArtifactJson(finalAudit, artifacts)
  const rollbackContent = readArtifactJson(rollbackPacket, artifacts)
  const pinnedAudit = values(manifest.source_contracts).find(row => row?.id === finalAuditContent?.id)
  const validReceipt = isObject(receipt)
    && requiredFields.every(field => Object.hasOwn(receipt, field))
    && receipt.id === contract.receipt_content_required_values?.id
    && receipt.task_id === contract.receipt_content_required_values?.task_id
    && receipt.decision === contract.receipt_content_required_values?.decision
    && nonEmpty(receipt.approver)
    && receipt.approved_at === approval.approved_at
    && receipt.commit === approval.commit
    && receipt.ci_run_id === evidence.ci?.run_id
    && receipt.ci_url === evidence.ci?.url
    && receipt.ci_status === evidence.ci?.status
    && receipt.configuration_hash === expected
    && receipt.manifest_hash === sha256(stable(manifest))
    && receipt.final_audit_id === pinnedAudit?.id
    && receipt.final_audit_hash === pinnedAudit?.sha256
    && isObject(finalAudit)
    && isObject(rollbackPacket)
  if (!validReceipt) {
    errors.push('OWNER_APPROVAL_RECEIPT: owner approval receipt is not bound to its timestamp, approver, commit, current CI, manifest/configuration hashes, final audit, and rollback packet')
    return
  }
  const approvedAt = strictTimestampMs(approval.approved_at)
  const rehearsalCompletedAt = strictTimestampMs(evidence.rehearsal?.completed_at)
  const evaluatedAt = strictTimestampMs(now)
  const councilRefs = values(evidence.council).map(row => stable(row?.receipt))
  const rehearsalCouncilRefs = values(evidence.rehearsal?.council_receipts).map(stable)
  const finalCouncilCompleted = exactMembers(councilRefs, rehearsalCouncilRefs)
    && exactMembers(values(evidence.council).map(row => row?.seat), REQUIRED_COUNCIL_SEATS)
    && values(evidence.council).every(row => row?.verdict === 'GO' && row?.resolved === true)
  if (contract.approval_before_hg09_allowed !== false || !Number.isFinite(approvedAt) || !Number.isFinite(rehearsalCompletedAt) || !Number.isFinite(evaluatedAt) || approvedAt < rehearsalCompletedAt || approvedAt > evaluatedAt || !finalCouncilCompleted) errors.push('OWNER_APPROVAL_CHRONOLOGY: owner approval must be a valid non-future timestamp issued only after HG-09 and its exact final strict-GO council completed')
  validateArtifactRef(finalAudit, artifacts, 'HG-10 final audit receipt', errors)
  validateArtifactRef(rollbackPacket, artifacts, 'HG-10 rollback packet receipt', errors)
  if (!isObject(finalAuditContent) || finalAuditContent.id !== pinnedAudit?.id || finalAuditContent.sha256 !== pinnedAudit?.sha256 || finalAuditContent.commit !== approval.commit || finalAuditContent.configuration_hash !== expected || finalAuditContent.verified !== true || !isObject(rollbackContent) || rollbackContent.task_id !== 'HG-10' || rollbackContent.commit !== approval.commit || rollbackContent.configuration_hash !== expected || rollbackContent.verified !== true) errors.push('OWNER_APPROVAL_RECEIPT: final audit or rollback packet receipt is malformed, stale, or not artifact-bound')
}

function findDependencyErrors(tasks, errors) {
  const byId = new Map(tasks.filter(isObject).map(task => [task.id, task]))
  for (const task of tasks) {
    if (!isObject(task) || !Array.isArray(task.dependencies)) continue
    for (const dependency of task.dependencies) {
      if (!byId.has(dependency)) errors.push(`DEPENDENCY_UNKNOWN: ${task.id} depends on unknown task ${label(dependency)}`)
      if (dependency === task.id) errors.push(`DEPENDENCY_CYCLE: ${task.id} depends on itself`)
    }
  }
  const visiting = new Set()
  const visited = new Set()
  const visit = id => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const dependency of byId.get(id)?.dependencies ?? []) if (byId.has(dependency) && visit(dependency)) return true
    visiting.delete(id)
    visited.add(id)
    return false
  }
  for (const id of byId.keys()) if (visit(id)) errors.push(`DEPENDENCY_CYCLE: dependency graph contains a cycle involving ${id}`)
}

function validateArtifactRef(reference, artifacts, context, errors) {
  if (!isObject(reference) || !nonEmpty(reference.path) || !SHA256.test(reference.sha256 ?? '')) {
    errors.push(`ARTIFACT_REF: ${context} must include a relative proof path and sha256`)
    return false
  }
  const normalized = posix.normalize(reference.path)
  if (!reference.path.startsWith('proof/') || reference.path.includes('\\') || normalized !== reference.path || normalized.includes('../') || posix.isAbsolute(reference.path)) {
    errors.push(`ARTIFACT_PATH: ${context} escapes the canonical proof root`)
    return false
  }
  const artifact = artifacts[reference.path]
  if (!isObject(artifact) || artifact.is_regular_file !== true || artifact.is_symlink !== false || artifact.within_proof_root !== true) {
    errors.push(`ARTIFACT_FILE: ${context} is not a regular non-symlink file under the canonical proof root`)
    return false
  }
  if (artifact.sha256 !== reference.sha256 || sha256(artifact.content ?? '') !== reference.sha256) {
    errors.push(`ARTIFACT_HASH: ${context} receipt hash does not match file content`)
    return false
  }
  return true
}

function readArtifactJson(reference, artifacts) {
  if (!isObject(reference) || !nonEmpty(reference.path)) return null
  try {
    return JSON.parse(artifacts[reference.path]?.content)
  } catch {
    return null
  }
}

function expectedConfigurationHash(manifest) {
  const contract = manifest.configuration_hash_contract
  return contract?.expected_hash ?? contract?.configuration_hash ?? contract?.frozen_hash ?? manifest.configuration_hash
}

function proofMap(state) {
  if (isObject(state.proofs)) return state.proofs
  if (isObject(state.evidence?.proofs)) return state.evidence.proofs
  return {}
}

function releaseEvidence(state) {
  if (isObject(state.release_evidence)) return state.release_evidence
  return null
}

function validReplan(task) {
  if (task.replanned !== true) return false
  return nonEmpty(task.replan_evidence) || nonEmpty(task.replan_reason) || /replan/i.test(task.last_decision ?? '')
}

function applicable(value) {
  if (value === true || value === 'applicable') return true
  return isObject(value) && (value.state === 'applicable' || value.applicable === true)
}

function criticalSeverity(value) {
  return /(^|[^A-Z0-9])S[12]($|[^A-Z0-9])/i.test(String(value))
}

function validateRowState(row, name, errors) {
  if (!ALLOWED_STATUSES.has(row.status)) errors.push(`MANIFEST_STATUS: ${name} has invalid status ${label(row.status)}`)
  const hasOutcome = row.outcome !== null && row.outcome !== undefined
  if (row.status === 'completed' && !ALLOWED_OUTCOMES.has(row.outcome)) errors.push(`MANIFEST_OUTCOME: completed ${name} has invalid outcome ${label(row.outcome)}`)
  if (row.status !== 'completed' && hasOutcome) errors.push(`MANIFEST_OUTCOME: non-completed ${name} must have a null outcome`)
}

function fresh(timestamp, now, maxAgeHours) {
  const thenMs = Date.parse(timestamp)
  const nowMs = Date.parse(now)
  if (!Number.isFinite(thenMs) || !Number.isFinite(nowMs) || thenMs > nowMs) return false
  return nowMs - thenMs <= maxAgeHours * 60 * 60 * 1000
}

function strictTimestampMs(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return Number.NaN
  return Date.parse(value)
}

function uniqueIds(rows, name, errors) {
  const ids = new Set()
  for (const row of rows) {
    if (!isObject(row) || !nonEmpty(row.id)) {
      errors.push(`ID_INVALID: ${name} is missing a string id`)
      continue
    }
    if (ids.has(row.id)) errors.push(`ID_DUPLICATE: duplicate ${name} id ${row.id}`)
    ids.add(row.id)
  }
  return ids
}

function requireArray(value, message, errors) {
  if (Array.isArray(value)) return value
  errors.push(message)
  return []
}

function values(value) {
  if (Array.isArray(value)) return value
  return value === null || value === undefined ? [] : [value]
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function sameSet(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every(value => b.includes(value))
}

function exactMembers(a, b) {
  return sameSet(a, b) && new Set(a).size === a.length && new Set(b).size === b.length
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function truthyFlag(value) {
  return value === true || value === 1 || ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value).toLowerCase())
}

function unique(valuesToDedupe) {
  return [...new Set(valuesToDedupe)]
}

function label(value) {
  return value === null || value === undefined || value === '' ? '<missing>' : String(value)
}

function parseArgs(argv) {
  let mode = null
  let statePath = resolve(homedir(), '.claude/goal-state/posture-ai-production-readiness/state.json')
  let manifestPath = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/qa/production-readiness-manifest.json')
  const errors = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--build' || arg === '--launch') {
      const nextMode = arg.slice(2)
      if (mode && mode !== nextMode) errors.push('MODE_INVALID: choose exactly one of --build or --launch')
      mode = nextMode
    } else if (arg === '--state' || arg === '--manifest') {
      const value = argv[index + 1]
      if (!nonEmpty(value)) errors.push(`ARGUMENT_INVALID: ${arg} requires a path`)
      else if (arg === '--state') statePath = resolve(value)
      else manifestPath = resolve(value)
      index += 1
    } else {
      errors.push(`ARGUMENT_INVALID: unknown argument ${arg}`)
    }
  }
  if (!mode) errors.push('MODE_INVALID: choose --build or --launch')
  return { mode, statePath, manifestPath, errors }
}

function runCli() {
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.errors.length > 0) return printAndExit({ autonomous_build_complete: false, launch_authorized: false, errors: parsed.errors })
  let state
  let manifest
  let sourceInventory
  try {
    state = JSON.parse(readFileSync(parsed.statePath, 'utf8'))
  } catch (error) {
    return printAndExit({ autonomous_build_complete: false, launch_authorized: false, errors: [`STATE_READ: ${error.message}`] })
  }
  try {
    manifest = JSON.parse(readFileSync(parsed.manifestPath, 'utf8'))
  } catch (error) {
    return printAndExit({ autonomous_build_complete: false, launch_authorized: false, errors: [`MANIFEST_READ: ${error.message}`] })
  }
  try {
    const inventoryPath = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/production-readiness/source-inventory.json')
    sourceInventory = JSON.parse(readFileSync(inventoryPath, 'utf8'))
  } catch (error) {
    return printAndExit({ autonomous_build_complete: false, launch_authorized: false, errors: [`SOURCE_INVENTORY_READ: ${error.message}`] })
  }
  const artifacts = readArtifactEvidence(state, manifest)
  const actualSources = collectActualSources(sourceInventory, parsed.statePath)
  const liveRepository = collectLiveRepository(sourceInventory, state)
  printAndExit(validateProductionReadiness({ mode: parsed.mode, state, manifest, sourceInventory, actualSources, liveRepository, artifacts }))
}

function collectActualSources(sourceInventory, statePath) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const files = []
  for (const contract of [...values(sourceInventory.source_contracts), ...values(sourceInventory.runtime_source_contracts)]) {
    const requested = contract.path.startsWith('~/') ? resolve(homedir(), contract.path.slice(2)) : resolve(repoRoot, contract.path)
    const entry = { id: contract.id, path: contract.path, resolved_path: '', is_regular_file: false, is_symlink: false, within_allowed_root: false, content: '' }
    try {
      const stat = lstatSync(requested)
      const realPath = realpathSync(requested)
      const repoRelative = relative(repoRoot, realPath)
      const stateRoot = resolve(homedir(), '.claude/goal-state/posture-ai-production-readiness')
      const stateRelative = relative(stateRoot, realPath)
      entry.resolved_path = realPath
      entry.is_regular_file = stat.isFile()
      entry.is_symlink = stat.isSymbolicLink()
      entry.within_allowed_root = (repoRelative !== '..' && !repoRelative.startsWith(`..${sep}`)) || (stateRelative !== '..' && !stateRelative.startsWith(`..${sep}`))
      entry.content = readFileSync(realPath, 'utf8')
    } catch {
      // The validator fails closed from the incomplete metadata.
    }
    files.push(entry)
  }
  const command = sourceInventory.playwright_inventory?.command
  const playwrightExecutable = resolve(repoRoot, 'node_modules/.bin/playwright')
  const list = command === 'npx playwright test --list'
    ? spawnSync(playwrightExecutable, ['test', '--list'], { cwd: repoRoot, encoding: 'utf8' })
    : { status: null, stdout: '', stderr: 'unrecognized independently frozen Playwright list command' }
  const validationState = { requested_path: statePath, resolved_path: '', is_regular_file: false, is_symlink: false, content: '' }
  try {
    const stat = lstatSync(statePath)
    validationState.resolved_path = realpathSync(statePath)
    validationState.is_regular_file = stat.isFile()
    validationState.is_symlink = stat.isSymbolicLink()
    validationState.content = readFileSync(validationState.resolved_path, 'utf8')
  } catch {
    // The validator fails closed from the incomplete metadata.
  }
  return { files, validation_state: validationState, playwright: { command, exit_code: list.status, stdout: list.stdout, stderr: list.stderr } }
}

function collectLiveRepository(sourceInventory, state) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const git = args => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
  const head = git(['rev-parse', 'HEAD'])
  const remote = git(['remote', 'get-url', 'origin'])
  const porcelain = git(['status', '--porcelain=v1', '--untracked-files=all'])
  const diff = git(['diff', '--check'])
  const stateCommit = COMMIT_SHA.test(state.commit ?? '') ? git(['cat-file', '-e', `${state.commit}^{commit}`]) : { status: 1 }
  const audited = sourceInventory.repository_identity?.audited_commit
  const auditedCommit = COMMIT_SHA.test(audited ?? '') ? git(['cat-file', '-e', `${audited}^{commit}`]) : { status: 1 }
  const headSha = head.status === 0 ? head.stdout.trim() : null
  const taskCommits = values(state.tasks).filter(task => task?.status === 'completed').map(task => {
    const valid = COMMIT_SHA.test(task?.commit ?? '')
    const exists = valid ? git(['cat-file', '-e', `${task.commit}^{commit}`]).status === 0 : false
    const reachable = exists && nonEmpty(headSha) ? git(['merge-base', '--is-ancestor', task.commit, headSha]).status === 0 : false
    return { task_id: task?.id, commit: task?.commit, exists, reachable_from_head: reachable }
  })
  const porcelainOutput = porcelain.status === 0 ? porcelain.stdout.trimEnd() : '<git-status-failed>'
  return {
    remote_url: remote.status === 0 ? remote.stdout.trim() : null,
    audited_commit: audited,
    audited_commit_exists: auditedCommit.status === 0,
    head_sha: headSha,
    head_commit_exists: stateCommit.status === 0,
    worktree_clean: porcelain.status === 0 && porcelainOutput === '',
    porcelain: porcelainOutput,
    changed_files: porcelainOutput === '' ? [] : porcelainOutput.split('\n').map(line => line.slice(3).trim()),
    diff_check_exit_code: diff.status,
    task_commits: taskCommits,
  }
}

function readArtifactEvidence(state, manifest) {
  const evidence = {}
  const references = collectArtifactReferences(state, manifest)
  let canonicalRoot
  try {
    canonicalRoot = realpathSync(state.proof_dir)
  } catch {
    canonicalRoot = resolve(state.proof_dir ?? '/missing-proof-root')
  }
  for (const reference of references) {
    const entry = { is_regular_file: false, is_symlink: false, within_proof_root: false, sha256: null, content: '' }
    evidence[reference.path] = entry
    try {
      const candidate = resolve(dirname(canonicalRoot), reference.path)
      const stat = lstatSync(candidate)
      const realPath = realpathSync(candidate)
      const rel = relative(canonicalRoot, realPath)
      entry.is_regular_file = stat.isFile()
      entry.is_symlink = stat.isSymbolicLink()
      entry.within_proof_root = rel !== '..' && !rel.startsWith(`..${sep}`) && !resolve(realPath).includes(`${sep}.git${sep}`)
      entry.content = readFileSync(realPath, 'utf8')
      entry.sha256 = sha256(entry.content)
    } catch {
      // The pure validator emits the fail-closed artifact error from this metadata.
    }
  }
  return evidence
}

function collectArtifactReferences(state, manifest) {
  const found = new Map()
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!isObject(value)) return
    if (nonEmpty(value.path) && SHA256.test(value.sha256 ?? '')) found.set(value.path, value)
    for (const nested of Object.values(value)) visit(nested)
  }
  visit(state)
  visit(manifest.audit_findings)
  for (const task of values(state.tasks)) {
    if (nonEmpty(task?.proof_manifest) && SHA256.test(task?.proof_manifest_sha256 ?? '')) found.set(task.proof_manifest, { path: task.proof_manifest, sha256: task.proof_manifest_sha256 })
  }
  return [...found.values()]
}

function printAndExit(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = result.errors.length === 0 ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli()

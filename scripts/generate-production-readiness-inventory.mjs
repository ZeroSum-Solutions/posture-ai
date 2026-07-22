#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildPr08ConfigurationDeltaContract,
  computeManifestConfigurationHash,
  computeSourceInventoryHash,
} from './check-production-readiness-goal.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = resolve(ROOT, 'docs/qa/production-readiness-manifest.json')
const SOURCE_INVENTORY_PATH = resolve(ROOT, 'scripts/fixtures/production-readiness/source-inventory.json')
const CHECKER_PATH = resolve(ROOT, 'scripts/check-production-readiness-goal.mjs')
const INVENTORY_ID = 'playwright-production-readiness-2026-07-21-v4'
const AUDIT_SOURCE_ID = 'posture-ai-production-readiness-audit-2026-07-21-pr08'
const PLAYWRIGHT_SOURCE_ID = 'posture-ai-playwright-config-2026-07-21-pr08'
const DEVICE_CONTRACT_SOURCE_ID = 'posture-ai-device-release-contract-2026-07-21-pr08'
const DEVICE_VALIDATOR_SOURCE_ID = 'posture-ai-device-evidence-validator-2026-07-21-pr08'
const DEVICE_SCHEMA_SOURCE_ID = 'posture-ai-device-evidence-schema-2026-07-21-pr08'
const PLAYWRIGHT_RECEIPT_SOURCE_ID = 'posture-ai-playwright-receipt-reporter-2026-07-21-pr08'
const PLAYWRIGHT_SANITIZER_SOURCE_ID = 'posture-ai-playwright-receipt-sanitizer-2026-07-21-pr08'
const SOURCE_INVENTORY_HASH_PATTERN = /const SOURCE_INVENTORY_HASH = '[a-f0-9]{64}'/
const PR08_BASE_COMMIT = '92b31ab453b1e70c630cdfbb88d67688633a184d'

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

export function parsePlaywrightList(stdout) {
  const tests = []
  const projects = {}
  const projectOrder = []
  const files = new Set()
  for (const line of String(stdout).split(/\r?\n/)) {
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
  if (tests.length === 0) throw new Error('Playwright --list returned no parseable tests')
  return {
    command: 'npx playwright test --list',
    project_order: projectOrder,
    projects,
    expected_total: tests.length,
    expected_files: files.size,
    test_ids_sha256: sha256(stable(tests)),
  }
}

export function bindSourceInventoryHash(checker, inventoryHash) {
  if (!/^[a-f0-9]{64}$/.test(inventoryHash)) throw new Error('Source inventory hash is invalid')
  if (!SOURCE_INVENTORY_HASH_PATTERN.test(checker)) {
    throw new Error('Could not locate SOURCE_INVENTORY_HASH in the checker')
  }
  return checker.replace(
    SOURCE_INVENTORY_HASH_PATTERN,
    `const SOURCE_INVENTORY_HASH = '${inventoryHash}'`,
  )
}

export function derivePr17RequiredCommands(ciContract) {
  const globalCommands = ciContract?.global_commands
  const additionalCommands = ciContract?.pr17_additional_commands
  if (!Array.isArray(globalCommands) || !Array.isArray(additionalCommands)) {
    throw new Error('CI contract command lists are invalid')
  }
  return [...globalCommands, ...additionalCommands]
}

export function deviceEvidenceRuntimeSources() {
  return [
    { path: 'docs/qa/device-release-contract.json', id: DEVICE_CONTRACT_SOURCE_ID },
    { path: 'scripts/check-device-evidence.mjs', id: DEVICE_VALIDATOR_SOURCE_ID },
    { path: 'docs/qa/device-evidence.schema.json', id: DEVICE_SCHEMA_SOURCE_ID },
  ]
}

function updateSourceContract(contracts, path, { id } = {}) {
  const contract = contracts.find(row => row.path === path)
  if (!contract) throw new Error(`Missing source contract for ${path}`)
  if (id) contract.id = id
  contract.sha256 = sha256(readFileSync(resolve(ROOT, path), 'utf8'))
}

function upsertEntireFileContract(contracts, path, id) {
  const existing = contracts.find(row => row.path === path)
  const next = existing ?? { hash_algorithm: 'sha256', hash_scope: 'entire_file' }
  next.id = id
  next.path = path
  next.sha256 = sha256(readFileSync(resolve(ROOT, path), 'utf8'))
  if (!existing) contracts.push(next)
}

function rendered(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function buildNext() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  const sourceInventory = JSON.parse(readFileSync(SOURCE_INVENTORY_PATH, 'utf8'))
  const checker = readFileSync(CHECKER_PATH, 'utf8')
  const playwright = spawnSync(resolve(ROOT, 'node_modules/.bin/playwright'), ['test', '--list', '--reporter=list'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (playwright.status !== 0) throw new Error(`Playwright inventory failed:\n${playwright.stderr}`)
  const inventory = parsePlaywrightList(playwright.stdout)

  const auditContract = manifest.source_contracts.find(row => row.path === 'docs/qa/AUDIT.md')
  if (!auditContract) throw new Error('Manifest is missing the AUDIT source contract')
  auditContract.id = AUDIT_SOURCE_ID
  auditContract.sha256 = sha256(readFileSync(resolve(ROOT, auditContract.path), 'utf8'))

  manifest.e2e.inventory_id = INVENTORY_ID
  manifest.e2e.project_order = inventory.project_order
  manifest.e2e.projects = inventory.projects
  manifest.e2e.expected_total = inventory.expected_total
  manifest.e2e.expected_files = inventory.expected_files
  manifest.executed_playwright_report_contract.required_evidence_values.inventory_id = INVENTORY_ID

  const e2ePayload = Object.fromEntries([
    'inventory_id', 'source_config', 'source_runner', 'inventory_command', 'project_order', 'projects',
    'expected_total', 'expected_files', 'execution', 'retry_policy', 'axe_receipts', 'approved_skips', 'skip_policy',
  ].map(key => [key, manifest.e2e[key]]))
  manifest.e2e.inventory_hash = sha256(stable(e2ePayload))
  const configurationHash = computeManifestConfigurationHash(manifest)
  if (!configurationHash) throw new Error('Could not recompute the manifest configuration hash')
  manifest.configuration_hash_contract.expected_hash = configurationHash
  manifest.configuration_hash = configurationHash

  sourceInventory.source_contracts = structuredClone(manifest.source_contracts)
  updateSourceContract(sourceInventory.runtime_source_contracts, 'playwright.config.ts', { id: PLAYWRIGHT_SOURCE_ID })
  updateSourceContract(sourceInventory.runtime_source_contracts, 'scripts/run-e2e.mjs')
  for (const source of deviceEvidenceRuntimeSources()) upsertEntireFileContract(sourceInventory.runtime_source_contracts, source.path, source.id)
  upsertEntireFileContract(sourceInventory.runtime_source_contracts, 'scripts/playwright-receipt-reporter.mjs', PLAYWRIGHT_RECEIPT_SOURCE_ID)
  upsertEntireFileContract(sourceInventory.runtime_source_contracts, 'scripts/playwright-receipt-sanitize.cjs', PLAYWRIGHT_SANITIZER_SOURCE_ID)
  sourceInventory.playwright_inventory = inventory
  sourceInventory.executed_playwright_report_contract = structuredClone(manifest.executed_playwright_report_contract)
  sourceInventory.ci_contract = structuredClone(manifest.ci_contract)
  sourceInventory.pr17_required_commands = derivePr17RequiredCommands(manifest.ci_contract)
  const baseManifestResult = spawnSync('git', ['show', `${PR08_BASE_COMMIT}:docs/qa/production-readiness-manifest.json`], { cwd: ROOT, encoding: 'utf8' })
  if (baseManifestResult.status !== 0) throw new Error(`Could not read PR-08 base manifest from ${PR08_BASE_COMMIT}`)
  const deltaContract = buildPr08ConfigurationDeltaContract(JSON.parse(baseManifestResult.stdout), manifest, PR08_BASE_COMMIT)
  if (!deltaContract || deltaContract.changed_covered_fields.length === 0) throw new Error('Could not derive the exact PR-08 covered configuration delta')
  sourceInventory.pr08_configuration_delta_contract = deltaContract
  sourceInventory.inventory_hash = computeSourceInventoryHash(sourceInventory)
  if (!sourceInventory.inventory_hash) throw new Error('Could not recompute the independent source inventory hash')

  const nextChecker = bindSourceInventoryHash(checker, sourceInventory.inventory_hash)

  return {
    manifest: rendered(manifest),
    sourceInventory: rendered(sourceInventory),
    checker: nextChecker,
    summary: {
      inventory_id: INVENTORY_ID,
      projects: inventory.projects,
      expected_total: inventory.expected_total,
      expected_files: inventory.expected_files,
      test_ids_sha256: inventory.test_ids_sha256,
      e2e_inventory_hash: manifest.e2e.inventory_hash,
      configuration_hash: configurationHash,
      source_inventory_hash: sourceInventory.inventory_hash,
    },
  }
}

function main() {
  const next = buildNext()
  const current = {
    manifest: readFileSync(MANIFEST_PATH, 'utf8'),
    sourceInventory: readFileSync(SOURCE_INVENTORY_PATH, 'utf8'),
    checker: readFileSync(CHECKER_PATH, 'utf8'),
  }
  const stale = ['manifest', 'sourceInventory', 'checker'].filter(key => current[key] !== next[key])
  if (process.argv.includes('--write')) {
    writeFileSync(MANIFEST_PATH, next.manifest)
    writeFileSync(SOURCE_INVENTORY_PATH, next.sourceInventory)
    writeFileSync(CHECKER_PATH, next.checker)
    process.stdout.write(`${JSON.stringify({ status: 'updated', ...next.summary })}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify({ status: stale.length === 0 ? 'current' : 'stale', stale, ...next.summary })}\n`)
  if (stale.length > 0) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()

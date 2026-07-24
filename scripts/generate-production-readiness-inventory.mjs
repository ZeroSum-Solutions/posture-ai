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
const INVENTORY_ID = 'playwright-production-readiness-2026-07-24-v5-pr10'
const PLAYWRIGHT_SOURCE_ID = 'posture-ai-playwright-config-2026-07-21-pr08'
const DEVICE_CONTRACT_SOURCE_ID = 'posture-ai-device-release-contract-2026-07-21-pr08'
const DEVICE_VALIDATOR_SOURCE_ID = 'posture-ai-device-evidence-validator-2026-07-21-pr08'
const DEVICE_SCHEMA_SOURCE_ID = 'posture-ai-device-evidence-schema-2026-07-21-pr08'
const PLAYWRIGHT_RECEIPT_SOURCE_ID = 'posture-ai-playwright-receipt-reporter-2026-07-21-pr08'
const PLAYWRIGHT_SANITIZER_SOURCE_ID = 'posture-ai-playwright-receipt-sanitizer-2026-07-21-pr08'
const PERFORMANCE_BUDGET_SOURCE_ID = 'posture-ai-performance-budgets-v6-2026-07-22-pr09'
const PERFORMANCE_BUDGET_SCHEMA_SOURCE_ID = 'posture-ai-performance-budgets-schema-v6-2026-07-22-pr09'
const PERFORMANCE_BUDGET_VALIDATOR_SOURCE_ID = 'posture-ai-performance-budgets-validator-v7-2026-07-22-pr09'
const PERFORMANCE_BUDGET_SOURCE_SHA256 = '13d2331f4fa4fe11fe98b9a98fbb631ac734040ef54a0ef2af6137bc98f46b74'
const PERFORMANCE_BUDGET_SCHEMA_SOURCE_SHA256 = '159d652df8b9b070681a5a49aa88d385ea6d6505d8d739311c6fe753fa26aa94'
const PERFORMANCE_BUDGET_VALIDATOR_SOURCE_SHA256 = 'de8d6504c9953ec3563c63ce0c5946d627310df47e711967c7febac66098bb9a'
const TIER_B_DOCUMENT_SOURCES = [
  ['docs/qa/AUDIT.md', 'posture-ai-production-readiness-audit-2026-07-24-pr10', 'c19e929124988636c2471bc2cfcfb64a6a812b00a853868624fb57bb43feb899'],
  ['docs/plans/2026-07-19-production-readiness-goal-spec.md', 'posture-ai-production-readiness-spec-v2-2026-07-24-pr10', '217b4d06681b711c7653594cd3ce396f0d60640976121101d22244002301ce56'],
  ['docs/qa/tierb-reliability/protocol.md', 'posture-ai-tierb-reliability-protocol-v2-r4-pr10', 'fb5d4a83bffbfa7c6ea412dd631da10f9b1c13b1200210512f2078ca6c1ecee9'],
  ['docs/qa/tierb-reliability/prepared.packet.json', 'posture-ai-tierb-prepared-packet-v1-pr10', 'a2805a4618628f8230f4f836f8c0813706e0f070a191d82ed8a0324a1a631d13'],
  ['docs/qa/tierb-reliability/trust-policy.json', 'posture-ai-tierb-production-trust-policy-v1-pr10', 'bf46a4198c1e4be37ebf6e2c065105e5a188c79cb95fdb31f20b0b5fa1135cbe'],
  ['docs/qa/tierb-reliability/trust-policy.pin.json', 'posture-ai-tierb-production-trust-pin-v1-pr10', '5dcf941362c3b0d91114cf4a9d0198708169f695972ca2c050e4277b3b56fe25'],
  ['docs/qa/tierb-reliability/schemas/prepared-packet.schema.json', 'posture-ai-tierb-prepared-schema-v1-pr10', '93760c63dc8898d392e4727336ea4458ef3b32b45b1374b4898d2ba41733b03d'],
  ['docs/qa/tierb-reliability/schemas/trust-policy.schema.json', 'posture-ai-tierb-trust-schema-v1-pr10', '5ede34e5e4c6171faf6cec5d47eb3c5b1674bebf01367a442b65e5b508d8fdf9'],
  ['docs/qa/tierb-reliability/schemas/analysis-input.schema.json', 'posture-ai-tierb-analysis-input-schema-v1-r3-pr10', '17b07b8b4fff184814e0b36454a0218b25382f05cfe07b7c852da40f25225f89'],
  ['docs/qa/tierb-reliability/schemas/collection-manifest.schema.json', 'posture-ai-tierb-manifest-schema-v1-r2-pr10', 'cce741c746f9f4dda28bf3cfe48c5ef5b61051f7abaafd669aeb0cb1d5079e9c'],
]
const TIER_B_RUNTIME_SOURCES = [
  ['lib/pose/tierb-contract.ts', 'posture-ai-tierb-contract-v1-pr10', 'e689d37a24364c575182d7b8b4ee79945f8001410eba6f38117160224781ef0a'],
  ['packages/posture-engine/src/reliability.ts', 'posture-ai-tierb-reliability-math-v2-r2-pr10', 'b65d767673811d7a938cb120f0955ae735d9b63393a40005fbbeaa772d303c4b'],
  ['lib/reliability/tierb-analysis.ts', 'posture-ai-tierb-analysis-v1-r3-pr10', 'ddfa95520d0c88d3ed6dde40fd77915a7e4aa604ee8c0b3f35f117e4c6675352'],
  ['lib/reliability/tierb-canonical.ts', 'posture-ai-tierb-canonicalization-v1-pr10', '8f3e97b3e8793e1ddcb4ddeb88990f4d9014f81a21d1c596ab6c0412cd4577ab'],
  ['lib/reliability/tierb-validator.ts', 'posture-ai-tierb-validator-v1-r4-pr10', '15b163ab46fb2866456bb77d72523f1885f3bda774c519738f20422c16b6523d'],
  ['scripts/check-tierb-reliability.ts', 'posture-ai-tierb-prepared-check-v1-r2-pr10', 'f1ce2421188156d49b283fba8706133257fe2347c7afc62f3bbd0cdaf0f541a0'],
  ['scripts/golden-repeatability-core.ts', 'posture-ai-tierb-analysis-input-adapter-v1-r2-pr10', 'd171c790b2a887590418910fbe2f559275d2709da610f4cdd852d4f560c3901f'],
  ['scripts/golden-repeatability.ts', 'posture-ai-tierb-analysis-runner-v2-r2-pr10', '02d6dad4d7426c4a0a13c680a91e46b83a67d507450ecbc004b19ba373ef3e02'],
  ['scripts/golden-model-compare-core.mjs', 'posture-ai-tierb-model-switch-guard-v2-pr10', '4a2ffed827d9838b4561db06cde3d4f6b407204aeee7b5070fe03876c8b96543'],
  ['scripts/golden-model-compare.mjs', 'posture-ai-tierb-model-switch-cli-v1-pr10', 'cd7424ad6ae73c2b84e53d95572c694a95795812acf39a46698cd0a3eed54a33'],
]
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

export function performanceBudgetSources() {
  return [
    { path: 'docs/qa/performance-budgets.json', id: PERFORMANCE_BUDGET_SOURCE_ID, sha256: PERFORMANCE_BUDGET_SOURCE_SHA256 },
    { path: 'docs/qa/performance-budgets.schema.json', id: PERFORMANCE_BUDGET_SCHEMA_SOURCE_ID, sha256: PERFORMANCE_BUDGET_SCHEMA_SOURCE_SHA256 },
    { path: 'scripts/check-performance-budgets.mjs', id: PERFORMANCE_BUDGET_VALIDATOR_SOURCE_ID, sha256: PERFORMANCE_BUDGET_VALIDATOR_SOURCE_SHA256 },
  ]
}

export function tierBDocumentSources() {
  return TIER_B_DOCUMENT_SOURCES.map(([path, id, sha256]) => ({ path, id, sha256 }))
}

export function tierBRuntimeSources() {
  return TIER_B_RUNTIME_SOURCES.map(([path, id, sha256]) => ({ path, id, sha256 }))
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

export function upsertImmutableEntireFileContract(contracts, path, id, bytes, expectedSha256) {
  const idOwner = contracts.find(row => row.id === id && row.path !== path)
  if (idOwner) throw new Error(`Immutable source contract ID ${id} already belongs to ${idOwner.path}`)
  const nextHash = sha256(bytes)
  if (nextHash !== expectedSha256) {
    throw new Error(`Immutable source contract ${path} bytes changed under ${id}; bump the source ID and frozen hash before regeneration`)
  }
  const existing = contracts.find(row => row.path === path)
  if (existing?.id === id && existing.sha256 !== nextHash) {
    throw new Error(`Immutable source contract ${path} changed under ${id}; bump the source ID before regeneration`)
  }
  if (existing?.id === id) {
    if (existing.hash_algorithm !== 'sha256' || existing.hash_scope !== 'entire_file') {
      throw new Error(`Immutable source contract ${path} has invalid hash metadata`)
    }
    return
  }
  const next = existing ?? {}
  next.hash_algorithm = 'sha256'
  next.hash_scope = 'entire_file'
  next.id = id
  next.path = path
  next.sha256 = nextHash
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

  for (const source of tierBDocumentSources()) {
    upsertImmutableEntireFileContract(manifest.source_contracts, source.path, source.id, readFileSync(resolve(ROOT, source.path), 'utf8'), source.sha256)
  }
  for (const source of performanceBudgetSources()) {
    upsertImmutableEntireFileContract(manifest.source_contracts, source.path, source.id, readFileSync(resolve(ROOT, source.path), 'utf8'), source.sha256)
  }

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
  for (const source of tierBRuntimeSources()) {
    upsertImmutableEntireFileContract(sourceInventory.runtime_source_contracts, source.path, source.id, readFileSync(resolve(ROOT, source.path), 'utf8'), source.sha256)
  }
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

import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  bindSourceInventoryHash,
  derivePr17RequiredCommands,
  deviceEvidenceRuntimeSources,
  parsePlaywrightList,
  performanceBudgetSources,
  tierBDocumentSources,
  tierBRuntimeSources,
  upsertImmutableEntireFileContract,
} from './generate-production-readiness-inventory.mjs'

describe('production-readiness inventory generator', () => {
  it('derives ordered project counts, unique files, and a stable test-id hash', () => {
    const stdout = [
      'Listing tests:',
      '  [setup] › e2e/auth.setup.ts:10:1 › authenticate',
      '  [desktop-chromium] › e2e/a11y.spec.ts:20:1 › accessibility › sign in',
      '  [mobile-webkit] › e2e/a11y.spec.ts:20:1 › accessibility › sign in',
      '  [android-chromium-proxy] › e2e/device-accessibility-harness.spec.ts:10:1 › keyboard',
    ].join('\n')

    const first = parsePlaywrightList(stdout)
    const second = parsePlaywrightList(stdout)
    expect(first).toEqual(second)
    expect(first).toMatchObject({
      project_order: ['setup', 'desktop-chromium', 'mobile-webkit', 'android-chromium-proxy'],
      projects: { setup: 1, 'desktop-chromium': 1, 'mobile-webkit': 1, 'android-chromium-proxy': 1 },
      expected_total: 4,
      expected_files: 3,
      test_ids_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })

  it('fails closed when Playwright produces no parseable rows', () => {
    expect(() => parsePlaywrightList('Listing tests:\nTotal: 0 tests')).toThrow(/no parseable tests/i)
  })

  it('accepts an already-current embedded inventory hash and rejects a missing marker', () => {
    const hash = 'a'.repeat(64)
    const checker = `const SOURCE_INVENTORY_HASH = '${hash}'\n`

    expect(bindSourceInventoryHash(checker, hash)).toBe(checker)
    expect(() => bindSourceInventoryHash('const OTHER_HASH = 1\n', hash)).toThrow(/Could not locate/)
    expect(() => bindSourceInventoryHash(checker, 'not-a-hash')).toThrow(/invalid/)
  })

  it('derives the frozen PR-17 command set from both CI command lists', () => {
    expect(derivePr17RequiredCommands({
      global_commands: ['npm run lint', 'npm run readiness:inventory'],
      pr17_additional_commands: ['npm run test:critical-contracts'],
    })).toEqual([
      'npm run lint',
      'npm run readiness:inventory',
      'npm run test:critical-contracts',
    ])
    expect(() => derivePr17RequiredCommands({ global_commands: [] })).toThrow(/invalid/)
  })

  it('pins the device contract, executable validator, and strict schema as runtime sources', () => {
    expect(deviceEvidenceRuntimeSources()).toEqual([
      { path: 'docs/qa/device-release-contract.json', id: 'posture-ai-device-release-contract-2026-07-21-pr08' },
      { path: 'scripts/check-device-evidence.mjs', id: 'posture-ai-device-evidence-validator-2026-07-21-pr08' },
      { path: 'docs/qa/device-evidence.schema.json', id: 'posture-ai-device-evidence-schema-2026-07-21-pr08' },
    ])
  })

  it('pins the PR-09 performance contract, strict schema, and read-only validator', () => {
    expect(performanceBudgetSources()).toEqual([
      { path: 'docs/qa/performance-budgets.json', id: 'posture-ai-performance-budgets-v6-2026-07-22-pr09', sha256: '13d2331f4fa4fe11fe98b9a98fbb631ac734040ef54a0ef2af6137bc98f46b74' },
      { path: 'docs/qa/performance-budgets.schema.json', id: 'posture-ai-performance-budgets-schema-v6-2026-07-22-pr09', sha256: '159d652df8b9b070681a5a49aa88d385ea6d6505d8d739311c6fe753fa26aa94' },
      { path: 'scripts/check-performance-budgets.mjs', id: 'posture-ai-performance-budgets-validator-v7-2026-07-22-pr09', sha256: 'de8d6504c9953ec3563c63ce0c5946d627310df47e711967c7febac66098bb9a' },
    ])
  })

  it('pins the complete PR-10 reliability authority and runtime surface', () => {
    expect(tierBDocumentSources().map((source) => source.path)).toEqual([
      'docs/qa/AUDIT.md',
      'docs/plans/2026-07-19-production-readiness-goal-spec.md',
      'docs/qa/tierb-reliability/protocol.md',
      'docs/qa/tierb-reliability/prepared.packet.json',
      'docs/qa/tierb-reliability/trust-policy.json',
      'docs/qa/tierb-reliability/trust-policy.pin.json',
      'docs/qa/tierb-reliability/schemas/prepared-packet.schema.json',
      'docs/qa/tierb-reliability/schemas/trust-policy.schema.json',
      'docs/qa/tierb-reliability/schemas/analysis-input.schema.json',
      'docs/qa/tierb-reliability/schemas/collection-manifest.schema.json',
    ])
    expect(tierBRuntimeSources().map((source) => source.path)).toEqual([
      'lib/pose/tierb-contract.ts',
      'packages/posture-engine/src/reliability.ts',
      'lib/reliability/tierb-analysis.ts',
      'lib/reliability/tierb-canonical.ts',
      'lib/reliability/tierb-validator.ts',
      'scripts/check-tierb-reliability.ts',
      'scripts/golden-repeatability-core.ts',
      'scripts/golden-repeatability.ts',
      'scripts/golden-model-compare-core.mjs',
      'scripts/golden-model-compare.mjs',
    ])
    expect([
      ...tierBDocumentSources(),
      ...tierBRuntimeSources(),
    ]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: expect.stringMatching(/pr10$/),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]))
  })

  it('fails a same-ID performance source mutation and accepts only a bumped ID', () => {
    const path = 'docs/qa/performance-budgets.json'
    const contracts: Array<Record<string, unknown>> = []
    const v1Hash = createHash('sha256').update('v1 bytes').digest('hex')
    const v2Hash = createHash('sha256').update('mutated bytes').digest('hex')
    upsertImmutableEntireFileContract(contracts, path, 'performance-v1', 'v1 bytes', v1Hash)
    expect(() => upsertImmutableEntireFileContract(contracts, path, 'performance-v1', 'mutated bytes', v1Hash)).toThrow(/bump.*ID/i)
    upsertImmutableEntireFileContract(contracts, path, 'performance-v2', 'mutated bytes', v2Hash)
    expect(contracts).toEqual([expect.objectContaining({ id: 'performance-v2', path })])
  })

  it('accepts unchanged bytes under the existing immutable performance source ID', () => {
    const contracts: Array<Record<string, unknown>> = []
    const hash = createHash('sha256').update('same bytes').digest('hex')
    upsertImmutableEntireFileContract(contracts, 'docs/qa/performance-budgets.json', 'performance-v1', 'same bytes', hash)
    expect(() => upsertImmutableEntireFileContract(contracts, 'docs/qa/performance-budgets.json', 'performance-v1', 'same bytes', hash)).not.toThrow()
  })
})

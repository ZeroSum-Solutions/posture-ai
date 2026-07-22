import { describe, expect, it } from 'vitest'

import {
  bindSourceInventoryHash,
  derivePr17RequiredCommands,
  deviceEvidenceRuntimeSources,
  parsePlaywrightList,
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
})

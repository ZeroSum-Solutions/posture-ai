import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

type DeviceContract = {
  core_journey: string[]
  required_views: string[]
  matrix_rows: Array<{ id: string }>
}

describe('PR-08 release-harness coherence', () => {
  it('retains sanitized Playwright and Axe receipts on CI success and failure', () => {
    const workflow = read('.github/workflows/ci.yml')
    const config = read('playwright.config.ts')
    const reporter = read('scripts/playwright-receipt-reporter.mjs')
    const sanitizer = read('scripts/playwright-receipt-sanitize.cjs')

    expect(workflow).toMatch(/name:\s*playwright-accessibility-receipts/)
    expect(workflow).toMatch(/if:\s*always\(\)/)
    expect(workflow).toContain('test-results/playwright-results.json')
    expect(workflow).toContain('test-results/a11y-receipts/')
    expect(config).toContain("outputFile: 'test-results/playwright-results.json'")
    expect(config).toContain("a11yOutputDir: 'test-results/a11y-receipts'")
    expect(sanitizer).toContain('physical_device_evidence')
    expect(reporter).not.toMatch(/stdout:\s|stderr:\s|attachments:\s|errors:\s/)
  })

  it('mechanically binds the canonical checklist to every contract row', () => {
    const contract = JSON.parse(read('docs/qa/device-release-contract.json')) as DeviceContract
    const checklist = read('docs/qa/device-evidence-checklist.md')

    for (const id of contract.core_journey) expect(checklist).toContain(`\`${id}\``)
    for (const view of contract.required_views) expect(checklist).toContain(`\`${view}\``)
    for (const { id } of contract.matrix_rows) expect(checklist).toContain(`\`${id}\``)

    for (const legacyTelemetryRow of [
      'worker ready p95',
      'inference p95',
      'long tasks',
      'dropped ui frames',
      'memory / context loss',
    ]) expect(checklist.toLowerCase()).toContain(legacyTelemetryRow)
  })

  it('points release documentation at the canonical checklist and removes the PR-08 Axe skip', () => {
    const canonical = 'docs/qa/device-evidence-checklist.md'
    for (const path of ['docs/RUNBOOK.md', 'docs/qa/AUDIT.md', 'docs/qa/INVENTORY.md', 'e2e/README.md']) {
      expect(read(path), `${path} must point to the canonical checklist`).toContain(canonical)
    }

    const manifest = JSON.parse(read('docs/qa/production-readiness-manifest.json')) as {
      e2e: { approved_skips: Array<{ key: string }> }
    }
    expect(manifest.e2e.approved_skips.map(({ key }) => key)).not.toContain('skip:a11y:mobile-webkit')
  })
})

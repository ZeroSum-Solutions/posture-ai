import AxeBuilder from '@axe-core/playwright'
import type { Page, TestInfo } from '@playwright/test'
import receiptSanitizer from '../scripts/playwright-receipt-sanitize.cjs'

const { buildAxeReceipt, stableJson } = receiptSanitizer

export async function analyzeAndAttachAxe(page: Page, testInfo: TestInfo, surface: string) {
  const results = await new AxeBuilder({ page }).analyze()
  const receipt = buildAxeReceipt({
    project: testInfo.project.name,
    surface,
    path: new URL(page.url()).pathname,
    violations: results.violations,
  })
  await testInfo.attach(`axe-${surface.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, {
    body: Buffer.from(stableJson(receipt)),
    contentType: 'application/json',
  })
  return results
}

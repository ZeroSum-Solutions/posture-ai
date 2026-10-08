import AxeBuilder from '@axe-core/playwright'
import type { Page, TestInfo } from '@playwright/test'
import receiptSanitizer from '../scripts/playwright-receipt-sanitize.cjs'

const { buildAxeReceipt, stableJson } = receiptSanitizer

export async function analyzeAndAttachAxe(page: Page, testInfo: TestInfo, surface: string) {
  // Linux WebKit (CI's mobile-webkit) can leave getComputedStyle on <body> stale
  // after a cold production load: custom properties read empty, so a <select>
  // reports black-on-transparent while it paints correctly. Axe reads computed
  // style, so force one restyle of the tree before scanning.
  await page.evaluate(() => {
    const root = document.documentElement
    root.style.setProperty('--axe-restyle', '1')
    void getComputedStyle(document.body).color
    root.style.removeProperty('--axe-restyle')
    void getComputedStyle(document.body).color
  })
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

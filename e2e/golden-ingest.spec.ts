import { test, expect } from '@playwright/test'
import path from 'node:path'

// Dev-only page; e2e's webServer runs next dev, so it is reachable here and
// notFound() in production builds keeps it out of prod.
test.describe('golden ingest page', () => {
  test('detects landmarks from a fixture photo and offers the JSON download', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'WASM-heavy dev tool — chromium only')
    test.setTimeout(240_000)
    await page.goto('/dev/golden-ingest')
    const download = page.waitForEvent('download', { timeout: 200_000 })
    await page.locator('#golden-file').setInputFiles(
      path.join(__dirname, 'fixtures', 'photos', 'front_standing.jpg'),
    )
    const dl = await download
    expect(dl.suggestedFilename()).toBe('front_standing.landmarks.json')
  })
})

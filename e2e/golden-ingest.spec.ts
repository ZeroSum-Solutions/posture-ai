import { test, expect } from '@playwright/test'
import path from 'node:path'

// Dev-only page; reachable under the local `next dev` webServer, while
// notFound() in production builds keeps it out of prod — including CI, which
// serves a production build, so this spec runs locally only.
test.describe('golden ingest page', () => {
  test('detects landmarks from a fixture photo and offers the JSON download', async ({ page, browserName }) => {
    test.skip(!!process.env.CI, 'dev-only page 404s in the production build CI serves')
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

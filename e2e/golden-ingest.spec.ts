import { test, expect } from '@playwright/test'
import path from 'node:path'
import { skipForProductionReadiness } from './production-readiness-skip'

// Dev-only page; reachable under the local `next dev` webServer, while
// notFound() in production builds keeps it out of prod — including CI, which
// serves a production build, so this spec runs locally only.
test.describe('golden ingest page', () => {
  test('detects landmarks from a fixture photo and offers the JSON download', async ({ page, browserName }, testInfo) => {
    skipForProductionReadiness(
      testInfo,
      !!process.env.CI && testInfo.project.name === 'desktop-chromium',
      {
        key: 'skip:golden-ingest:desktop-ci',
        source: 'e2e/golden-ingest.spec.ts::detects landmarks from a fixture photo and offers the JSON download',
        scope: { project: 'desktop-chromium', condition: 'CI=true production build' },
      },
      'dev-only page 404s in the production build CI serves',
    )
    skipForProductionReadiness(
      testInfo,
      browserName !== 'chromium',
      {
        key: 'skip:golden-ingest:mobile-webkit',
        source: 'e2e/golden-ingest.spec.ts::detects landmarks from a fixture photo and offers the JSON download',
        scope: { project: 'mobile-webkit', condition: 'browserName=webkit' },
      },
      'WASM-heavy dev tool — chromium only',
    )
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

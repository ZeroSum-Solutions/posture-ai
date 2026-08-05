import { test, expect } from '@playwright/test'
import { skipForProductionReadiness } from './production-readiness-skip'

// Dev-only page; reachable under the local `next dev` webServer, while
// notFound() in production builds keeps it out of prod — including CI, which
// serves a production build, so this spec runs locally only.
test.describe('golden ingest page', () => {
  test('keeps preparation-only collection locked with all four planned slots', async ({ page }, testInfo) => {
    skipForProductionReadiness(
      testInfo,
      !!process.env.CI,
      {
        key: `skip:golden-ingest:${testInfo.project.name}:ci-production-build`,
        source: 'e2e/golden-ingest.spec.ts::keeps preparation-only collection locked with all four planned slots',
        scope: { project: testInfo.project.name, condition: 'CI=true production build' },
      },
      'dev-only page 404s in the production build CI serves',
    )

    await page.goto('/dev/golden-ingest')

    await expect(page.getByRole('status')).toHaveText('Collection not authorized')
    await expect(page.locator('#golden-file')).toBeDisabled()
    await expect(page.locator('#golden-view')).toBeDisabled()
    await expect(page.locator('#golden-view option')).toHaveCount(4)
    await expect(page.locator('#golden-view option')).toHaveText([
      'Front',
      'Side left',
      'Back',
      'Side right',
    ])
    const goldenViewOptions = page.locator('#golden-view option')
    const goldenViewOptionCount = await goldenViewOptions.count()
    for (let i = 0; i < goldenViewOptionCount; i++) {
      await expect(goldenViewOptions.nth(i)).toHaveAttribute(
        'data-engine-view',
        /^(front|side|back)$/,
      )
    }
    expect(await page.locator('#golden-view option').evaluateAll((options) =>
      options.map((option) => ({
        value: (option as HTMLOptionElement).value,
        engineView: option.getAttribute('data-engine-view'),
        profileSide: option.getAttribute('data-profile-side'),
      })),
    )).toEqual([
      { value: 'front', engineView: 'front', profileSide: 'none' },
      { value: 'side_left', engineView: 'side', profileSide: 'left' },
      { value: 'back', engineView: 'back', profileSide: 'none' },
      { value: 'side_right', engineView: 'side', profileSide: 'right' },
    ])
    await expect(page.getByText('No test flag or local bypass unlocks collection.')).toBeVisible()
  })
})

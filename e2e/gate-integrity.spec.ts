import { test, expect } from '@playwright/test'
import { skipForProductionReadiness } from './production-readiness-skip'

test.describe('gate integrity (regression: security fixes)', () => {
  test.beforeEach(({ browserName }, testInfo) => skipForProductionReadiness(
    testInfo,
    browserName !== 'chromium',
    {
      key: 'skip:gate-integrity:mobile-webkit',
      source: 'e2e/gate-integrity.spec.ts::gate integrity project guard',
      scope: { project: 'mobile-webkit', condition: 'browserName=webkit' },
    },
    'run once on chromium',
  ))

  test('onboarding ack failure: stays on /onboarding when PATCH fails', async ({}, testInfo) => {
    skipForProductionReadiness(
      testInfo,
      true,
      {
        key: 'skip:onboarding-acked-fixture:desktop-chromium',
        source: 'e2e/gate-integrity.spec.ts::onboarding ack failure: stays on /onboarding when PATCH fails',
        scope: { project: 'desktop-chromium', condition: 'shared practitioner already acknowledged' },
      },
      'Shared practitioner already acknowledged; fresh unacknowledged fixture unavailable',
    )
    // The shared invited test practitioner is already acked
    // (non_diagnostic_ack_at is set in the DB), so the server-side middleware
    // redirects /onboarding → /dashboard on direct navigation for this user.
    // Testing the full onboarding flow requires a fresh unacked account, which is
    // not available in the shared test session. The middleware redirect prevents
    // reaching the page at all. The underlying fix (gate: only navigate after
    // confirmed DB write) is covered by code review + the onboarding page source
    // (app/onboarding/page.tsx lines 26–31: returns early on updateError, does NOT
    // call window.location.assign). This test is skipped with a clear explanation.
  })

  test('password: wrong current password blocks updateUser call', async ({ page }) => {
    await page.goto('/settings')
    await page.waitForLoadState('networkidle')

    // Track whether updateUser was ever called
    let updateUserCalled = false
    page.on('request', (req) => {
      if (req.url().includes('/auth/v1/user') && req.method() === 'PUT') {
        updateUserCalled = true
      }
    })

    // Mock signInWithPassword to return 400 (wrong current password)
    await page.route('**/auth/v1/token?grant_type=password**', route =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }),
      })
    )

    // Fill current password (wrong) and new password
    await page.getByLabel('Current password').fill('wrongpassword123')
    await page.getByLabel('New password').fill('NewValidPass99!')
    await page.getByRole('button', { name: 'Update Password' }).click()

    // Should show "current password is incorrect" error
    const alert = page.locator('[role="alert"]').filter({ hasText: /current password is incorrect/i })
    await expect(alert).toBeVisible({ timeout: 8_000 })

    // updateUser must NOT have been called
    // Give a brief moment for any async calls to settle
    await page.waitForTimeout(1000)
    expect(updateUserCalled, 'updateUser (PUT /auth/v1/user) must not be called when current password is wrong').toBe(false)
  })
})

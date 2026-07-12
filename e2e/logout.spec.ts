import { test, expect } from '@playwright/test'

const TEST_EMAIL = 'testpractitioner@postureai.test'
const TEST_PASSWORD = 'TestPass1234!'

// Logout via the primary nav control (components/NavBar.tsx → client-side
// supabase.auth.signOut() then router.push('/auth/sign-in')). The app signs out
// with the default GLOBAL scope, which GoTrue invalidates server-side
// immediately (not just at JWT expiry), so it would poison the shared
// practitioner session that every other spec loads from e2e/.auth/user.json.
// To stay isolated, this spec re-signs-in and re-saves that storage state in
// afterEach — which also runs on failure, so a logout failure never cascades
// into the rest of the suite.
//
// Responsive: desktop shows a visible "Sign out" button; the mobile (webkit)
// layout hides it behind the hamburger menu, so open that first.
test.describe('logout', () => {
  test('signing out clears the session and returns to sign-in', async ({ page }) => {
    await page.goto('/dashboard')
    // Sanity: we start authenticated (dashboard did not bounce to sign-in).
    await expect(page).toHaveURL(/\/dashboard/)

    const hamburger = page.getByRole('button', { name: 'Toggle navigation menu' })
    if (await hamburger.isVisible().catch(() => false)) {
      await hamburger.click()
    }
    await page.getByRole('button', { name: 'Sign out' }).click()

    await page.waitForURL(/\/auth\/sign-in/, { timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

    // The session is truly gone: a protected page now bounces back to sign-in.
    await page.goto('/dashboard')
    await page.waitForURL(/\/auth\/sign-in/, { timeout: 15_000 })
  })

  // Re-establish the shared session the global sign-out revoked, and re-save the
  // storage state so later specs keep a valid session. Mirrors auth.setup.ts.
  test.afterEach(async ({ page }) => {
    await page.goto('/auth/sign-in')
    await page.locator('input[type="email"]').fill(TEST_EMAIL)
    await page.locator('input[type="password"]').fill(TEST_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/sign-in'), { timeout: 15_000 })
    if (page.url().includes('/onboarding')) {
      await page.getByRole('checkbox').check()
      await page.getByRole('button', { name: 'I Acknowledge and Continue' }).click()
      await page.waitForURL((url) => !url.pathname.startsWith('/onboarding'), { timeout: 15_000 })
    }
    await page.context().storageState({ path: 'e2e/.auth/user.json' })
  })
})

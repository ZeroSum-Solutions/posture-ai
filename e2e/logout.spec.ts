import { test, expect } from '@playwright/test'
import { restoreSharedPractitionerSession } from './helpers/shared-practitioner-session'

// Logout via the Settings screen (app/settings/page.tsx → a plain
// `<form action="/api/auth/sign-out" method="POST">`; app/api/auth/sign-out/route.ts
// calls the server-side supabase.auth.signOut()). The app signs out with the
// default GLOBAL scope, which GoTrue invalidates server-side immediately (not
// just at JWT expiry), so it would poison the shared practitioner session that
// every other spec loads from e2e/.auth/user.json. To stay isolated, this spec
// restores that storage state in afterEach (restoreSharedPractitionerSession),
// which also runs on failure, so a logout failure never cascades into the rest
// of the suite.
//
// The island nav (components/array/IslandNav.tsx) is the only navigation now;
// it carries no sign-out control of its own, only a "Profile" slot linking to
// /settings, where the sign-out button lives on every viewport.
test.describe('logout', () => {
  test('signing out invalidates the practitioner session in both open tabs', async ({ page, context }) => {
    await page.goto('/dashboard')
    // Sanity: we start authenticated (dashboard did not bounce to sign-in).
    await expect(page).toHaveURL(/\/dashboard/)

    const secondTab = await context.newPage()
    await secondTab.goto('/dashboard')
    await expect(secondTab).toHaveURL(/\/dashboard/)

    await page.goto('/settings')
    await page.getByRole('button', { name: 'Sign Out' }).click()

    await page.waitForURL(/\/auth\/sign-in/, { timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()

    // The session is truly gone: a protected page now bounces back to sign-in.
    await page.goto('/dashboard')
    await page.waitForURL(/\/auth\/sign-in/, { timeout: 15_000 })

    // The second tab held already-rendered protected UI. AuthSessionGuard must
    // clear it from the cross-tab SIGNED_OUT broadcast and redirect without any
    // user navigation; waiting for a later request would leave PHI on screen.
    await secondTab.waitForURL(/\/auth\/sign-in/, { timeout: 15_000 })
    await expect(secondTab.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await secondTab.close()
  })

  // Re-establish the shared session the global sign-out revoked, and re-save the
  // storage state so later specs keep a valid session.
  test.afterEach(async ({ browser }, testInfo) => {
    await restoreSharedPractitionerSession(browser, testInfo.project.use.baseURL)
  })
})

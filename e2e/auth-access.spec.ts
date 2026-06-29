import { test, expect } from '@playwright/test'

// Unauthenticated access guard. There is no middleware; protected surfaces guard
// themselves — server components call supabase.auth.getUser() + redirect()
// (e.g. app/dashboard/page.tsx), client components push window.location to
// /auth/sign-in (e.g. app/clients/page.tsx). This spec runs WITHOUT the shared
// authenticated storageState to prove both styles actually bounce to sign-in.
test.describe('unauthenticated access', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const path of ['/dashboard', '/clients']) {
    test(`${path} while signed out redirects to sign-in`, async ({ page }) => {
      await page.goto(path)
      await page.waitForURL(/\/auth\/sign-in/, { timeout: 15_000 })
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    })
  }
})

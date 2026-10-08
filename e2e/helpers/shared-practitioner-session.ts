import type { Browser } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { totpCode } from '../../scripts/testing/totp'

const PRACTITIONER_FIXTURE = 'e2e/.auth/practitioner.json'
const SHARED_STORAGE_STATE = 'e2e/.auth/user.json'

/**
 * Every project loads the one practitioner session that auth.setup.ts saved to
 * e2e/.auth/user.json. The app signs out with GoTrue's default GLOBAL scope, so
 * a spec that clicks "Sign out" revokes that shared session server-side and
 * every later spec gets 401s or sign-in redirects.
 *
 * A spec that signs the shared practitioner out must call this afterwards (in
 * afterEach, so it also runs on failure). It signs in again through the real
 * UI and MFA challenge in a clean context and re-saves the shared state. It
 * never touches the signed-out context, so the spec's own assertions about the
 * sign-out stay intact.
 */
export async function restoreSharedPractitionerSession(browser: Browser, baseURL: string | undefined) {
  const fixture = JSON.parse(await readFile(PRACTITIONER_FIXTURE, 'utf8')) as {
    email: string
    password: string
    secret: string
  }
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    const page = await context.newPage()
    await page.goto('/auth/sign-in')
    await page.locator('input[type="email"]').fill(fixture.email)
    await page.locator('input[type="password"]').fill(fixture.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    // GitHub-hosted runners are slower than the former Blacksmith runners;
    // give each redirect extra headroom.
    await page.waitForURL(/\/auth\/mfa/, { timeout: 25_000 })
    await page.getByLabel('Authenticator code').fill(totpCode(fixture.secret))
    await page.getByRole('button', { name: 'Verify and continue' }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/'), { timeout: 25_000 })
    // Array v3: one document per step, each advanced by the same sticky
    // "I agree" button; the third click submits acceptance.
    if (page.url().includes('/onboarding')) {
      for (let step = 0; step < 3; step += 1) {
        await page.getByRole('button', { name: 'I agree' }).click()
      }
      await page.waitForURL((url) => !url.pathname.startsWith('/onboarding'), { timeout: 25_000 })
    }
    await context.storageState({ path: SHARED_STORAGE_STATE })
  } finally {
    await context.close()
  }
}

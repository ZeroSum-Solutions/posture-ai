import { test as setup, expect } from '@playwright/test'

const TEST_EMAIL = 'testpractitioner@postureai.test'
const TEST_PASSWORD = 'TestPass1234!'

// Creates (or reuses) the confirmed test practitioner, signs in through the
// real UI, acknowledges the screening disclaimer if prompted, and saves the
// session for all other projects.
setup('authenticate test practitioner', async ({ page, request }) => {
  const res = await request.get('/api/dev/create-test-user')
  expect(res.ok(), 'create-test-user must succeed (dev/test env only)').toBeTruthy()

  await page.goto('/auth/sign-in')
  await page.locator('input[type="email"]').fill(TEST_EMAIL)
  await page.locator('input[type="password"]').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await page.waitForURL((url) => !url.pathname.startsWith('/auth/sign-in'), { timeout: 15_000 })

  // First sign-in lands on the non-diagnostic acknowledgement gate.
  if (page.url().includes('/onboarding')) {
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'I Acknowledge and Continue' }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/onboarding'), { timeout: 15_000 })
  }

  await page.context().storageState({ path: 'e2e/.auth/user.json' })
})

import { test as setup } from '@playwright/test'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

const TEST_EMAIL = 'testpractitioner@postureai.test'
const TEST_PASSWORD = 'TestPass1234!'

// Creates (or reuses) the confirmed test practitioner via the local stack's
// service-role admin API — the /api/dev/ seeding route is auth-gated in
// production builds, which CI serves (`next start`). Then signs in through the
// real UI, acknowledges the screening disclaimer if prompted, and saves the
// session for all other projects.
setup('authenticate test practitioner', async ({ page }) => {
  const supabaseUrl = process.env.E2E_SUPABASE_URL
  if (!supabaseUrl?.startsWith('http://127.0.0.1')) {
    throw new Error('E2E user seeding requires local Supabase at 127.0.0.1')
  }
  const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) throw new Error('E2E_SUPABASE_SERVICE_ROLE_KEY is required')

  const admin = createSupabaseClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  })
  // The practitioners row is auto-created by DB trigger; reruns hit email_exists.
  if (error && !/already/i.test(error.message)) {
    throw new Error(`test-user seeding failed: ${error.message}`)
  }

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

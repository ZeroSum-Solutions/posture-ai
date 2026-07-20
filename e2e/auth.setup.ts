import { test as setup } from '@playwright/test'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { activateLocalPractitionerAal2, provisionLocalInvitedPractitioner } from './helpers/practitioner-auth'
import { totpCode } from '../scripts/testing/totp'

const TEST_PASSWORD = 'TestPass1234!'

// Rebuilds the local practitioner through the same invitation authority used by
// operators, activates it only after a real AAL2 session, then signs in through
// the UI and completes the MFA challenge. The saved browser state is therefore
// an active invited practitioner at AAL2, never a trigger-created AAL1 bypass.
setup('authenticate test practitioner', async ({ page }) => {
  const testEmail = `testpractitioner+${Date.now()}-${process.pid}@postureai.test`
  const supabaseUrl = process.env.E2E_SUPABASE_URL
  if (!supabaseUrl?.startsWith('http://127.0.0.1')) {
    throw new Error('E2E user seeding requires local Supabase at 127.0.0.1')
  }
  const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) throw new Error('E2E_SUPABASE_SERVICE_ROLE_KEY is required')
  const anonKey = process.env.E2E_SUPABASE_ANON_KEY
  if (!anonKey) throw new Error('E2E_SUPABASE_ANON_KEY is required')

  const admin = createSupabaseClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  await provisionLocalInvitedPractitioner({
    admin,
    supabaseUrl,
    email: testEmail,
    password: TEST_PASSWORD,
  })

  const fixtureClient = createSupabaseClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error: fixtureSignInError } = await fixtureClient.auth.signInWithPassword({
    email: testEmail,
    password: TEST_PASSWORD,
  })
  if (fixtureSignInError) throw fixtureSignInError
  const mfaSecret = await activateLocalPractitionerAal2(fixtureClient)
  await fixtureClient.auth.signOut({ scope: 'global' })

  await mkdir('e2e/.auth', { recursive: true })
  await writeFile(
    'e2e/.auth/practitioner.json',
    `${JSON.stringify({ email: testEmail, password: TEST_PASSWORD, secret: mfaSecret })}\n`,
    { mode: 0o600 },
  )

  await page.goto('/auth/sign-in')
  await page.locator('input[type="email"]').fill(testEmail)
  await page.locator('input[type="password"]').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await page.waitForURL(/\/auth\/mfa/, { timeout: 15_000 })
  await page.getByLabel('Authenticator code').fill(totpCode(mfaSecret))
  await page.getByRole('button', { name: 'Verify and continue' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/'), { timeout: 15_000 })

  // First sign-in lands on the non-diagnostic acknowledgement gate.
  if (page.url().includes('/onboarding')) {
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Accept and Continue' }).click()
    await page.waitForURL((url) => !url.pathname.startsWith('/onboarding'), { timeout: 15_000 })
  }

  await page.context().storageState({ path: 'e2e/.auth/user.json' })
})

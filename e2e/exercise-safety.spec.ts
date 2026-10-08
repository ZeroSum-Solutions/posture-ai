import { test, expect } from '@playwright/test'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient, selectClientInWizard } from './helpers'

// Exercise selection ORs over the client's finding keys, so an exercise coherent for
// finding A can still reach a client who also presents finding B. seated-hamstring-stretch
// is indicated for trunk_lean but contraindicated for knee_extension_back_knee: in a
// hyperextended knee the hamstrings are already abnormally long (PMID 20308923).
//
// The fixture assessment screens trunk_lean at warning and the back knee at maintain, so
// the same assessment gives us both halves of the rule — a maintain-zone knee is a negative
// screen and must NOT withhold the stretch; escalate that one finding and it must.
const STRETCH = '[data-testid="exercise-item-seated-hamstring-stretch"]'

test('a concurrent back-knee finding withholds the seated hamstring stretch', async ({ page }) => {
  const supabaseUrl = process.env.E2E_SUPABASE_URL
  if (!supabaseUrl?.startsWith('http://127.0.0.1')) {
    throw new Error('this spec mutates findings and requires local Supabase at 127.0.0.1')
  }
  const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) throw new Error('E2E_SUPABASE_SERVICE_ROLE_KEY is required')

  const stamp = Date.now().toString().slice(-7)
  await createClient(page, 'E2E', `Contra${stamp}`)
  await page.goto('/assessments/new?testMode=1')
  await selectClientInWizard(page, `E2E Contra${stamp}`)
  await page.getByRole('button', { name: 'Run Test Analysis' }).click()
  await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 30_000 })
  const assessmentId = page.url().split('/').pop() as string

  // Fixture screens the back knee at maintain — measured within normal range, so there is
  // no hyperextension to protect against and the stretch is warranted.
  // There is no standalone "Exercises" tab: matched exercises live in the
  // Program tab, behind a "Matched exercises (N)" disclosure; the
  // exercises-section inside it lists the items directly (v4 dropped its
  // own inner disclosure).
  await page.getByRole('tab', { name: /^Program/ }).click()
  await page.locator('summary').filter({ hasText: /^Matched exercises/ }).click()
  await expect(page.locator('[data-testid="exercises-section"]')).toBeVisible()
  await expect(page.locator(STRETCH)).toBeVisible()

  const admin = createSupabaseClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await admin
    .from('assessment_findings')
    .update({ zone: 'danger' })
    .eq('assessment_id', assessmentId)
    .eq('imbalance_key', 'knee_extension_back_knee')
  if (error) throw new Error(`could not escalate the back-knee finding: ${error.message}`)

  await page.reload()

  // trunk_lean still warrants a stretch, so the section stays — but not this one.
  await page.getByRole('tab', { name: /^Program/ }).click()
  await page.locator('summary').filter({ hasText: /^Matched exercises/ }).click()
  await expect(page.locator('[data-testid="exercises-section"]')).toBeVisible()
  await expect(page.locator(STRETCH)).toHaveCount(0)
})

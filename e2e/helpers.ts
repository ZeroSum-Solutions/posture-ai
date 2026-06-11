import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** Creates a client via the authenticated API session and returns it. */
export async function createClient(page: Page, firstName: string, lastName: string) {
  const res = await page.request.post('/api/clients', {
    data: {
      first_name: firstName,
      last_name: lastName,
      consent_recorded_at: new Date().toISOString(),
    },
  })
  expect(res.ok(), `client creation failed: ${res.status()}`).toBeTruthy()
  const body = await res.json()
  return (body.client ?? body) as { id: string; first_name: string; last_name: string }
}

/** Walks wizard step 1: pick the given client and continue to step 2. */
export async function selectClientInWizard(page: Page, fullName: string) {
  await expect(page.getByText(fullName).first()).toBeVisible({ timeout: 10_000 })
  await page.getByText(fullName).first().click()
  await page.getByRole('button', { name: /Next: (Confirm|Upload Views)/ }).click()
}

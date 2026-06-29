import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient } from './helpers'

// Assessment-wizard navigation (app/assessments/new/page.tsx). The wizard is
// step-state in a client component; going Back from step 2 to step 1 must
// preserve the selected client (it lives in component state and is not reset).
// Runs in test mode (?testMode=1) so no MediaPipe model or photo uploads are
// needed — this exercises navigation only.
test.describe('assessment wizard navigation', () => {
  test('Back from step 2 preserves the selected client on step 1', async ({ page }) => {
    const token = randomUUID().slice(0, 8)
    await createClient(page, 'E2E', `Back-${token}`)

    await page.goto('/assessments/new?testMode=1')
    await expect(page.getByRole('heading', { name: 'Step 1: Select Client' })).toBeVisible()

    // Select the client (search narrows past the shared practitioner's other clients).
    await page.getByPlaceholder('Search clients by name...').fill(token)
    await page.getByRole('button', { name: new RegExp(`Back-${token}`) }).click()
    await expect(page.getByText('✓ Selected')).toBeVisible()

    // Advance to step 2.
    await page.getByRole('button', { name: 'Next: Confirm' }).click()
    await expect(page.getByRole('heading', { name: 'Step 2: Confirm Test Mode' })).toBeVisible()

    // Back to step 1 — the selection must persist.
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Step 1: Select Client' })).toBeVisible()
    await expect(page.getByText('✓ Selected')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Next: Confirm' })).toBeEnabled()
  })
})

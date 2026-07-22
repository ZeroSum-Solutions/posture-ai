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
    const client = await createClient(page, 'E2E', `Back-${token}`)

    await page.goto(`/assessments/new?testMode=1&client_id=${client.id}`)
    await expect(page.getByRole('heading', { name: 'Step 1: Select Client' })).toBeVisible()

    // Deep-link the exact client so this spec remains about wizard navigation;
    // bounded server search has its own cross-browser client-list coverage.
    await expect(page.getByTestId('selected-client-summary')).toContainText(`Back-${token}`)

    // Advance to step 2.
    await page.getByRole('button', { name: 'Next: Confirm' }).click()
    await expect(page.getByRole('heading', { name: 'Step 2: Confirm Test Mode' })).toBeVisible()

    // Back to step 1 — the selection must persist.
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Step 1: Select Client' })).toBeVisible()
    await expect(page.getByTestId('selected-client-summary')).toContainText(`Back-${token}`)
    await expect(page.getByRole('button', { name: 'Next: Confirm' })).toBeEnabled()
  })

  test('abandoning the wizard at step 2 creates no assessment', async ({ page }) => {
    const token = randomUUID().slice(0, 8)
    const client = await createClient(page, 'E2E', `Abandon-${token}`)

    await page.goto(`/assessments/new?testMode=1&client_id=${client.id}`)
    await expect(page.getByTestId('selected-client-summary')).toContainText(`Abandon-${token}`)
    await page.getByRole('button', { name: 'Next: Confirm' }).click()
    await expect(page.getByRole('heading', { name: 'Step 2: Confirm Test Mode' })).toBeVisible()

    // Leave the wizard without running the analysis (no unsaved-changes guard).
    await page.getByRole('link', { name: /Back to Clients/ }).click()
    await page.waitForURL(/\/clients$/, { timeout: 15_000 })

    // No assessment was created for the client we abandoned on. Assert via the
    // wizard's own data API (deterministic; avoids a webkit client-side getUser
    // race when chaining /clients -> /clients/[id] navigations).
    const res = await page.request.get(`/api/clients/${client.id}/assessments`)
    expect(res.ok(), `assessments fetch failed: ${res.status()}`).toBeTruthy()
    const json = await res.json()
    expect(json.assessments ?? []).toHaveLength(0)
  })
})

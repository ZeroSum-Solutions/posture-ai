import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient } from './helpers'

test.describe('error states (regression: silent-swallow fixes)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'run once on chromium')

  test('client detail: assessments 500 shows alert not empty-state', async ({ page }) => {
    const client = await createClient(page, 'E2E', `ErrAssess-${randomUUID().slice(0, 8)}`)
    await page.route(`**/api/clients/${client.id}/assessments**`, route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server error' }) })
    )
    await page.goto(`/clients/${client.id}`)
    // Wait for the error to appear (the assessments fetch is async after client loads)
    const alert = page.locator('[role="alert"]').filter({ hasText: /could not load/i })
    await expect(alert).toBeVisible({ timeout: 10_000 })
    // Must NOT show the "No assessments yet" empty state
    await expect(page.getByText(/No assessments yet/)).toHaveCount(0)
  })

  test('archive failure: dialog stays interactive and shows error', async ({ page }) => {
    const client = await createClient(page, 'E2E', `ErrArchive-${randomUUID().slice(0, 8)}`)
    await page.goto(`/clients/${client.id}`)
    await expect(page.getByRole('heading', { name: new RegExp(client.last_name) })).toBeVisible()

    // Set up route BEFORE clicking to archive
    await page.route(`**/api/clients/${client.id}`, route => {
      if (route.request().method() === 'PATCH') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server error' }) })
      }
      return route.continue()
    })

    await page.getByRole('button', { name: 'Archive Client' }).click()
    await expect(page.getByRole('heading', { name: 'Archive Client?' })).toBeVisible()
    await page.getByRole('button', { name: 'Yes, Archive' }).click()

    // Error alert appears
    const alert = page.locator('[role="alert"]').filter({ hasText: /could not archive/i })
    await expect(alert).toBeVisible({ timeout: 8_000 })
    // Dialog buttons still present (dialog stays interactive, not closed)
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Yes, Archive' })).toBeVisible()
  })

  test('wizard step 1: clients 500 shows error not empty-state', async ({ page }) => {
    await page.route('**/rest/v1/clients**', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server error' }) })
    )
    await page.goto('/assessments/new?testMode=1')
    const alert = page.locator('[role="alert"]').filter({ hasText: /could not load your clients/i })
    await expect(alert).toBeVisible({ timeout: 10_000 })
    // Must NOT show the "No clients yet" empty state
    await expect(page.getByText(/No clients yet/)).toHaveCount(0)
  })

  test('assessment results: exercises 500 shows aux error alert', async ({ page }) => {
    const client = await createClient(page, 'E2E', `ErrExercises-${randomUUID().slice(0, 8)}`)
    const res = await page.request.post('/api/assessments', { data: { client_id: client.id, test_mode: true } })
    expect(res.ok(), `assessment create failed: ${res.status()}`).toBeTruthy()
    const assessmentId = (await res.json()).id as string

    // Route exercises to 500 before navigating
    await page.route('**/api/exercises**', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server error' }) })
    )
    await page.goto(`/assessments/${assessmentId}`)
    const alert = page.locator('[role="alert"]').filter({ hasText: /could not load|report options/i })
    await expect(alert).toBeVisible({ timeout: 15_000 })
  })

  test('report error has role=alert', async ({ page }) => {
    const client = await createClient(page, 'E2E', `ErrPdf-${randomUUID().slice(0, 8)}`)
    const res = await page.request.post('/api/assessments', { data: { client_id: client.id, test_mode: true } })
    expect(res.ok(), `assessment create failed: ${res.status()}`).toBeTruthy()
    const assessmentId = (await res.json()).id as string
    // Approve so PDF gate doesn't block
    await page.request.patch(`/api/assessments/${assessmentId}/approve`, { data: { approved: true } })

    await page.goto(`/assessments/${assessmentId}`)
    // Wait for results to load
    await page.waitForSelector('[data-testid^="finding-card-"]', { timeout: 15_000 })

    await page.route('**/api/reports**', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'PDF generation failed' }) })
    )

    await page.getByRole('button', { name: /PDF/i }).first().click()
    // pdfError has role="alert"
    const errEl = page.locator('[role="alert"]').filter({ hasText: /PDF|failed|generation/i })
    await expect(errEl).toBeVisible({ timeout: 8_000 })
  })

  test('settings: org fetch 500 shows error toast/alert', async ({ page }) => {
    await page.route('**/api/settings/organization**', route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server error' }) })
      }
      return route.continue()
    })
    await page.goto('/settings')
    const alert = page.locator('[role="alert"]')
    await expect(alert).toBeVisible({ timeout: 10_000 })
  })
})

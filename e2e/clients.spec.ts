import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient } from './helpers'

// Client list + search (Required Phase-2 coverage). /clients (app/clients/page.tsx)
// is a client component that fetches the practitioner's non-archived clients and
// filters them in-memory by name. The shared practitioner accumulates clients
// from other specs, so this test asserts only on its OWN two uniquely-tokened
// clients (never an absolute count) and searches a random token that matches
// exactly one of them.
test.describe('client list and search', () => {
  test('lists created clients and filters by name', async ({ page }) => {
    const tokenA = randomUUID().slice(0, 8)
    const tokenB = randomUUID().slice(0, 8)
    await createClient(page, 'E2E', `List-${tokenA}`)
    await createClient(page, 'E2E', `List-${tokenB}`)

    await page.goto('/clients')
    await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible()

    const rowA = page.getByRole('link', { name: new RegExp(`List-${tokenA}`) })
    const rowB = page.getByRole('link', { name: new RegExp(`List-${tokenB}`) })
    await expect(rowA).toBeVisible()
    await expect(rowB).toBeVisible()

    // Typing a token unique to client A narrows the in-memory filter to just A.
    await page.getByPlaceholder('Search clients by name...').fill(tokenA)
    await expect(rowA).toBeVisible()
    await expect(rowB).toHaveCount(0)

    // Clearing the search restores both.
    await page.getByPlaceholder('Search clients by name...').fill('')
    await expect(rowA).toBeVisible()
    await expect(rowB).toBeVisible()
  })
})

// Client archive is the only client-mutation flow the app exposes (there is no
// edit UI, and PATCH /api/clients/[id] accepts only archived_at). Archiving the
// throwaway "victim" client must drop it from the active list (which filters
// archived_at IS NULL); a separately-created "keeper" confirms the list rendered.
test.describe('client archive', () => {
  test('archiving a client removes it from the active list', async ({ page }) => {
    const keepToken = randomUUID().slice(0, 8)
    const archiveToken = randomUUID().slice(0, 8)
    await createClient(page, 'E2E', `Keep-${keepToken}`)
    const victim = await createClient(page, 'E2E', `Archive-${archiveToken}`)

    await page.goto(`/clients/${victim.id}`)
    await expect(page.getByRole('heading', { name: new RegExp(`Archive-${archiveToken}`) })).toBeVisible()

    await page.getByRole('button', { name: 'Archive Client' }).click()
    await expect(page.getByRole('heading', { name: 'Archive Client?' })).toBeVisible()
    await page.getByRole('button', { name: 'Yes, Archive' }).click()

    await page.waitForURL(/\/clients$/, { timeout: 15_000 })
    await expect(page.getByRole('link', { name: new RegExp(`Keep-${keepToken}`) })).toBeVisible()
    await expect(page.getByRole('link', { name: new RegExp(`Archive-${archiveToken}`) })).toHaveCount(0)
  })
})

// Empty state: a freshly-created client (zero assessments) shows the empty
// Assessment History state + the "+ New Assessment" CTA, and — because the
// Progress/Compare trend tabs require >= 2 assessments — those tabs are absent.
// Single clean goto to the detail page (avoids the webkit chained-nav getUser race).
test.describe('client detail empty state', () => {
  test('a client with no assessments shows the empty state and no trend tabs', async ({ page }) => {
    const token = randomUUID().slice(0, 8)
    const client = await createClient(page, 'E2E', `Empty-${token}`)

    await page.goto(`/clients/${client.id}`)
    await expect(page.getByRole('heading', { name: new RegExp(`Empty-${token}`) })).toBeVisible()

    await expect(page.getByText(/No assessments yet/)).toBeVisible()
    await expect(page.getByRole('link', { name: /New Assessment/ })).toBeVisible()

    // Progress/Compare need >= 2 assessments → absent; Assessments/Info always present.
    await expect(page.getByRole('button', { name: 'Assessments' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Info' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Progress' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Compare' })).toHaveCount(0)
  })
})

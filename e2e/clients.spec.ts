import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient } from './helpers'

// On a cold `next dev` server (as on CI) a route compiles on-demand and a
// controlled input can discard a value typed before React hydrates the freshly
// loaded page. Re-fill until the value sticks so a fresh-goto form fill is
// deterministic regardless of hydration timing (this does not loosen any
// assertion — it still requires the exact value to be present).
async function fillField(page: Page, label: string | RegExp, value: string) {
  const field = page.getByLabel(label)
  await expect(field).toBeVisible()
  await expect(async () => {
    await field.fill(value)
    expect(await field.inputValue()).toBe(value)
  }).toPass({ timeout: 15_000 })
}

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

// Client create via the form UI. createClient() (helpers) hits the API directly,
// so the create FORM itself was previously uncovered. This guards the shared
// ClientForm (create mode) + the create-only consent gate after the refactor.
test.describe('client create form', () => {
  test('creates a client via the form and enforces the consent gate', async ({ page }) => {
    const token = randomUUID().slice(0, 8)
    await page.goto('/clients/new')

    await fillField(page, 'First Name', 'E2E')
    await fillField(page, 'Last Name', `Form-${token}`)

    // Consent is required: submitting unchecked shows the error and does not navigate.
    await page.getByRole('button', { name: 'Create Client' }).click()
    await expect(page.getByTestId('error-consent')).toBeVisible()
    await expect(page).toHaveURL(/\/clients\/new$/)

    // With consent checked, it creates and lands on the new client's detail page.
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Create Client' }).click()
    await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: new RegExp(`Form-${token}`) })).toBeVisible()
  })
})

// Client edit reuses the shared ClientForm in edit mode (consent is create-only,
// so it is absent here). Asserts the change renders on the detail page AND
// persists across a reload — a real PATCH round-trip, not just client state.
test.describe('client edit', () => {
  test('editing a client updates its profile and persists', async ({ page }) => {
    const token = randomUUID().slice(0, 8)
    const client = await createClient(page, 'E2E', `Edit-${token}`)

    await page.goto(`/clients/${client.id}`)
    await page.getByRole('link', { name: 'Edit Client' }).click()
    await page.waitForURL(new RegExp(`/clients/${client.id}/edit$`))

    const newToken = randomUUID().slice(0, 8)
    await page.getByLabel('Last Name').fill(`Edited-${newToken}`)
    await page.getByLabel(/Height/).fill('70')
    await page.getByLabel('Notes').fill(`Edited note ${newToken}`)
    await page.getByRole('button', { name: 'Save Changes' }).click()

    // Back on the detail page, header reflects the new name.
    await page.waitForURL(new RegExp(`/clients/${client.id}$`))
    await expect(page.getByRole('heading', { name: new RegExp(`Edited-${newToken}`) })).toBeVisible()

    // Info tab reflects the edited height + notes.
    await page.getByRole('button', { name: 'Info' }).click()
    await expect(page.getByText(`Edited note ${newToken}`)).toBeVisible()
    await expect(page.getByText(/70 in/)).toBeVisible()

    // Persisted: a reload re-fetches from the DB and still shows the edits.
    await page.reload()
    await expect(page.getByRole('heading', { name: new RegExp(`Edited-${newToken}`) })).toBeVisible()
  })
})

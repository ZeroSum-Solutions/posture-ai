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

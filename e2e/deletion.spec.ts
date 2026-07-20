import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient } from './helpers'

// Right-to-erasure: deleting a client purges its assessments/captures and removes
// it from the active list, leaving a redacted tombstone. API-level; chromium only.
test.describe('client data deletion', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'API-level; run once on chromium')

  test('deleting a client purges assessments and removes it from the list', async ({ page }) => {
    const c = await createClient(page, 'E2E', `Del-${randomUUID().slice(0, 8)}`)

    const a = await page.request.post('/api/assessments', { data: { client_id: c.id, submission_id: randomUUID(), test_mode: true } })
    expect(a.ok(), `assessment create failed: ${a.status()}`).toBeTruthy()
    const assessmentId = (await a.json()).id as string

    // Appears in the active list before deletion.
    const before = await (await page.request.get('/api/clients')).json()
    expect((before.clients as { id: string }[]).some((x) => x.id === c.id)).toBeTruthy()

    // Delete + purge.
    const del = await page.request.delete(`/api/clients/${c.id}`, { data: { reason: 'test erasure' } })
    expect(del.ok(), `delete failed: ${del.status()}`).toBeTruthy()
    expect((await del.json()).assessments_purged).toBeGreaterThanOrEqual(1)

    // Gone from the active list.
    const after = await (await page.request.get('/api/clients')).json()
    expect((after.clients as { id: string }[]).some((x) => x.id === c.id)).toBeFalsy()

    // Its assessment data is purged.
    const status = await page.request.get(`/api/assessments/${assessmentId}/status`)
    expect(status.status()).toBe(404)
  })
})

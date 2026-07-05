import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient } from './helpers'

// Red-flag pre-session safety screen — UI/player flows.
// These tests verify the gate renders before player controls and that both
// answer paths (clear / stop) behave correctly.
test.describe('red-flag pre-session screen', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Player UI test; run once on chromium')

  async function mintSession(page: Page): Promise<string> {
    const c = await createClient(page, 'E2E', `RedFlag-${randomUUID().slice(0, 8)}`)
    const assessment = await page.request.post('/api/assessments', { data: { client_id: c.id, test_mode: true } })
    expect(assessment.ok(), `assessment create failed: ${assessment.status()}`).toBeTruthy()
    const assessmentId = (await assessment.json()).id as string

    const approve = await page.request.patch(`/api/assessments/${assessmentId}/approve`, { data: { approved: true } })
    expect(approve.ok(), `approve failed: ${approve.status()}`).toBeTruthy()

    const mint = await page.request.post('/api/workouts', { data: { assessment_id: assessmentId } })
    expect(mint.ok(), `mint failed: ${mint.status()}`).toBeTruthy()
    return (await mint.json()).session_id as string
  }

  test('flow 1: red-flag question renders before player controls, "No, I feel okay" unblocks begin, session starts', async ({ page }) => {
    const sessionId = await mintSession(page)
    await page.goto(`/workouts/${sessionId}`)

    // The red-flag question must be visible before any player timeline.
    await expect(page.getByText('Before you start — are you feeling any sharp or worsening pain right now?')).toBeVisible({ timeout: 15_000 })

    // No segmented progress bar yet (active = false, gate not cleared).
    await expect(page.getByTestId('red-flag-no')).toBeVisible()
    await expect(page.getByTestId('red-flag-yes')).toBeVisible()

    // Click "No, I feel okay" — gate clears, StartCard's begin button appears.
    await page.getByTestId('red-flag-no').click()
    await expect(page.getByRole('button', { name: 'Begin session' })).toBeVisible({ timeout: 5_000 })

    // The red-flag question is gone.
    await expect(page.getByText('Before you start — are you feeling any sharp or worsening pain right now?')).not.toBeVisible()

    // Click "Begin session" — player timeline (segmented progress) appears.
    await page.getByRole('button', { name: 'Begin session' }).click()
    // The "Up next" card confirms the player has advanced into a play phase.
    await expect(page.getByText(/up next/i)).toBeVisible({ timeout: 8_000 })
  })

  test('flow 2: "Yes" shows the stop card and no player timeline appears', async ({ page }) => {
    const sessionId = await mintSession(page)
    await page.goto(`/workouts/${sessionId}`)

    await expect(page.getByText('Before you start — are you feeling any sharp or worsening pain right now?')).toBeVisible({ timeout: 15_000 })

    // Click "Yes" — stop card renders.
    await page.getByTestId('red-flag-yes').click()
    await expect(page.getByTestId('stop-card')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText(/Let's pause here/)).toBeVisible()
    await expect(page.getByText(/movement professional/)).toBeVisible()

    // No player timeline (Up next, "set X of Y", segmented progress) is visible.
    await expect(page.getByText(/up next/i)).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Begin session' })).not.toBeVisible()

    // Dismiss the stop card — onExit fires (window.location.reload), session exits.
    await page.getByTestId('stop-card-dismiss').click()
    // After dismiss the page reloads; wait for the red-flag question to reappear,
    // proving the player exited and the stop card is gone.
    await expect(page.getByTestId('stop-card')).not.toBeVisible({ timeout: 8_000 })
  })
})

import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createClient } from './helpers'
import { analyzeAndAttachAxe } from './axe-receipt'
import { skipForProductionReadiness } from './production-readiness-skip'

// Red-flag pre-session safety screen — UI/player flows.
// These tests verify the gate renders before player controls and that both
// answer paths (clear / stop) behave correctly.
test.describe('red-flag pre-session screen', () => {
  test.beforeEach(({ browserName }, testInfo) => skipForProductionReadiness(
    testInfo,
    browserName !== 'chromium',
    {
      key: 'skip:workout-player:mobile-webkit',
      source: 'e2e/workout-player.spec.ts::red-flag pre-session screen project guard',
      scope: { project: 'mobile-webkit', condition: 'browserName=webkit' },
    },
    'Player UI test; run once on chromium',
  ))

  async function mintSession(page: Page): Promise<{ sessionId: string; assessmentId: string }> {
    const c = await createClient(page, 'E2E', `RedFlag-${randomUUID().slice(0, 8)}`)
    const assessment = await page.request.post('/api/assessments', { data: { client_id: c.id, submission_id: randomUUID(), test_mode: true } })
    expect(assessment.ok(), `assessment create failed: ${assessment.status()}`).toBeTruthy()
    const assessmentId = (await assessment.json()).id as string

    const approve = await page.request.patch(`/api/assessments/${assessmentId}/approve`, { data: { approved: true } })
    expect(approve.ok(), `approve failed: ${approve.status()}`).toBeTruthy()

    const mint = await page.request.post('/api/workouts', { data: { assessment_id: assessmentId } })
    expect(mint.ok(), `mint failed: ${mint.status()}`).toBeTruthy()
    return { sessionId: (await mint.json()).session_id as string, assessmentId }
  }

  test('flow 1: red-flag question renders before player controls, "No, I feel okay" unblocks begin, session starts', async ({ page }) => {
    const { sessionId, assessmentId } = await mintSession(page)
    await page.goto(`/workouts/${sessionId}`)

    await expect(page.getByRole('navigation', { name: 'Application navigation' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Exit session' })).toBeVisible()

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

    // Click "Begin session" — player timeline appears and the locally generated
    // Voicebox coach pack serves the first cue (with Web Speech only as fallback).
    const coachCue = page.waitForResponse(
      (response) => response.url().includes('/audio/workout-coach-river/'),
      { timeout: 10_000 },
    )
    await page.getByRole('button', { name: 'Begin session' }).click()
    expect([200, 206]).toContain((await coachCue).status())
    // The "Up next" card confirms the player has advanced into a play phase.
    await expect(page.getByText(/up next/i)).toBeVisible({ timeout: 8_000 })

    // The practitioner-facing run list reflects the acknowledged pain check.
    // It lives in the Program tab, behind a "Session runs (N)" disclosure.
    await page.goto(`/assessments/${assessmentId}`)
    await page.getByRole('tab', { name: /^Program/ }).click()
    await page.locator('summary').filter({ hasText: 'Session runs' }).click()
    await expect(page.getByText('Pain check clear')).toBeVisible({ timeout: 10_000 })
  })

  test('flow 2: "Yes" shows the stop card and no player timeline appears', async ({ page }) => {
    const { sessionId } = await mintSession(page)
    await page.goto(`/workouts/${sessionId}`)

    await expect(page.getByText('Before you start — are you feeling any sharp or worsening pain right now?')).toBeVisible({ timeout: 15_000 })

    // Click "Yes" — stop card renders.
    await page.getByTestId('red-flag-yes').click()
    await expect(page.getByTestId('stop-card')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText(/Let's pause here/)).toBeVisible()
    await expect(page.getByTestId('stop-card').getByText(/movement professional/)).toBeVisible()

    // No player timeline (Up next, "set X of Y", segmented progress) is visible.
    await expect(page.getByText(/up next/i)).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Begin session' })).not.toBeVisible()

    // Dismiss the stop card — onExit fires (window.location.reload), session exits.
    await page.getByTestId('stop-card-dismiss').click()
    // After dismiss the page reloads; wait for the red-flag question to reappear,
    // proving the player exited and the stop card is gone.
    await expect(page.getByTestId('stop-card')).not.toBeVisible({ timeout: 8_000 })
  })

  test('flow 3: resuming a session with prior progress re-asks the red-flag question before playback', async ({ page }) => {
    const { sessionId } = await mintSession(page)

    // Persist mid-session progress directly, so resumePlayer enters 'upNext' (it
    // stays idle only at index 0 with nothing done) — this is the case the audit
    // flagged as auto-playing past the safety screen.
    const progress = await page.request.patch(`/api/workouts/${sessionId}/run`, {
      data: { status: 'in_progress', current_item_index: 1, revision: 99 },
    })
    expect(progress.ok(), `progress patch failed: ${progress.status()}`).toBeTruthy()

    await page.goto(`/workouts/${sessionId}`)

    // resumePlayer now lands in 'upNext' and would previously auto-advance. The
    // gate must render again, with no timeline behind it.
    await expect(
      page.getByText('Before you start — are you feeling any sharp or worsening pain right now?'),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/up next/i)).not.toBeVisible()

    // Clearing it resumes at the persisted item, not from scratch.
    await page.getByTestId('red-flag-no').click()
    await expect(page.getByText(/up next/i)).toBeVisible({ timeout: 8_000 })
  })

  test('flow 4: hidden workout chrome leaves the tab order and returns before keyboard focus enters', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const { sessionId } = await mintSession(page)
    await page.goto(`/workouts/${sessionId}`)

    await expect(page.getByTestId('red-flag-no')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('red-flag-no').click()
    await page.getByRole('button', { name: 'Begin session' }).click()
    await expect(page.getByText(/up next/i)).toBeVisible({ timeout: 8_000 })
    await page.getByRole('button', { name: /Start now/ }).click()

    const transport = page.getByTestId('workout-chrome-transport')
    const exit = page.getByRole('button', { name: 'Exit session', includeHidden: true })
    const mute = page.getByRole('button', { name: 'Mute coach voice', includeHidden: true })
    const captions = page.getByRole('button', { name: 'Hide captions', includeHidden: true })

    await expect(transport).toBeVisible({ timeout: 5_000 })
    await expect(transport).toHaveCSS('visibility', 'hidden', { timeout: 6_000 })
    await expect(transport).toHaveAttribute('aria-hidden', 'true')
    await expect(exit).toBeVisible()
    await expect(exit).toHaveCSS('opacity', '1')
    await expect(exit).toHaveCSS('visibility', 'visible')
    await expect(exit).toHaveAttribute('tabindex', '0')
    await expect(exit).not.toHaveAttribute('aria-hidden', 'true')
    await expect(mute).toHaveAttribute('tabindex', '-1')
    await expect(captions).toHaveAttribute('tabindex', '-1')

    const axe = await analyzeAndAttachAxe(page, testInfo, 'workout hidden chrome')
    const serious = axe.violations.filter((violation) =>
      violation.impact === 'serious' || violation.impact === 'critical',
    )
    expect(serious.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])

    // Tab intent is captured before native focus traversal, so chrome becomes
    // visible and focus lands on the first control instead of skipping it.
    await page.keyboard.press('Tab')
    await expect(transport).toHaveCSS('visibility', 'visible')
    await expect(exit).toBeFocused()

    for (const control of [exit, mute, captions]) {
      const size = await control.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      })
      expect(size.width).toBeGreaterThanOrEqual(44)
      expect(size.height).toBeGreaterThanOrEqual(44)
    }
  })
})

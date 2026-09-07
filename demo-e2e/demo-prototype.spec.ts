import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('sample scan to saved workout and resumable player', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/demo')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.getByRole('link', { name: 'Start my scan' }).click()
  await page.getByRole('button', { name: 'Use sample scan', exact: true }).click()
  await expect(page.getByText('Synthetic sample · Alex', { exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'front synthetic sample' })).toBeVisible()
  await expect(page.getByRole('img', { name: 'side synthetic sample' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('scan.png'), fullPage: true })
  await page.reload()
  await expect(page.getByText('Synthetic sample · Alex', { exact: true })).toBeVisible()
  await page.getByRole('navigation', { name: 'Prototype navigation' }).getByRole('link', { name: 'Workouts' }).click()
  await page.getByRole('button', { name: 'Build from scan', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Scan-based workout' })).toBeVisible()
  await page.getByLabel('Workout name', { exact: true }).fill('Tuesday movement')
  while (await page.getByRole('button', { name: /^Remove / }).count() > 2) {
    await page.getByRole('button', { name: /^Remove / }).last().click()
  }
  await page.getByRole('button', { name: 'Save workout', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Tuesday movement', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('workout-library.png'), fullPage: true })
  const accessibility = await new AxeBuilder({ page }).analyze()
  expect(accessibility.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([])
  await page.getByRole('button', { name: 'Start workout', exact: true }).click()
  await page.getByRole('button', { name: 'No, I feel okay' }).click()
  await page.getByRole('button', { name: 'Begin session', exact: true }).click()
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Exit session', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Resume', exact: true }).click()
  await page.getByRole('button', { name: 'No, I feel okay' }).click()
  await page.getByRole('button', { name: 'Begin session', exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('player.png'), fullPage: true })
  const itemCount = await page.evaluate(() => JSON.parse(localStorage.getItem('posture-ai:demo:workouts:v1') ?? '[]')[0].snapshot.items.length)
  for (let index = 0; index < itemCount; index++) {
    await page.getByRole('button', { name: 'Skip', exact: true }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Skip', exact: true }).click()
  }
  await expect.poll(async () => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('posture-ai:demo:workouts:v1') ?? '[]')
    return stored[0]?.run?.status
  })).toBe('completed')
  expect(errors).toEqual([])
})

test('provider failure keeps builder usable and fallback accurately labeled', async ({ page }) => {
  await page.route('**/api/demo/workouts/generate', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'AI is temporarily unavailable. Use Build from scan.' }) }))
  await page.goto('/demo/workouts')
  await page.getByRole('button', { name: 'Create with AI', exact: true }).click()
  await expect(page.locator('main [role=alert]')).toContainText('AI is temporarily unavailable')
  await expect(page.getByRole('button', { name: 'Create with AI', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Build from scan', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Scan-based workout' })).toBeVisible()
  await expect(page.getByLabel('Workout name', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('corrupt workout storage offers a working reset', async ({ page }) => {
  await page.goto('/demo/workouts')
  await page.evaluate(() => localStorage.setItem('posture-ai:demo:workouts:v1', '{broken'))
  await page.reload()
  await expect(page.locator('main [role=alert]')).toBeVisible()
  await page.getByRole('button', { name: 'Reset local workout library', exact: true }).click()
  await expect(page.locator('main [role=alert]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Build from scan', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Scan-based workout' })).toBeVisible()
})

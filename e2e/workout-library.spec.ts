import { expect, test } from '@playwright/test'

test('the authenticated workout library renders through the server component boundary', async ({ page }) => {
  await page.goto('/workouts')
  await expect(page.getByRole('heading', { name: 'Workouts', exact: true, level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Workout library', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Workouts', exact: true })).toHaveAttribute('aria-current', 'page')
})

import { test, expect } from '@playwright/test'

// Unreviewed-content badge (Required Phase-2). All seeded muscle-KB content is
// clinically unreviewed (reviewed_at IS NULL). The reviewed gate
// — NEXT_PUBLIC_SHOW_UNREVIEWED_CONTENT === '1' || NODE_ENV !== 'production'
// (app/muscles/[slug]/page.tsx) — shows unreviewed muscles WITH a "Pending
// review" badge in dev/preview and hides them in production. The e2e dev server
// is non-production, so the badge must render on an unreviewed muscle page.
test.describe('unreviewed-content badge', () => {
  test('an unreviewed muscle page shows the "Pending review" badge in dev/preview', async ({ page }) => {
    await page.goto('/muscles/upper-trapezius')
    await expect(page.getByRole('heading', { name: 'Upper Trapezius' })).toBeVisible()
    await expect(page.getByText('Pending review')).toBeVisible()
  })
})

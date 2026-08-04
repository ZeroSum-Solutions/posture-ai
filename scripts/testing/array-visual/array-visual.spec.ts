import { test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * Temporary visual harness for the Array redesign. Captures each migrated screen
 * both in-viewport (so fixed chrome such as the island lands where it really
 * sits) and full-page. Delete once the redesign lands — it asserts nothing.
 */
const OUT = path.resolve(__dirname, '../../../docs/screenshots/array')

/**
 * ARRAY_VISUAL_CLIENT_ID points at a seeded client with several completed scans,
 * so the client-detail capture exercises a real trend instead of a single dot.
 * Omitted rather than guessed when unset — a 404 capture proves nothing.
 */
const CLIENT_ID = process.env.ARRAY_VISUAL_CLIENT_ID ?? ''

const SCREENS: Array<{ name: string; path: string }> = [
  { name: '01-today', path: '/dashboard' },
  { name: '02-clients', path: '/clients' },
  ...(CLIENT_ID ? [{ name: '03-client-detail', path: `/clients/${CLIENT_ID}` }] : []),
]

test('capture migrated screens', async ({ page }) => {
  await mkdir(OUT, { recursive: true })
  for (const screen of SCREENS) {
    await page.goto(screen.path)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(900)
    await page.screenshot({ path: path.join(OUT, `${screen.name}-viewport.png`) })
    await page.screenshot({ path: path.join(OUT, `${screen.name}-full.png`), fullPage: true })
  }
})

/**
 * Auth screens, captured without the stored practitioner session. These are the
 * screens a practitioner hits on a new device, so a broken one locks them out —
 * which is exactly what the deleted v1 tokens did before they were migrated.
 */
test.describe('unauthenticated', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('capture auth screens', async ({ page }) => {
    await mkdir(OUT, { recursive: true })
    for (const screen of [
      { name: '90-sign-in', path: '/auth/sign-in' },
      { name: '91-forgot-password', path: '/auth/forgot-password' },
    ]) {
      await page.goto(screen.path)
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.waitForTimeout(600)
      await page.screenshot({ path: path.join(OUT, `${screen.name}-viewport.png`) })
    }
  })
})

import { test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * Temporary visual harness for the Array redesign. Captures each migrated screen
 * both in-viewport (so fixed chrome such as the island lands where it really
 * sits) and full-page. Delete once the redesign lands — it asserts nothing.
 */
const OUT = path.resolve(__dirname, '../../../docs/screenshots/array')

const SCREENS: Array<{ name: string; path: string }> = [
  { name: '01-today', path: '/dashboard' },
  { name: '02-clients', path: '/clients' },
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

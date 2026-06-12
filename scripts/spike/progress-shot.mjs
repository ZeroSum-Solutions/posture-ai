import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const ctx = await browser.newContext({ storageState: 'e2e/.auth/user.json', viewport: { width: 1100, height: 900 } })
const page = await ctx.newPage()
await page.goto('http://127.0.0.1:3101/clients')
await page.waitForLoadState('networkidle')
const first = page.locator('main a[href^="/clients/"]:not([href$="/new"]):not([href="/clients"])').first()
if (await first.count() === 0) { console.log('NO CLIENTS'); process.exit(0) }
await first.click()
await page.waitForURL(/\/clients\/[0-9a-f-]{36}/, { timeout: 10000 })
await page.waitForLoadState('networkidle')
// ensure >=2 assessments so Progress/Compare tabs render
const clientId = page.url().split('/clients/')[1]
console.log('clientId:', clientId)
for (let i = 0; i < 2; i++) {
  const r = await page.request.post('http://127.0.0.1:3101/api/assessments', { data: { client_id: clientId, test_mode: true } })
  console.log('POST status', r.status(), (await r.text()).slice(0, 120))
}
await page.reload()
await page.waitForLoadState('networkidle')
const progressTab = page.getByRole('button', { name: /progress/i })
if (await progressTab.count() > 0) { await progressTab.first().click() } else { console.log('NO PROGRESS TAB') }
await page.waitForTimeout(1200)
await page.screenshot({ path: '/tmp/progress-tab.png', fullPage: true })
console.log('shot saved')
await browser.close()

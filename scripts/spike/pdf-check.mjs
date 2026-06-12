import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const ctx = await browser.newContext({ storageState: 'e2e/.auth/user.json' })
const page = await ctx.newPage()
const r = await page.request.post('http://127.0.0.1:3101/api/reports', { data: { assessment_id: '2afe3e14-a16d-42dc-bbcc-2aec5693c265' } })
console.log('status:', r.status())
const body = await r.body().catch(() => null)
const text = body ? body.toString('utf8', 0, 200) : ''
console.log(text.startsWith('%PDF') ? 'PDF MAGIC OK, bytes=' + body.length : 'response: ' + text.slice(0, 200))
await browser.close()

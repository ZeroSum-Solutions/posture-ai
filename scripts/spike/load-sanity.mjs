import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const ctx = await browser.newContext({ storageState: 'e2e/.auth/user.json' })
const page = await ctx.newPage()
await page.goto('http://127.0.0.1:3101/clients')
const cr = await page.request.post('http://127.0.0.1:3101/api/clients', { data: { first_name: 'Load', last_name: 'Sanity', consent_recorded_at: new Date().toISOString() } })
const client = (await cr.json()).client ?? await cr.json()
const id = client.id
const t0 = Date.now()
const results = await Promise.all(Array.from({ length: 10 }, () =>
  page.request.post('http://127.0.0.1:3101/api/assessments', { data: { client_id: id, test_mode: true } }).then(async r => ({ status: r.status(), body: await r.json() }))
))
const ms = Date.now() - t0
const ok = results.filter(r => r.status === 200 && r.body.status === 'complete')
const ids = new Set(ok.map(r => r.body.id))
console.log(`10 concurrent POSTs in ${ms}ms: ${ok.length}/10 complete, ${ids.size} distinct ids, statuses=[${results.map(r => r.status)}]`)
await browser.close()

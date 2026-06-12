import { chromium } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'
const browser = await chromium.launch()
const ctx = await browser.newContext({ storageState: 'e2e/.auth/user.json' })
const page = await ctx.newPage()
const pairs = new Map()
for (const path of ['/dashboard', '/clients', '/exercises', '/muscles', '/muscles/suboccipitals', '/assessments/new?testMode=1']) {
  await page.goto('http://127.0.0.1:3101' + path)
  await page.waitForLoadState('networkidle')
  const res = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
  for (const v of res.violations) for (const n of v.nodes) {
    const m = n.any[0]?.data
    if (m) {
      const key = `${m.fgColor} on ${m.bgColor} (ratio ${m.contrastRatio}, need ${m.expectedContrastRatio})`
      if (!pairs.has(key)) pairs.set(key, [])
      if (pairs.get(key).length < 2) pairs.get(key).push(`${path}: ${n.target[0]}`.slice(0, 100))
    }
  }
}
for (const [k, v] of pairs) console.log(k + '\n   ' + v.join('\n   '))
await browser.close()

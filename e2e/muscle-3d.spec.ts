import { test, expect } from '@playwright/test'
import { createClient, selectClientInWizard } from './helpers'

// 3D Posture Summary: proves the embedded muscle-viewer actually frames under the effective
// CSP AND that the assessment's findings are applied as colors — not just that headers look
// right. Requires the muscle KB seed + the copied viewer build (public/muscle-viewer/**).
test.describe('3D posture summary', () => {
  test('mounts on click, frames under CSP, and colors the model from findings', async ({ page }) => {
    // Track that the ~9 MB GLB is not fetched until the user opts in (click-only mount).
    let glbRequested = false
    page.on('request', (req) => {
      if (req.url().includes('/muscle-viewer/model.glb')) glbRequested = true
    })
    // A blocked frame surfaces a CSP console error; collect any to assert none fired.
    const cspErrors: string[] = []
    page.on('console', (msg) => {
      if (/content security policy|frame-ancestors|refused to (frame|display)/i.test(msg.text())) {
        cspErrors.push(msg.text())
      }
    })

    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `Muscle3d${stamp}`)
    await page.goto('/assessments/new?testMode=1')
    await selectClientInWizard(page, `E2E Muscle3d${stamp}`)
    await page.getByRole('button', { name: 'Run Test Analysis' }).click()
    await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 30_000 })

    // Card is present but NOT yet loaded — no GLB request should have fired.
    const showButton = page.getByRole('button', { name: 'Show 3D model' })
    await expect(showButton).toBeVisible({ timeout: 15_000 })
    expect(glbRequested, 'GLB must not download before the user clicks').toBe(false)

    // Effective headers prove the CSP + base fixes (guards the framing blocker).
    const idx = await page.request.get('/muscle-viewer/index.html')
    expect(idx.status()).toBe(200)
    expect(idx.headers()['content-security-policy'] ?? '').toContain("frame-ancestors 'self'")
    const glb = await page.request.get('/muscle-viewer/model.glb')
    expect(glb.status()).toBe(200)

    // Mount the iframe.
    await showButton.click()

    const frameEl = await page.waitForSelector('iframe[title="Posture Summary 3D model"]', {
      timeout: 15_000,
    })
    const frame = await frameEl.contentFrame()
    expect(frame, 'viewer iframe must have a content frame (i.e. it framed, not blocked)').not.toBeNull()

    // Real render: the viewer's WebGL canvas actually mounts inside the frame.
    await frame!.waitForSelector('canvas', { timeout: 25_000 })

    // Applied coloring: the handshake delivered the findings and the store is colored.
    const handle = await frame!.waitForFunction(
      () => {
        const mv = (window as unknown as { muscleViewer?: { getAssessment?: () => Record<string, { color: string }> } }).muscleViewer
        const a = mv?.getAssessment?.()
        return a && Object.keys(a).length > 0 ? a : null
      },
      { timeout: 25_000 },
    )
    const assessment = (await handle.jsonValue()) as Record<string, { color: string }>
    const keys = Object.keys(assessment)
    const red = keys.filter((k) => assessment[k].color === 'red').length
    const blue = keys.filter((k) => assessment[k].color === 'blue').length
    // The test fixture produces tight (red) findings; both colors are typical.
    expect(keys.length, 'viewer store should be colored from findings').toBeGreaterThan(0)
    expect(red + blue).toBe(keys.length)
    expect(red, `expected tight (red) muscles; got red=${red} blue=${blue}`).toBeGreaterThan(0)

    // Framing was not blocked by CSP.
    expect(cspErrors, `CSP errors: ${cspErrors.join(' | ')}`).toEqual([])
  })
})

import { test, expect } from '@playwright/test'
import { createClient, selectClientInWizard } from './helpers'

// 3D Posture Summary: proves the embedded muscle-viewer actually frames under the effective
// CSP AND that the assessment's referenced anatomy is highlighted — not just that headers look
// right. Requires the muscle KB seed + the copied viewer build (public/muscle-viewer/**).
test.describe('3D posture summary', () => {
  test('mounts on click, frames under CSP, and colors the model from findings', async ({ page, isMobile }) => {
    test.setTimeout(150_000)
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

    // The 3D model belongs to the Evidence tab and is intentionally not mounted
    // while the grade-first Findings tab is active.
    await page.getByRole('tab', { name: 'Evidence' }).click()

    // Card is present but NOT yet loaded — no GLB request should have fired.
    const showButton = page.getByRole('button', { name: /Open interactive 3D anatomy/ })
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

    const frameEl = await page.waitForSelector('iframe[title="Interactive 3D anatomy model"]', {
      timeout: 15_000,
    })
    const frame = await frameEl.contentFrame()
    expect(frame, 'viewer iframe must have a content frame (i.e. it framed, not blocked)').not.toBeNull()

    // Real render: the viewer's WebGL canvas actually mounts inside the frame.
    await frame!.waitForSelector('[data-model-state="ready"]', { timeout: 25_000 })
    await frame!.waitForSelector('canvas', { timeout: 25_000 })

    // Applied coloring: the handshake delivered the findings and the store is colored.
    const handle = await frame!.waitForFunction(
      () => {
        const mv = (window as unknown as { muscleViewer?: { getAssessment?: () => Record<string, { color: string }> } }).muscleViewer
        const a = mv?.getAssessment?.()
        return a && Object.keys(a).length > 0 ? a : null
      },
      undefined,
      { timeout: 25_000 },
    )
    const assessment = (await handle.jsonValue()) as Record<string, { color: string }>
    const keys = Object.keys(assessment)
    // A static screening cannot establish muscle tightness or weakness.
    expect(keys.length, 'viewer store should locate referenced anatomy').toBeGreaterThan(0)
    expect(keys.every(key => assessment[key].color === 'amber')).toBe(true)

    const viewer = frame!.locator('[data-model-state="ready"]')
    const canvas = frame!.locator('canvas')
    await frame!.getByRole('button', { name: /Front/ }).click()
    await expect(viewer).toHaveAttribute('data-camera-state', 'settled')
    const frontImage = await canvas.screenshot()
    await frame!.getByRole('button', { name: /Back/ }).click()
    await expect(viewer).toHaveAttribute('data-camera-state', 'settled')
    const backImage = await canvas.screenshot()
    expect(frontImage.equals(backImage), 'Back must visibly change the rendered anatomy view').toBe(false)
    await frame!.getByRole('button', { name: /Back/ }).press('f')
    await expect(viewer).toHaveAttribute('data-camera-state', 'settled')
    await frame!.getByRole('button', { name: /Front/ }).press('r')
    await expect(viewer).toHaveAttribute('data-camera-state', 'settled')

    const beforeDrag = await canvas.screenshot()
    const canvasBounds = await canvas.boundingBox()
    expect(canvasBounds).not.toBeNull()
    const centerX = canvasBounds!.x + canvasBounds!.width / 2
    const centerY = canvasBounds!.y + canvasBounds!.height / 2
    await page.mouse.move(centerX, centerY)
    await page.mouse.down()
    await page.mouse.move(centerX + 90, centerY + 20, { steps: 12 })
    await page.mouse.up()
    await expect.poll(async () => beforeDrag.equals(await canvas.screenshot())).toBe(false)
    // Playwright cannot dispatch wheel events in mobile WebKit ("Mouse wheel is
    // not supported in mobile WebKit"), so wheel zoom is proven on the desktop
    // projects only, as in muscle-viewer-controls.spec.ts.
    if (!isMobile) {
      const beforeZoom = await canvas.screenshot()
      await page.mouse.wheel(0, -200)
      await expect.poll(async () => beforeZoom.equals(await canvas.screenshot())).toBe(false)
    }

    // Exercise the real model-load failure and host retry, rather than injecting a message.
    await page.route('**/muscle-viewer/model.glb', route => route.abort('failed'))
    await page.reload()
    await page.getByRole('tab', { name: 'Evidence' }).click()
    await page.getByRole('button', { name: /Open interactive 3D anatomy/ }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'The 3D view did not load.' })).toBeVisible({ timeout: 40_000 })
    await page.unroute('**/muscle-viewer/model.glb')
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(page.frameLocator('iframe[title="Interactive 3D anatomy model"]').locator('[data-model-state="ready"]')).toBeVisible({ timeout: 30_000 })

    // Framing was not blocked by CSP.
    expect(cspErrors, `CSP errors: ${cspErrors.join(' | ')}`).toEqual([])
  })
})

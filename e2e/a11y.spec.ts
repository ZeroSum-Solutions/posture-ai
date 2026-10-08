import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { createClient, dismissCaptureDisclaimer, selectClientInWizard } from './helpers'
import { analyzeAndAttachAxe } from './axe-receipt'

const DENY_CAMERA_PERMISSION = () => {
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true })
  }
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    value: async () => { throw new DOMException('Permission denied by browser harness', 'NotAllowedError') },
    configurable: true,
  })
}

// Pragmatic accessibility budget (roadmap P5): zero serious/critical axe
// violations on every primary surface. This spec runs in desktop Chromium,
// iPhone-like WebKit, and the explicitly proxy-labeled Android Chromium project.
test.describe('accessibility budget', () => {
  async function expectNoSeriousViolations(page: Page, testInfo: TestInfo, name: string) {
    // Axe must inspect the settled surface. On a cold WebKit worker the route
    // entrance can still be near opacity 0 after networkidle, which makes Axe
    // composite otherwise-accessible colors into a false black-on-black result.
    await expect(page.locator('.app-shell-main')).toHaveCSS('opacity', '1', { timeout: 15_000 })
    // v4 staggers rows and sections in with short fades; wait for every finite
    // animation to settle (ambient drift and spinners loop forever and are skipped).
    await page.evaluate(() => Promise.all(document.getAnimations()
      .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity))
      .map(animation => animation.finished.catch(() => undefined))))
    const results = await analyzeAndAttachAxe(page, testInfo, name)
    const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    const detail = serious.map(v =>
      `${v.id} (${v.impact}): ${v.help} -> ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`
    )
    expect(serious, `${name}:\n${detail.join('\n')}`).toEqual([])
  }

  test('auth surfaces pass the axe budget', async ({ page }, testInfo) => {
    for (const [path, name] of [
      ['/auth/sign-in', 'sign-in'],
      ['/auth/forgot-password', 'forgot-password'],
    ] as const) {
      await page.goto(path)
      await expectNoSeriousViolations(page, testInfo, name)
    }
  })

  test('static surfaces pass the axe budget', async ({ page }, testInfo) => {
    // Eight surfaces, each a full navigation + networkidle + a full axe-core scan.
    // The redesign's heavier DOM and the WebGL atmosphere make each axe pass more
    // CPU-bound, so the default 30s budget is too tight on slower CI hardware
    // (runs in ~15s locally). Match the suite's convention of explicit budgets for
    // heavy tests (capture=120s, real-detection=300s).
    test.setTimeout(120_000)
    for (const [path, name] of [
      ['/dashboard', 'dashboard'],
      ['/clients', 'clients'],
      ['/exercises', 'exercises'],
      ['/muscles', 'muscle library'],
      ['/muscles/suboccipitals', 'muscle detail'],
      ['/privacy', 'privacy'],
      ['/terms', 'terms'],
      ['/settings', 'settings'],
    ] as const) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      if (path === '/privacy' || path === '/terms') {
        const id = path === '/privacy'
          ? 'privacy-test-fixture-v1'
          : 'terms-test-fixture-v1'
        const document = page.locator(`article[data-legal-document-id="${id}"]`)
        await expect(document.getByText('NON-PRODUCTION LEGAL FIXTURE — TEST USE ONLY')).toBeVisible()
        await expect(document).toHaveAttribute('data-legal-document-version', 'test-1')
        await expect(document).toHaveAttribute('data-legal-document-body-sha256', /^[0-9a-f]{64}$/)
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i)
      }
      await expectNoSeriousViolations(page, testInfo, name)
    }
  })

  test('phone-width island navigation passes the axe budget', async ({ page }, testInfo) => {
    // IslandNav (components/array/IslandNav.tsx) replaced the old NavBar
    // hamburger, so there is no closed/open pair left to scan. The island does
    // still have two materially different rendered states, and those are the
    // two scanned here: the active slot expands into a labelled white pill
    // while every other slot stays an icon-only circle, so which destination is
    // active changes both the contrast pairings and the accessible names on
    // screen. Two routes, two different active slots — not one scan repeated.
    await page.setViewportSize({ width: 390, height: 844 })
    const nav = page.getByRole('navigation', { name: 'Primary' })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')
    await expect(nav.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page')
    await expectNoSeriousViolations(page, testInfo, 'phone navigation today active')

    await page.goto('/settings')
    await page.waitForLoadState('networkidle')
    await expect(nav.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page')
    await expectNoSeriousViolations(page, testInfo, 'phone navigation profile active')
  })

  test('client CRUD surfaces pass the axe budget', async ({ page }, testInfo) => {
    await page.goto('/clients/new')
    await page.waitForLoadState('networkidle')
    // Scan the usable create surface, after the required legal document has
    // hydrated and unlocked the consent form, rather than its transient shell.
    await expect(page.getByRole('article', { name: 'Consent to Posture Screening' }))
      .toBeVisible({ timeout: 15_000 })
    await expectNoSeriousViolations(page, testInfo, 'client new')

    const stamp = Date.now().toString().slice(-7)
    const client = await createClient(page, 'A11y', `Budget${stamp}`)

    await page.goto(`/clients/${client.id}`)
    await page.waitForLoadState('networkidle')
    await expectNoSeriousViolations(page, testInfo, 'client detail')

    await page.goto(`/clients/${client.id}/edit`)
    await page.waitForLoadState('networkidle')
    await expectNoSeriousViolations(page, testInfo, 'client edit')
  })

  test('consent page passes the axe budget', async ({ page }, testInfo) => {
    const c = await createClient(page, 'A11yConsent', `Cns${Date.now().toString().slice(-6)}`, { remote: true })
    const link = await page.request.post('/api/consent/link', { data: { client_id: c.id } })
    expect(link.ok()).toBeTruthy()
    const token = String((await link.json()).url).split('/consent/')[1]
    await page.goto(`/consent/${token}`)
    await page.waitForLoadState('networkidle')
    await expectNoSeriousViolations(page, testInfo, 'consent')
  })

  test('non-test upload and live-capture wizard states pass the axe budget', async ({ page }, testInfo) => {
    // The browser-only stub prevents use of a real camera. WebKit can retain its
    // live shell while permission settles; every engine must still expose the
    // real upload control. This is UI evidence, not camera/device evidence.
    await page.addInitScript(DENY_CAMERA_PERMISSION)
    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'A11y', `LiveCapture${stamp}`)
    await page.goto('/assessments/new')
    await selectClientInWizard(page, `A11y LiveCapture${stamp}`)

    await expect(page.getByTestId('fullscreen-capture')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('capture-disclaimer')).toBeVisible()
    await expectNoSeriousViolations(page, testInfo, 'live capture screening notice')

    await dismissCaptureDisclaimer(page)
    await expect(page.getByRole('button', { name: /(?:Upload photo instead|Use File Upload Instead — Front)/i }))
      .toBeVisible({ timeout: 15_000 })
    await expectNoSeriousViolations(page, testInfo, 'live capture upload controls')
  })

  test('wizard and results pass the axe budget', async ({ page }, testInfo) => {
    // This single journey includes client creation, assessment generation, four
    // full axe-core scans, approval, PDF generation, and a real PDF download.
    // Cold CI workers can complete every assertion but exceed Playwright's
    // generic 30s test ceiling while the final Axe scan is serializing results.
    test.setTimeout(120_000)
    // The shared E2E server intentionally enables the local clinical fixture.
    // This proves the generic results/PDF surface; the flags-off assessment-only
    // rehearsal remains PR-17/HG-09 and is not implied by this browser run.
    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `Axe${stamp}`)

    await page.goto('/assessments/new?testMode=1')
    await page.waitForLoadState('networkidle')
    await expectNoSeriousViolations(page, testInfo, 'wizard step 1')

    await selectClientInWizard(page, `E2E Axe${stamp}`)
    await expectNoSeriousViolations(page, testInfo, 'wizard step 2 (confirm)')

    await page.getByRole('button', { name: 'Run Test Analysis' }).click()
    await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveTitle('Assessment Results · Posture AI')
    await expectNoSeriousViolations(page, testInfo, 'results')

    // The rest of this journey drives ReviewDock's own controls (approve, PDF,
    // comparison select), which live behind the collapsed "Report, share &
    // compare" disclosure — not the pinned action bar's separate "Approve &
    // send report" button. Open it first.
    await page.getByRole('button', { name: 'Report, share & compare' }).click()
    await page.getByRole('button', { name: 'Approve report' }).click()
    // The pinned action bar's icon-only "Generate practitioner PDF" button also
    // matches the substring "Practitioner PDF" -- scope to ReviewDock's own
    // control, consistent with the rest of this journey.
    const pdfButton = page.getByTestId('review-dock').getByRole('button', { name: 'Practitioner PDF' })
    // Approval is a real PATCH; allow the cold route to finish before asserting
    // that the dependent export action has unlocked.
    await expect(pdfButton).toBeEnabled({ timeout: 30_000 })
    await pdfButton.click()
    const openPdf = page.getByRole('link', { name: 'Download practitioner PDF' })
    await expect(openPdf).toBeVisible({ timeout: 30_000 })
    const pdf = await page.request.get(await openPdf.getAttribute('href') ?? '')
    expect(pdf.ok(), `practitioner PDF failed to open: ${pdf.status()}`).toBeTruthy()
    expect(pdf.headers()['content-type']).toContain('application/pdf')
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF')
    await expectNoSeriousViolations(page, testInfo, 'results PDF ready')
  })

  test('wizard hard-failure recovery state passes the axe budget', async ({ page }, testInfo) => {
    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'A11y', `Failure${stamp}`)

    await page.goto('/assessments/new?testMode=1')
    await selectClientInWizard(page, `A11y Failure${stamp}`)
    await page.route('**/api/assessments', async route => {
      if (route.request().method() !== 'POST') return route.continue()
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'No person detected — retake all required views.' }),
      })
    })

    await page.getByRole('button', { name: 'Run Test Analysis' }).click()
    await expect(page.getByText('Screening needs attention', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible()
    await expectNoSeriousViolations(page, testInfo, 'wizard hard-failure recovery')
  })

  test('assessment results with prior assessment (compare-select + category badges) pass the axe budget', async ({ page }, testInfo) => {
    // This journey creates and renders two complete assessments, then runs a
    // full Axe scan over the largest results surface. Keep every assertion,
    // but do not force cold mobile WebKit into the generic 30-second ceiling.
    // Each results page also mounts the 3D posture-map hero, so this journey
    // now waits on two full GLB loads through software WebGL; GitHub-hosted
    // runners need more headroom for that than the former Blacksmith runners did.
    test.setTimeout(180_000)
    const stamp = Date.now().toString().slice(-7)
    const client = await createClient(page, 'A11y', `Prior${stamp}`)

    // First assessment — approve so it appears in the compare-select dropdown
    await page.goto(`/assessments/new?testMode=1&client_id=${client.id}`)
    await page.waitForLoadState('networkidle')
    await page.getByText(`A11y Prior${stamp}`).first().click()
    await page.getByRole('button', { name: /Next: (Confirm|Upload Views)/ }).click()
    await page.getByRole('button', { name: 'Run Test Analysis' }).click()
    await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    await page.waitForLoadState('networkidle')
    const approveBtn = page.getByRole('button', { name: /Approve report/i })
    if (await approveBtn.isVisible()) await approveBtn.click()
    await page.waitForTimeout(500)

    // Second assessment — compare-select, corrective program, and category badges all render
    await page.goto(`/assessments/new?testMode=1&client_id=${client.id}`)
    await page.waitForLoadState('networkidle')
    await page.getByText(`A11y Prior${stamp}`).first().click()
    await page.getByRole('button', { name: /Next: (Confirm|Upload Views)/ }).click()
    await page.getByRole('button', { name: 'Run Test Analysis' }).click()
    await page.waitForURL(/\/assessments\/[0-9a-f-]{36}$/, { timeout: 30_000 })
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveTitle('Assessment Results · Posture AI')
    await expectNoSeriousViolations(page, testInfo, 'assessment results with prior (compare-select + badges)')
  })
})

import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import sharp from 'sharp'
import { createClient, selectClientInWizard } from './helpers'

// The full scoring model's synchronous multi-pose inference exceeds the app's
// fixed 10-second fail-closed deadline under headless Chromium on the release
// runner. This real-model proxy is therefore owned by mobile WebKit; desktop
// Chromium must ignore this explicitly named spec in playwright.config.ts.
async function installUploadOnlyBoundary(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException('No camera in upload-only test', 'NotFoundError')
        },
      },
    })
  })
}

async function continuePastCaptureDisclaimer(page: Page) {
  const dismiss = page.getByTestId('capture-disclaimer-dismiss')
  const uploadFallback = page.getByRole('button', { name: /Use File Upload Instead/ })
  await expect(dismiss.or(uploadFallback).first()).toBeVisible({ timeout: 10_000 })
  if (await dismiss.isVisible()) await dismiss.click()
}

async function generatedTwoPersonFixture() {
  const sourcePath = path.join(__dirname, 'fixtures', 'photos', 'front_standing.jpg')
  const person = await sharp(sourcePath).resize({ width: 320, height: 480, fit: 'fill' }).jpeg({ quality: 92 }).toBuffer()
  const buffer = await sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 235, g: 235, b: 235 } },
  }).composite([
    { input: person, left: 0, top: 0 },
    { input: person, left: 320, top: 0 },
  ]).jpeg({ quality: 92 }).toBuffer()
  return { name: 'generated-two-person.jpg', mimeType: 'image/jpeg', buffer }
}

test.describe('WebKit real-model capture hard blocks', () => {
  test('blocks analysis when a generated upload contains two people', async ({ page }) => {
    test.setTimeout(150_000)
    await installUploadOnlyBoundary(page)
    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `TwoPeople${stamp}`)

    await page.goto('/assessments/new')
    await selectClientInWizard(page, `E2E TwoPeople${stamp}`)
    await continuePastCaptureDisclaimer(page)

    const inputs = page.locator('input[type="file"]')
    await expect(inputs.first()).toBeAttached({ timeout: 10_000 })
    await inputs.nth(0).setInputFiles(await generatedTwoPersonFixture())

    const multiplePeopleAlert = page.getByRole('alert', { name: 'More than one person detected' })
    const retryModel = page.getByRole('button', { name: 'Retry Model' })
    // A cold GPU pass can legitimately hit the fixed 10-second fail-closed
    // product deadline on the shared CI worker. Exercise the user-visible fresh
    // backend recovery instead of depending on Playwright's whole-test retry.
    await expect(multiplePeopleAlert.or(retryModel).first()).toBeVisible({ timeout: 90_000 })
    if (await retryModel.isVisible()) await retryModel.click()
    await expect(multiplePeopleAlert).toContainText('use one full-body photo for Front', { timeout: 90_000 })

    const photos = path.join(__dirname, 'fixtures', 'photos')
    await inputs.nth(1).setInputFiles(path.join(photos, 'side_standing.jpg'))
    await inputs.nth(2).setInputFiles(path.join(photos, 'side_standing.jpg'))
    await inputs.nth(3).setInputFiles(path.join(photos, 'back_standing.jpg'))

    const blockedAction = page.getByRole('button', { name: 'Retake invalid photos' })
    await expect(blockedAction).toBeVisible({ timeout: 90_000 })
    await expect(blockedAction).toBeDisabled()
    await expect(page).toHaveURL(/\/assessments\/new/)
  })
})

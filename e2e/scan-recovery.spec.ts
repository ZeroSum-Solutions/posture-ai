import { expect, test } from '@playwright/test'
import path from 'node:path'
import { createClient, dismissCaptureDisclaimer, selectClientInWizard } from './helpers'

async function enterUploadCapture(page: Parameters<typeof createClient>[0], suffix: string) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException('Upload-only recovery fixture', 'NotFoundError')
        },
      },
    })
  })
  const stamp = Date.now().toString().slice(-7)
  await createClient(page, 'E2E', `${suffix}${stamp}`)
  await page.goto('/assessments/new')
  await selectClientInWizard(page, `E2E ${suffix}${stamp}`)
  await dismissCaptureDisclaimer(page)
  await expect(page.locator('input[type="file"]').first()).toBeAttached()
}

test.describe('scan upload and model recovery', () => {
  test('a corrupt image stays on its view and explains how to recover', async ({ page }, testInfo) => {
    await enterUploadCapture(page, 'Decode')

    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'corrupt.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]),
    })

    await expect(page.getByRole('alert')).toContainText(/Front: The selected image could not be decoded|Front: The file contents do not match/)
    await expect(page.getByRole('button', { name: 'Front (required), current' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Left Side (required), pending' })).not.toHaveAttribute('aria-current', 'step')
    await testInfo.attach('decode-error-recovery', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })
  })

  test('a forced model download failure remains recoverable without reloading', async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    let blockModel = true
    await page.route('**/mediapipe/models/**', async route => {
      if (blockModel) await route.abort('failed')
      else await route.continue()
    })
    await enterUploadCapture(page, 'Model')

    const photo = path.join(__dirname, 'fixtures', 'photos', 'no-person.png')
    await page.locator('input[type="file"]').first().setInputFiles(photo)
    const readiness = page.getByTestId('pose-readiness')
    await expect(readiness).toHaveAttribute('role', 'alert', { timeout: 120_000 })
    await expect(page.getByRole('button', { name: /Front.*model check failed/ })).toBeVisible()
    await testInfo.attach('model-download-failure', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    })

    blockModel = false
    await page.getByRole('button', { name: 'Retry Model' }).click()
    await expect(readiness).toContainText('Posture model ready', { timeout: 120_000 })
    await expect(page.getByRole('button', { name: /Front.*captured/ })).not.toHaveAttribute('aria-label', /model check failed/, { timeout: 90_000 })
  })
})

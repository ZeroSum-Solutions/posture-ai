import { expect, test, type Page } from '@playwright/test'
import { createClient, selectClientInWizard } from './helpers'

type RecoveryStats = {
  cameraRequests: number
  trackStops: number
  wakeRequests: number
  wakeActive: number
  maxWakeActive: number
  appWakeReleases: number
  browserWakeReleases: number
}

type RecoveryHarness = {
  rotate(type: string): void
  background(): void
  foreground(): void
  stats(): RecoveryStats
}

async function installRecoveryBrowserBoundary(page: Page, emulatePlayableFrame: boolean) {
  await page.addInitScript((shouldEmulatePlayableFrame: boolean) => {
    const counters: RecoveryStats = {
      cameraRequests: 0,
      trackStops: 0,
      wakeRequests: 0,
      wakeActive: 0,
      maxWakeActive: 0,
      appWakeReleases: 0,
      browserWakeReleases: 0,
    }

    if (shouldEmulatePlayableFrame) {
      // Headless WebKit exposes a canvas capture track but does not advance a
      // video element's intrinsic dimensions. Supply that browser boundary for
      // this device-independent lifecycle proxy; Chromium consumes the real
      // painted canvas frame below.
      const nativePlay = HTMLMediaElement.prototype.play
      HTMLMediaElement.prototype.play = function () {
        if (this instanceof HTMLVideoElement && this.srcObject) {
          Object.defineProperties(this, {
            readyState: { configurable: true, get: () => HTMLMediaElement.HAVE_ENOUGH_DATA },
            videoWidth: { configurable: true, get: () => 720 },
            videoHeight: { configurable: true, get: () => 960 },
          })
          queueMicrotask(() => {
            this.dispatchEvent(new Event('loadeddata'))
            this.dispatchEvent(new Event('canplay'))
          })
          return Promise.resolve()
        }
        return nativePlay.call(this)
      }
    }

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          counters.cameraRequests += 1
          const canvas = document.createElement('canvas')
          canvas.width = 720
          canvas.height = 960
          const context = canvas.getContext('2d')!
          context.fillStyle = '#12202e'
          context.fillRect(0, 0, canvas.width, canvas.height)
          const stream = (canvas as HTMLCanvasElement & { captureStream(): MediaStream }).captureStream()
          const videoTrack = stream.getVideoTracks()[0]
          const stopTrack = videoTrack.stop.bind(videoTrack)
          videoTrack.stop = () => { counters.trackStops += 1; stopTrack() }
          return stream
        },
      },
    })

    class TestWakeLockSentinel extends EventTarget {
      released = false

      async release() {
        if (this.released) return
        this.released = true
        counters.appWakeReleases += 1
        counters.wakeActive -= 1
        this.dispatchEvent(new Event('release'))
      }

      browserRelease() {
        if (this.released) return
        this.released = true
        counters.browserWakeReleases += 1
        counters.wakeActive -= 1
        this.dispatchEvent(new Event('release'))
      }
    }
    let activeSentinel: TestWakeLockSentinel | null = null
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async (kind: string) => {
          if (kind !== 'screen') throw new TypeError(`Unexpected wake-lock type: ${kind}`)
          counters.wakeRequests += 1
          counters.wakeActive += 1
          counters.maxWakeActive = Math.max(counters.maxWakeActive, counters.wakeActive)
          activeSentinel = new TestWakeLockSentinel()
          return activeSentinel
        },
      },
    })

    class TestOrientation extends EventTarget {
      type = 'portrait-primary'
      angle = 0
      onchange: ((event: Event) => void) | null = null

      setType(type: string) {
        this.type = type
        const event = new Event('change')
        this.dispatchEvent(event)
        this.onchange?.(event)
        window.dispatchEvent(new Event('orientationchange'))
      }
    }
    const orientation = new TestOrientation()
    Object.defineProperty(window.screen, 'orientation', { configurable: true, value: orientation })

    let visibility: DocumentVisibilityState = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })

    const harness: RecoveryHarness = {
      rotate: type => orientation.setType(type),
      background: () => {
        visibility = 'hidden'
        document.dispatchEvent(new Event('visibilitychange'))
        activeSentinel?.browserRelease()
      },
      foreground: () => {
        visibility = 'visible'
        document.dispatchEvent(new Event('visibilitychange'))
      },
      stats: () => ({ ...counters }),
    }
    Object.defineProperty(window, '__deviceRecoveryHarness', { configurable: false, value: harness })
  }, emulatePlayableFrame)
}

async function stats(page: Page): Promise<RecoveryStats> {
  return page.evaluate(() => (window as unknown as { __deviceRecoveryHarness: RecoveryHarness }).__deviceRecoveryHarness.stats())
}

async function continuePastCaptureDisclaimer(page: Page) {
  const dismiss = page.getByTestId('capture-disclaimer-dismiss')
  const shutter = page.getByRole('button', { name: 'Capture photo' })
  await expect(dismiss.or(shutter).first()).toBeVisible({ timeout: 10_000 })
  if (await dismiss.isVisible()) await dismiss.click()
}

test.describe('device-independent capture recovery proxy', () => {
  test('preserves capture state and bounded resource ownership across 12 recovery cycles', async ({ page, browserName }) => {
    await installRecoveryBrowserBoundary(page, browserName === 'webkit')
    const stamp = Date.now().toString().slice(-7)
    await createClient(page, 'E2E', `Recovery${stamp}`)

    await page.goto('/assessments/new')
    await selectClientInWizard(page, `E2E Recovery${stamp}`)
    await continuePastCaptureDisclaimer(page)
    await expect(page.getByRole('button', { name: 'Capture photo' })).toBeEnabled({ timeout: 10_000 })
    await expect.poll(async () => (await stats(page)).wakeRequests).toBe(1)

    await page.getByRole('button', { name: 'Right Side (required), pending' }).click()
    await expect(page.getByRole('button', { name: 'Right Side (required), current' })).toHaveAttribute('aria-current', 'step')

    await page.evaluate(() => (window as unknown as { __deviceRecoveryHarness: RecoveryHarness }).__deviceRecoveryHarness.rotate('landscape-primary'))
    await expect(page.getByText('Hold the phone upright (portrait) to capture')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Right Side (required), current' })).toHaveAttribute('aria-current', 'step')

    await page.evaluate(() => (window as unknown as { __deviceRecoveryHarness: RecoveryHarness }).__deviceRecoveryHarness.rotate('portrait-primary'))
    await expect(page.getByText('Hold the phone upright (portrait) to capture')).toHaveCount(0)

    const cycles = 12
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      await page.evaluate(() => (window as unknown as { __deviceRecoveryHarness: RecoveryHarness }).__deviceRecoveryHarness.background())
      await expect.poll(async () => (await stats(page)).browserWakeReleases).toBe(cycle + 1)
      await expect.poll(async () => (await stats(page)).trackStops).toBe(cycle + 1)

      await page.evaluate(() => (window as unknown as { __deviceRecoveryHarness: RecoveryHarness }).__deviceRecoveryHarness.foreground())
      await expect.poll(async () => (await stats(page)).wakeRequests).toBe(cycle + 2)
      await expect.poll(async () => (await stats(page)).cameraRequests).toBe(cycle + 2)
      await expect(page.getByRole('button', { name: 'Capture photo' })).toBeEnabled()
      await expect(page.getByRole('button', { name: 'Right Side (required), current' })).toHaveAttribute('aria-current', 'step')

      const cycleStats = await stats(page)
      expect(cycleStats.cameraRequests - cycleStats.trackStops).toBe(1)
      expect(cycleStats.wakeRequests - cycleStats.browserWakeReleases).toBe(1)
      expect(cycleStats.wakeActive).toBe(1)
      expect(cycleStats.maxWakeActive).toBe(1)
    }

    expect((await stats(page))).toMatchObject({ appWakeReleases: 0, wakeActive: 1, maxWakeActive: 1 })
    await page.getByRole('button', { name: 'Cancel and return to client selection' }).click()
    await expect(page.getByTestId('fullscreen-capture')).toHaveCount(0)
    await expect.poll(async () => (await stats(page)).wakeActive).toBe(0)
    await expect.poll(async () => (await stats(page)).trackStops).toBe(cycles + 1)
  })
})

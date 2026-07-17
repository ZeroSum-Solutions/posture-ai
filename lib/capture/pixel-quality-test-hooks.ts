'use client'
// Exposes the production pixel-sampling + scoring functions on `window` for
// out-of-process drivers (T1b browser-lane calibration, T4b cross-engine
// spec) to call directly — gated on the app's existing CLIENT test-mode
// mechanism (page.tsx `testMode`: NEXT_PUBLIC_POSTURE_TEST_MODE / the
// `testMode` query param). POSTURE_TEST_MODE_ENABLED is server-only and not
// visible here, so this gate is intentionally a separate, client-side check.

import { samplePixelsFromSource } from './pixel-sample'
import { assessPixelQuality } from './pixel-quality'

export interface PixelQualityHooks {
  samplePixelsFromSource: typeof samplePixelsFromSource
  assessPixelQuality: typeof assessPixelQuality
}

declare global {
  interface Window {
    __pixelQualityHooks?: PixelQualityHooks
  }
}

/**
 * Installs `window.__pixelQualityHooks` when `testMode` is true, removes it
 * otherwise. Call from an effect keyed on the current test-mode value so the
 * property tracks the gate exactly (present under test mode, absent — not
 * merely falsy — in production).
 */
export function syncPixelQualityTestHooks(testMode: boolean): void {
  if (testMode) {
    window.__pixelQualityHooks = { samplePixelsFromSource, assessPixelQuality }
  } else {
    delete window.__pixelQualityHooks
  }
}

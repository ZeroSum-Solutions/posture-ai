import { describe, it, expect } from 'vitest'
import { detectBrowser, detectPlatform, getPermissionGuidance, cameraErrorName } from './permission-guidance'
import type { UAEnvironment } from './permission-guidance'

// Real UA strings (2026-era), one per required combination.
const UA = {
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  firefoxWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  criOSIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.0.0 Mobile/15E148 Safari/604.1',
  fxiOSIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/128.0 Mobile/15E148 Safari/605.1.15',
}

function env(userAgent: string, extra: Partial<UAEnvironment> = {}): UAEnvironment {
  return { userAgent, ...extra }
}

describe('detectBrowser', () => {
  it('Chrome desktop (UA string only)', () => {
    expect(detectBrowser(env(UA.chromeWindows))).toBe('chrome')
  })

  it('Chrome desktop via userAgentData brands', () => {
    expect(
      detectBrowser(
        env(UA.chromeWindows, {
          uaDataBrands: [
            { brand: 'Not_A Brand' },
            { brand: 'Chromium' },
            { brand: 'Google Chrome' },
          ],
        }),
      ),
    ).toBe('chrome')
  })

  it('Edge desktop (UA string only, no "Google Chrome" brand)', () => {
    expect(detectBrowser(env(UA.edgeWindows))).toBe('edge')
  })

  it('Edge desktop via userAgentData brands (Chromium present, no Google Chrome entry)', () => {
    expect(
      detectBrowser(
        env(UA.edgeWindows, {
          uaDataBrands: [
            { brand: 'Chromium' },
            { brand: 'Microsoft Edge' },
            { brand: 'Not=A?Brand' },
          ],
        }),
      ),
    ).toBe('edge')
  })

  it('Safari macOS', () => {
    expect(detectBrowser(env(UA.safariMac))).toBe('safari')
  })

  it('Safari iOS', () => {
    expect(detectBrowser(env(UA.safariIos))).toBe('safari')
  })

  it('Firefox desktop', () => {
    expect(detectBrowser(env(UA.firefoxWindows))).toBe('firefox')
  })

  it('Chrome Android (UA string only)', () => {
    expect(detectBrowser(env(UA.chromeAndroid))).toBe('chrome-android')
  })

  it('Chrome Android via userAgentData brands', () => {
    expect(
      detectBrowser(
        env(UA.chromeAndroid, {
          uaDataBrands: [{ brand: 'Chromium' }, { brand: 'Google Chrome' }],
        }),
      ),
    ).toBe('chrome-android')
  })

  it('iOS Chrome (CriOS) is never mistaken for the desktop Blink engine', () => {
    expect(detectBrowser(env(UA.criOSIphone))).toBe('chrome')
  })

  it('iOS Firefox (FxiOS) is detected via its own token, not generic Firefox/', () => {
    expect(detectBrowser(env(UA.fxiOSIphone))).toBe('firefox')
  })

  it('unrecognized UA falls back to unknown rather than guessing', () => {
    expect(detectBrowser(env('SomeBespokeBrowser/1.0'))).toBe('unknown')
  })
})

describe('detectPlatform', () => {
  it('macOS from UA string', () => {
    expect(detectPlatform(env(UA.chromeMac))).toBe('macos')
  })

  it('macOS from userAgentData.platform', () => {
    expect(detectPlatform(env(UA.chromeMac, { uaDataPlatform: 'macOS' }))).toBe('macos')
  })

  it('iOS from UA string', () => {
    expect(detectPlatform(env(UA.safariIos))).toBe('ios')
  })

  it('Android from UA string', () => {
    expect(detectPlatform(env(UA.chromeAndroid))).toBe('android')
  })

  it('Windows from UA string', () => {
    expect(detectPlatform(env(UA.chromeWindows))).toBe('windows')
  })

  it('unrecognized UA falls back to unknown', () => {
    expect(detectPlatform(env('SomeBespokeBrowser/1.0'))).toBe('unknown')
  })
})

describe('cameraErrorName', () => {
  it('maps a NotAllowedError DOMException-shaped object', () => {
    expect(cameraErrorName(new DOMException('denied', 'NotAllowedError'))).toBe('NotAllowedError')
  })

  it('maps every other error name to unknown', () => {
    expect(cameraErrorName(new DOMException('no camera', 'NotFoundError'))).toBe('unknown')
    expect(cameraErrorName(new DOMException('busy', 'NotReadableError'))).toBe('unknown')
    expect(cameraErrorName(new Error('plain error'))).toBe('unknown')
    expect(cameraErrorName(null)).toBe('unknown')
    expect(cameraErrorName(undefined)).toBe('unknown')
    expect(cameraErrorName('a string')).toBe('unknown')
  })
})

describe('getPermissionGuidance — required browser/platform matrix', () => {
  it('Chrome desktop (Windows), site-level denial: steps point at the address-bar permission UI, no deep link, no reprompt', () => {
    const g = getPermissionGuidance({ browser: 'chrome', platform: 'windows', permissionState: 'denied' })
    expect(g.canRetryPrompt).toBe(false)
    expect(g.systemSettingsDeepLink).toBeNull()
    expect(g.steps.length).toBeGreaterThan(0)
    expect(g.steps.join(' ')).toMatch(/address bar/i)
    expect(g.steps.join(' ')).toMatch(/Camera to Allow/i)
  })

  it('Edge desktop (Windows), site-level denial: Edge-specific wording, no deep link', () => {
    const g = getPermissionGuidance({ browser: 'edge', platform: 'windows', permissionState: 'denied' })
    expect(g.canRetryPrompt).toBe(false)
    expect(g.systemSettingsDeepLink).toBeNull()
    expect(g.reason).toMatch(/Edge/)
    expect(g.steps.join(' ')).toMatch(/address bar/i)
  })

  it('Safari macOS: Websites-pane steps, no forced reprompt, offers the macOS deep link as an attempt', () => {
    const g = getPermissionGuidance({ browser: 'safari', platform: 'macos', permissionState: 'unsupported', errorName: 'NotAllowedError' })
    expect(g.canRetryPrompt).toBe(false)
    expect(g.systemSettingsDeepLink).toBe('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera')
    expect(g.steps.join(' ')).toMatch(/Websites/)
    expect(g.steps.join(' ')).toMatch(/System Settings/)
  })

  it('Safari iOS: no deep link exists (Apple exposes none from web content), and retry is genuinely worth trying', () => {
    const g = getPermissionGuidance({ browser: 'safari', platform: 'ios', permissionState: 'unsupported', errorName: 'NotAllowedError' })
    expect(g.canRetryPrompt).toBe(true)
    expect(g.systemSettingsDeepLink).toBeNull()
    expect(g.steps.join(' ')).toMatch(/Settings app/)
    expect(g.steps.join(' ')).not.toMatch(/x-apple/)
  })

  // Every iOS browser is WebKit with its own row in the Settings app, so the
  // brand must not decide which INSTRUCTIONS are shown — only which app name
  // they use. Matching iOS on Safari alone sent CriOS/EdgiOS/FxiOS to the
  // desktop branches, which name menus that do not exist on a phone.
  it.each([
    ['chrome', 'Chrome', /⋮ menu|address bar/i],
    ['edge', 'Edge', /⋮ menu|address bar/i],
    ['firefox', 'Firefox', /about:preferences/i],
  ] as const)('%s on iOS: gets iOS steps naming the app, never the desktop steps', (browser, appLabel, desktopOnly) => {
    const g = getPermissionGuidance({ browser, platform: 'ios', permissionState: 'unsupported', errorName: 'NotAllowedError' })
    expect(g.steps.join(' ')).toMatch(/Settings app/)
    expect(g.steps.join(' ')).toMatch(new RegExp(appLabel))
    expect(g.steps.join(' ')).not.toMatch(desktopOnly)
    expect(g.reason).toMatch(new RegExp(appLabel))
    expect(g.systemSettingsDeepLink).toBeNull()
  })

  it('Firefox desktop: about:preferences-style steps, no deep link (not macOS)', () => {
    const g = getPermissionGuidance({ browser: 'firefox', platform: 'windows', permissionState: 'denied' })
    expect(g.canRetryPrompt).toBe(false)
    expect(g.systemSettingsDeepLink).toBeNull()
    expect(g.steps.join(' ')).toMatch(/Firefox|Permissions/)
  })

  it('Chrome Android: mentions both the in-app site setting AND the separate OS-level app permission', () => {
    const g = getPermissionGuidance({ browser: 'chrome-android', platform: 'android', permissionState: 'denied' })
    expect(g.canRetryPrompt).toBe(false)
    expect(g.systemSettingsDeepLink).toBeNull()
    expect(g.steps.join(' ')).toMatch(/Site settings/)
    expect(g.steps.join(' ')).toMatch(/Android Settings/)
  })

  it('macOS special case: site permission already granted, browser still failed → OS-level block, distinct steps from a plain site-level denial', () => {
    const g = getPermissionGuidance({ browser: 'chrome', platform: 'macos', permissionState: 'granted', errorName: 'NotAllowedError' })
    expect(g.canRetryPrompt).toBe(false)
    expect(g.systemSettingsDeepLink).toBe('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera')
    expect(g.steps.join(' ')).toMatch(/System Settings/)
    expect(g.steps.join(' ')).toMatch(/Chrome/)
    // Distinct from the plain site-level Chrome-desktop denial copy.
    const plainDenial = getPermissionGuidance({ browser: 'chrome', platform: 'macos', permissionState: 'denied' })
    expect(g.steps).not.toEqual(plainDenial.steps)
    expect(g.reason).not.toBe(plainDenial.reason)
  })

  it('macOS OS-level case also holds for Edge', () => {
    const g = getPermissionGuidance({ browser: 'edge', platform: 'macos', permissionState: 'granted', errorName: 'NotAllowedError' })
    expect(g.steps.join(' ')).toMatch(/Edge/)
    expect(g.systemSettingsDeepLink).not.toBeNull()
  })
})

describe('getPermissionGuidance — canRetryPrompt honesty', () => {
  it('is false whenever the query already reports a persisted denial, on any browser', () => {
    for (const browser of ['chrome', 'edge', 'firefox', 'chrome-android'] as const) {
      const g = getPermissionGuidance({ browser, platform: 'windows', permissionState: 'denied' })
      expect(g.canRetryPrompt).toBe(false)
    }
  })

  it('is false after a NotAllowedError even without a permissionState signal (Firefox/Safari desktop, no query support)', () => {
    const g = getPermissionGuidance({ browser: 'firefox', platform: 'windows', permissionState: 'unsupported', errorName: 'NotAllowedError' })
    expect(g.canRetryPrompt).toBe(false)
  })

  it('is true when there is no negative signal at all (state unknown, no error yet)', () => {
    const g = getPermissionGuidance({ browser: 'chrome', platform: 'windows', permissionState: 'prompt' })
    expect(g.canRetryPrompt).toBe(true)
  })

  it('is true on iOS Safari even after a NotAllowedError, per the documented non-persistence caveat', () => {
    const g = getPermissionGuidance({ browser: 'safari', platform: 'ios', permissionState: 'denied', errorName: 'NotAllowedError' })
    expect(g.canRetryPrompt).toBe(true)
  })
})

describe('getPermissionGuidance — deep link scoping', () => {
  it('is only ever offered on macOS', () => {
    const platforms = ['windows', 'linux', 'android', 'ios', 'unknown'] as const
    for (const platform of platforms) {
      const g = getPermissionGuidance({ browser: 'chrome', platform, permissionState: 'denied' })
      expect(g.systemSettingsDeepLink).toBeNull()
    }
  })

  it('is offered on macOS for every browser guidance branch, including the unknown-browser fallback', () => {
    const g = getPermissionGuidance({ browser: 'unknown', platform: 'macos', permissionState: 'denied' })
    expect(g.systemSettingsDeepLink).not.toBeNull()
  })
})

describe('getPermissionGuidance — every step list is a real, non-empty ordered sequence', () => {
  const combos: Array<Parameters<typeof getPermissionGuidance>[0]> = [
    { browser: 'chrome', platform: 'windows', permissionState: 'denied' },
    { browser: 'chrome', platform: 'linux', permissionState: 'denied' },
    { browser: 'edge', platform: 'windows', permissionState: 'denied' },
    { browser: 'firefox', platform: 'windows', permissionState: 'denied' },
    { browser: 'safari', platform: 'macos', permissionState: 'unsupported', errorName: 'NotAllowedError' },
    { browser: 'safari', platform: 'ios', permissionState: 'unsupported', errorName: 'NotAllowedError' },
    { browser: 'chrome-android', platform: 'android', permissionState: 'denied' },
    { browser: 'chrome', platform: 'macos', permissionState: 'granted', errorName: 'NotAllowedError' },
    { browser: 'unknown', platform: 'unknown', permissionState: 'unsupported', errorName: 'NotAllowedError' },
  ]

  it.each(combos)('%o', input => {
    const g = getPermissionGuidance(input)
    expect(Array.isArray(g.steps)).toBe(true)
    expect(g.steps.length).toBeGreaterThan(0)
    g.steps.forEach(step => expect(typeof step).toBe('string'))
    expect(typeof g.reason).toBe('string')
    expect(g.reason.length).toBeGreaterThan(0)
  })
})

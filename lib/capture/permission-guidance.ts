/**
 * Camera-permission recovery guidance — browser/platform detection plus a pure
 * mapping from (browser, platform, permission state, getUserMedia error) to
 * click-by-click steps.
 *
 * A web page cannot open `chrome://settings/content/camera`,
 * `edge://settings/content/camera`, `about:preferences`, or iOS Settings —
 * these are hard-blocked by every engine's own security model, with no
 * user-confirmation escape hatch. The one narrow exception is a macOS
 * `x-apple.systempreferences:` deep link, which still requires an OS
 * confirmation click every time and is not guaranteed to land on the exact
 * Camera pane on current macOS. This module never promises more than that —
 * `systemSettingsDeepLink` is offered as an attempt, and the ordered `steps`
 * are always present as the real fallback.
 *
 * The `getPermissionGuidance` mapping function is pure (no DOM access) so it
 * is fully unit-testable. `queryCameraPermissionState` and
 * `readUAEnvironment` are the two small DOM-touching helpers callers use to
 * gather its inputs; both feature-detect and fail closed to 'unsupported'.
 */

export type BrowserId = 'chrome' | 'edge' | 'firefox' | 'safari' | 'chrome-android' | 'unknown'
export type PlatformId = 'macos' | 'ios' | 'android' | 'windows' | 'linux' | 'unknown'

/** Mirrors `PermissionState` from the Permissions API, plus 'unsupported' for
 *  engines that don't implement `permissions.query({name:'camera'})` at all
 *  (Firefox throws; Safari has no reliable 'camera' coverage — see module docs
 *  in the capture-permission facts brief). */
export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported'

/** The getUserMedia() exception names relevant to permission recovery. Other
 *  DOMException names (NotFoundError, NotReadableError, ...) are real camera
 *  problems, not permission problems, and are out of scope for this module —
 *  the caller's existing error copy already covers them. */
export type CameraErrorName = 'NotAllowedError' | 'unknown'

export interface PermissionGuidanceInput {
  browser: BrowserId
  platform: PlatformId
  /** From a `permissions.query` preflight, when supported. */
  permissionState: PermissionState
  /** From a getUserMedia() rejection, when that is what triggered this check. */
  errorName?: CameraErrorName
}

export interface PermissionGuidance {
  /** One-line explanation of what's blocking the camera. */
  reason: string
  /** True only when the browser may still show a fresh native permission
   *  prompt on retry. False means the only way back is the browser/OS UI —
   *  no JS API can force a re-prompt once an origin is durably denied. */
  canRetryPrompt: boolean
  /** Ordered, click-by-click recovery steps. */
  steps: string[]
  /** macOS only: an `x-apple.systempreferences:` URL the page can attempt to
   *  open. Gated behind a native OS confirmation dialog every time, and not
   *  guaranteed to land on the exact Camera pane — never the sole recovery
   *  path, always paired with `steps`. */
  systemSettingsDeepLink: string | null
}

const MACOS_CAMERA_DEEP_LINK = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera'

const CHROMIUM_LABEL: Record<'chrome' | 'edge', string> = { chrome: 'Chrome', edge: 'Edge' }

/** How each browser appears as an app row in the iOS Settings list. */
const IOS_APP_LABEL: Partial<Record<BrowserId, string>> = {
  safari: 'Safari',
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
}

function chromiumDesktopSteps(label: string): string[] {
  return [
    `Click the camera icon (or the padlock/tune icon) in ${label}'s address bar.`,
    'Select "Permissions for this site" (or "Site settings").',
    'Set Camera to Allow.',
    'Reload the page and tap Try Again.',
  ]
}

function firefoxDesktopSteps(): string[] {
  return [
    'Click the camera icon at the left of the address bar (it shows a red slash when blocked).',
    'Clear the blocked permission there, or open Settings → Privacy & Security → Permissions → Camera → Settings… and set this site to Allow.',
    'Reload the page and tap Try Again.',
  ]
}

function safariMacSteps(): string[] {
  return [
    'Open the Safari menu and choose Settings (Preferences on older macOS).',
    'Click the Websites tab, then select Camera in the list on the left.',
    'Find this site in the list on the right and set it to Allow.',
    'If it is already set to Allow, open System Settings → Privacy & Security → Camera and turn on the toggle for Safari — Safari cannot tell you which layer is blocking it.',
    'Reload the page and tap Try Again.',
  ]
}

function safariIosSteps(appLabel = 'Safari'): string[] {
  return [
    `Tap Try Again first — iOS ${appLabel} sometimes re-prompts even after a previous denial.`,
    `If nothing happens, open the Settings app (not ${appLabel}), scroll down to ${appLabel}, tap Camera, and set it to Allow. iOS has no reliable per-site camera switch, so this changes the default for every site.`,
    'Return to this page and tap Try Again.',
  ]
}

function chromeAndroidSteps(): string[] {
  return [
    'Tap the ⋮ menu in Chrome, then Settings → Site settings → Camera.',
    'Under "Not allowed", tap this site and set it to Allow.',
    "Also check Android Settings → Apps → Chrome → Permissions → Camera is set to Allow — Chrome needs that too, separately from the site setting.",
    'Reload the page and tap Try Again.',
  ]
}

function genericSteps(): string[] {
  return [
    "Open your browser's site settings or permissions for this page.",
    'Find Camera and set it to Allow.',
    'Reload the page and tap Try Again.',
  ]
}

function macosOsLevelSteps(label: string): string[] {
  return [
    'Open System Settings → Privacy & Security → Camera.',
    `Turn on the toggle next to ${label}.`,
    `Quit and reopen ${label}, then tap Try Again.`,
  ]
}

/**
 * A fresh native prompt is only possible when there's no evidence of a
 * durably denied origin. iOS Safari is the one documented exception — its
 * per-site denial memory is not reliably persistent (see module docs), so a
 * retry can genuinely re-prompt even after a prior denial.
 */
function canRetryPrompt(platform: PlatformId, permissionState: PermissionState, errorName?: CameraErrorName): boolean {
  if (platform === 'ios') return true
  if (permissionState === 'denied') return false
  if (errorName === 'NotAllowedError') return false
  return true
}

export function getPermissionGuidance(input: PermissionGuidanceInput): PermissionGuidance {
  const { browser, platform, permissionState, errorName } = input
  const retryable = canRetryPrompt(platform, permissionState, errorName)
  const deepLink = platform === 'macos' ? MACOS_CAMERA_DEEP_LINK : null

  // The site's own camera permission is granted, but the call still failed —
  // only observable on Chromium (Safari doesn't support permissions.query for
  // 'camera' at all), and specifically the macOS "browser lacks the OS-level
  // camera permission" case: the two failure modes both surface as
  // NotAllowedError with no other distinguishing signal, but a prior granted
  // read rules out a site-level block.
  if (platform === 'macos' && permissionState === 'granted' && errorName === 'NotAllowedError' && (browser === 'chrome' || browser === 'edge')) {
    const label = CHROMIUM_LABEL[browser]
    return {
      reason: `${label} is allowed to use the camera for this site, but macOS is blocking ${label} itself from the camera.`,
      canRetryPrompt: false,
      steps: macosOsLevelSteps(label),
      systemSettingsDeepLink: deepLink,
    }
  }

  // Every iOS browser is WebKit and each one carries its OWN camera switch in
  // the Settings app, so Chrome/Edge/Firefox on iOS need the iOS steps named
  // for that app — never the desktop steps for the same brand. Matching on
  // Safari alone dropped CriOS/EdgiOS/FxiOS through to the desktop branches
  // below and told an iPhone user to open a menu that does not exist there.
  if (platform === 'ios') {
    const appLabel = IOS_APP_LABEL[browser] ?? 'this browser'
    return {
      reason: `Camera access was denied for this page, or is blocked for ${appLabel}.`,
      canRetryPrompt: retryable,
      steps: safariIosSteps(appLabel),
      systemSettingsDeepLink: null, // no supported iOS Settings deep link from web content
    }
  }

  if (platform === 'macos' && browser === 'safari') {
    return {
      reason: 'Camera access for this site is blocked in Safari, or macOS is blocking Safari itself.',
      canRetryPrompt: false,
      steps: safariMacSteps(),
      systemSettingsDeepLink: deepLink,
    }
  }

  if (browser === 'firefox') {
    return {
      reason: 'Camera access for this site is blocked in Firefox.',
      canRetryPrompt: retryable,
      steps: firefoxDesktopSteps(),
      systemSettingsDeepLink: deepLink,
    }
  }

  if (browser === 'chrome-android') {
    return {
      reason: 'Camera access for this site is blocked in Chrome, or Chrome itself lacks Android’s camera permission.',
      canRetryPrompt: retryable,
      steps: chromeAndroidSteps(),
      systemSettingsDeepLink: null,
    }
  }

  if (browser === 'chrome' || browser === 'edge') {
    const label = CHROMIUM_LABEL[browser]
    return {
      reason: `Camera access for this site is blocked in ${label}.`,
      canRetryPrompt: retryable,
      steps: chromiumDesktopSteps(label),
      systemSettingsDeepLink: deepLink,
    }
  }

  return {
    reason: 'Camera access for this site is blocked.',
    canRetryPrompt: retryable,
    steps: genericSteps(),
    systemSettingsDeepLink: deepLink,
  }
}

// ---- browser/platform detection ----

export interface UAEnvironment {
  userAgent: string
  /** `navigator.userAgentData?.brands`, when the engine supports UA-CH (Chromium desktop/Android only). */
  uaDataBrands?: { brand: string }[]
  /** `navigator.userAgentData?.platform`, when supported. */
  uaDataPlatform?: string
}

/**
 * Chromium desktop/Android exposes `userAgentData.brands` — checked first,
 * iterating (never indexing) because Chrome injects a randomized-spelling
 * "greased" fake brand entry to stop brittle hardcoded parsing. Everywhere
 * else (Safari, Firefox, iOS) falls back to the UA string, specifically
 * checking `CriOS`/`FxiOS`/`EdgiOS` so a WebKit-wrapped iOS browser is never
 * mistaken for its desktop engine.
 */
export function detectBrowser(env: UAEnvironment): BrowserId {
  const ua = env.userAgent || ''
  const isAndroidUA = /Android/.test(ua)

  if (env.uaDataBrands && env.uaDataBrands.length > 0) {
    const names = env.uaDataBrands.map(b => b.brand)
    if (names.some(n => n.includes('Microsoft Edge'))) return 'edge'
    if (names.some(n => n.includes('Google Chrome'))) return isAndroidUA ? 'chrome-android' : 'chrome'
  }

  if (/EdgiOS\//.test(ua) || /EdgA\//.test(ua) || /Edg\//.test(ua)) return 'edge'
  if (/FxiOS\//.test(ua)) return 'firefox' // iOS Firefox — WebKit-wrapped, self-identifies via FxiOS
  if (/CriOS\//.test(ua)) return isAndroidUA ? 'chrome-android' : 'chrome' // iOS Chrome — WebKit-wrapped
  if (/Firefox\//.test(ua)) return 'firefox'
  if (isAndroidUA && /Chrome\//.test(ua)) return 'chrome-android'
  if (/Chrome\//.test(ua) || /Chromium\//.test(ua)) return 'chrome'
  if (/Safari\//.test(ua) && !/Chrome/.test(ua) && !/CriOS/.test(ua)) return 'safari'
  return 'unknown'
}

export function detectPlatform(env: UAEnvironment): PlatformId {
  const ua = env.userAgent || ''
  const uaPlatform = (env.uaDataPlatform || '').toLowerCase()
  if (uaPlatform === 'macos') return 'macos'
  if (uaPlatform === 'android') return 'android'
  if (uaPlatform === 'windows') return 'windows'
  if (uaPlatform === 'chrome os' || uaPlatform === 'linux') return 'linux'

  if (/iPhone|iPad|iPod/.test(ua)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  if (/Macintosh|Mac OS X/.test(ua)) return 'macos'
  if (/Windows/.test(ua)) return 'windows'
  if (/Linux/.test(ua)) return 'linux'
  return 'unknown'
}

/** Reads the two UA signals off `navigator` directly — a thin DOM-touching
 *  wrapper so `detectBrowser`/`detectPlatform` stay pure and testable. */
export function readUAEnvironment(): UAEnvironment {
  const nav = navigator as Navigator & { userAgentData?: { brands?: { brand: string }[]; platform?: string } }
  return {
    userAgent: nav.userAgent,
    uaDataBrands: nav.userAgentData?.brands,
    uaDataPlatform: nav.userAgentData?.platform,
  }
}

/** Maps a caught getUserMedia() error to the one name this module acts on. */
export function cameraErrorName(err: unknown): CameraErrorName {
  if (err && typeof err === 'object' && 'name' in err && (err as { name: unknown }).name === 'NotAllowedError') {
    return 'NotAllowedError'
  }
  return 'unknown'
}

/**
 * Preflight permission read. Feature-detects `permissions.query` (Chromium
 * only — Firefox throws a TypeError on the 'camera' descriptor and Safari has
 * no reliable coverage), reporting any absence or failure as 'unsupported'
 * rather than guessing.
 */
export async function queryCameraPermissionState(): Promise<PermissionState> {
  if (typeof navigator === 'undefined' || !('permissions' in navigator) || typeof navigator.permissions?.query !== 'function') {
    return 'unsupported'
  }
  try {
    const status = await navigator.permissions.query({ name: 'camera' as PermissionName })
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') return status.state
    return 'unsupported'
  } catch {
    return 'unsupported'
  }
}

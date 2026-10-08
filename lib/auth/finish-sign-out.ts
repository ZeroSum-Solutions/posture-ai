import { safeNextPath } from './safe-next'

/**
 * The browser half of a confirmed sign-out. The offline training queue is
 * cleared and awaited before navigation: AuthSessionGuard also clears it on the
 * SIGNED_OUT event, but fire-and-forget, so an immediate page unload could
 * abort that IndexedDB write and leave the previous account's pending changes
 * on the device.
 */
export async function finishBrowserSignOut(steps: {
  signOut: () => Promise<unknown>
  clearOfflineQueue: () => Promise<void>
  navigate: () => void
}): Promise<void> {
  await steps.signOut()
  try {
    await steps.clearOfflineQueue()
  } catch (cause) {
    console.error('[training-offline] sign-out clear failed', cause)
  }
  steps.navigate()
}

let leaving = false

/**
 * One page-leaving navigation per document. Settings and AuthSessionGuard both
 * react to the same sign-out; a second location.assign cancels the first in
 * WebKit, so whichever runs first wins.
 */
export function assignLocationOnce(url: string, location: Pick<Location, 'assign'> = window.location): void {
  if (leaving) return
  leaving = true
  location.assign(safeNextPath(url))
}

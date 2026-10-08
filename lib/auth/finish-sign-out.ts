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

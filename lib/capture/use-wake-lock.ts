import { useCallback, useEffect, useRef } from 'react'

/**
 * Best-effort Screen Wake Lock, extracted from FullScreenCapture so both the
 * capture flow and the workout player keep the screen on during a live session
 * without duplicating the (subtle) lifecycle handling.
 *
 * `acquire()` marks the lock as intended-held and requests it; `release()` clears
 * that intent and drops the sentinel. The hook re-requests the lock automatically
 * when the tab becomes visible again *while still intended-held* (the OS drops a
 * wake lock when the tab is backgrounded), and always releases on unmount. All
 * failures are swallowed — a missing Wake Lock API must never break playback.
 */
type WakeLockSentinelLike = {
  release(): Promise<void>
  addEventListener?(type: 'release', listener: () => void): void
}
type WakeLockNavigator = Navigator & {
  wakeLock: { request(type: 'screen'): Promise<WakeLockSentinelLike> }
}

export function useWakeLock(): { acquire: () => Promise<void>; release: () => void } {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null)
  const wantRef = useRef(false)
  const mountedRef = useRef(true)

  const acquire = useCallback(async () => {
    wantRef.current = true
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator) || sentinelRef.current) return
    try {
      const sentinel = await (navigator as WakeLockNavigator).wakeLock.request('screen')
      // Torn down (or released) while the request was pending — don't leak it.
      if (!mountedRef.current || !wantRef.current) {
        sentinel.release().catch(() => {})
        return
      }
      sentinelRef.current = sentinel
      sentinel.addEventListener?.('release', () => {
        sentinelRef.current = null
      })
    } catch {
      // Wake lock is best-effort — silently ignore failures.
    }
  }, [])

  const release = useCallback(() => {
    wantRef.current = false
    if (sentinelRef.current) {
      sentinelRef.current.release().catch(() => {})
      sentinelRef.current = null
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const onVisible = () => {
      if (document.visibilityState === 'visible' && wantRef.current) void acquire()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      mountedRef.current = false
      document.removeEventListener('visibilitychange', onVisible)
      if (sentinelRef.current) {
        sentinelRef.current.release().catch(() => {})
        sentinelRef.current = null
      }
      wantRef.current = false
    }
  }, [acquire])

  return { acquire, release }
}

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
  const requestPendingRef = useRef(false)
  const requestGenerationRef = useRef(0)
  const wantRef = useRef(false)
  const mountedRef = useRef(true)

  const acquire = useCallback(async function acquireRequestedWakeLock() {
    wantRef.current = true
    if (
      typeof navigator === 'undefined'
      || !('wakeLock' in navigator)
      || document.visibilityState !== 'visible'
      || sentinelRef.current
      || requestPendingRef.current
    ) return
    const requestGeneration = ++requestGenerationRef.current
    let shouldReacquire = false
    requestPendingRef.current = true
    try {
      const sentinel = await (navigator as WakeLockNavigator).wakeLock.request('screen')
      // Torn down, released, or backgrounded while the request was pending —
      // don't install a stale sentinel after a newer visibility lifecycle.
      if (
        !mountedRef.current
        || !wantRef.current
        || document.visibilityState !== 'visible'
        || requestGenerationRef.current !== requestGeneration
      ) {
        shouldReacquire = requestGenerationRef.current !== requestGeneration
        Promise.resolve(sentinel.release()).catch(() => {})
        return
      }
      sentinelRef.current = sentinel
      sentinel.addEventListener?.('release', () => {
        // A delayed event from a lock we already replaced must not clear the
        // newer sentinel (rapid release → reacquire is possible on resume).
        if (sentinelRef.current !== sentinel) return
        sentinelRef.current = null
        // Some browsers publish `visibilitychange: visible` before delivering
        // the old sentinel's release event. That visible event cannot acquire
        // while the old sentinel is still registered, so recover here too.
        queueMicrotask(() => {
          if (wantRef.current && document.visibilityState === 'visible') void acquireRequestedWakeLock()
        })
      })
    } catch {
      // Wake lock is best-effort — silently ignore failures.
    } finally {
      requestPendingRef.current = false
      if (
        shouldReacquire
        && mountedRef.current
        && wantRef.current
        && document.visibilityState === 'visible'
        && !sentinelRef.current
      ) void acquireRequestedWakeLock()
    }
  }, [])

  const release = useCallback(() => {
    wantRef.current = false
    requestGenerationRef.current += 1
    if (sentinelRef.current) {
      Promise.resolve(sentinelRef.current.release()).catch(() => {})
      sentinelRef.current = null
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const onVisible = () => {
      if (document.visibilityState === 'hidden') {
        // The browser owns release of an already-issued sentinel when the page
        // backgrounds. Invalidate only pending ownership here; its eventual
        // result is released by the generation check above. This also handles
        // browsers that deliver the sentinel release event after visibility.
        requestGenerationRef.current += 1
        return
      }
      if (wantRef.current) void acquire()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      mountedRef.current = false
      requestGenerationRef.current += 1
      document.removeEventListener('visibilitychange', onVisible)
      if (sentinelRef.current) {
        Promise.resolve(sentinelRef.current.release()).catch(() => {})
        sentinelRef.current = null
      }
      wantRef.current = false
    }
  }, [acquire])

  return { acquire, release }
}

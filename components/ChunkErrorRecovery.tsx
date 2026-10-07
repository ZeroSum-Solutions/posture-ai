'use client'

import { useEffect } from 'react'

const RELOAD_FLAG = 'pa:chunk-reload'
const CHUNK_ERROR_PATTERN = /ChunkLoadError|Loading chunk [\w.-]+ failed|failed to fetch dynamically imported module/i

function isChunkLoadError(message: string | null | undefined): boolean {
  return Boolean(message) && CHUNK_ERROR_PATTERN.test(message as string)
}

/**
 * A long-lived tab left open across a deploy can reference bundle chunks the
 * server no longer serves. Reload once (never loop — guarded by
 * sessionStorage) so the tab recovers on its own instead of showing a broken
 * screen until the practitioner notices and refreshes by hand.
 */
export default function ChunkErrorRecovery() {
  useEffect(() => {
    function recover(message: string | null | undefined) {
      if (!isChunkLoadError(message)) return
      try {
        if (sessionStorage.getItem(RELOAD_FLAG) === '1') return
        sessionStorage.setItem(RELOAD_FLAG, '1')
      } catch {
        // Storage can be unavailable (private mode); skip the reload rather
        // than risk looping with no way to remember it already happened.
        return
      }
      window.location.reload()
    }

    function onError(event: ErrorEvent) {
      recover(event.message ?? event.error?.message)
    }
    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason as { message?: string } | string | undefined
      recover(typeof reason === 'string' ? reason : reason?.message)
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}

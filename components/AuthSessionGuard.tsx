'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { isPublicPath } from '@/lib/auth/public-paths'

export function shouldClearForAuthEvent(event: string, pathname: string): boolean {
  return event === 'SIGNED_OUT' && !isPublicPath(pathname)
}

/**
 * Clears protected UI when Supabase broadcasts a sign-out from another tab.
 * The proxy remains authoritative on the next request; this closes the period
 * where already-rendered client information would otherwise remain visible.
 */
export default function AuthSessionGuard({
  pathname,
  children,
}: {
  pathname: string
  children: ReactNode
}) {
  const [signedOut, setSignedOut] = useState(false)

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (!shouldClearForAuthEvent(event, pathname)) return
      setSignedOut(true)
      // Yield once so React removes protected content before navigation starts.
      window.setTimeout(() => {
        window.location.assign('/auth/sign-in?reason=signed_out')
      }, 0)
    })
    return () => subscription.unsubscribe()
  }, [pathname])

  if (signedOut) {
    return (
      <main role="status" aria-live="polite" className="app-standard-page">
        <div className="app-panel app-empty-state">
          <div>
            <h1>Session ended</h1>
            <p>This device was signed out. Returning to the secure sign-in page…</p>
          </div>
        </div>
      </main>
    )
  }

  return children
}

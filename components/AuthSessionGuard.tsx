'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { isPublicPath } from '@/lib/auth/public-paths'
import { Surface } from '@/components/array/Surface'

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
      <main
        role="status"
        aria-live="polite"
        className="app-screen app-screen-x"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}
      >
        <Surface tier="feature">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
            <h1 className="t-headline-sm">Session ended</h1>
            <p className="t-body">This device was signed out. Returning to the secure sign-in page…</p>
          </div>
        </Surface>
      </main>
    )
  }

  return children
}

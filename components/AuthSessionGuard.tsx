'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { isPublicPath } from '@/lib/auth/public-paths'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  synchronizeTrainingOfflineAuth,
  trainingOfflineAuthState,
  type TrainingOfflineAuthState,
} from '@/lib/training/offline'
export function shouldClearForAuthEvent(event: string, pathname: string): boolean {
  return event === 'SIGNED_OUT' && !isPublicPath(pathname)
}

export function shouldClearForAccountChange(pathname: string, previousUserId: string | null, nextUserId: string | null): boolean {
  return !isPublicPath(pathname) && previousUserId !== null && nextUserId !== null && previousUserId !== nextUserId
}

export async function synchronizeTrainingOfflineForAuthEvent(
  event: string,
  userId: string | null,
  synchronize: (state: TrainingOfflineAuthState) => Promise<void> = synchronizeTrainingOfflineAuth,
): Promise<void> {
  await synchronize(trainingOfflineAuthState(event, userId))
}

/**
 * Clears protected UI when Supabase broadcasts a sign-out from another tab.
 * The proxy remains authoritative on the next request; this closes the period
 * where already-rendered client information would otherwise remain visible.
 */
export default function AuthSessionGuard({
  pathname,
  renderedUserId = null,
  children,
}: {
  pathname: string
  renderedUserId?: string | null
  children: ReactNode
}) {
  const [endedReason, setEndedReason] = useState<'signed_out' | 'account_changed' | null>(null)
  const observedUserId = useRef(renderedUserId)
  const navigationTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (navigationTimer.current !== null) window.clearTimeout(navigationTimer.current)
  }, [])

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user.id ?? null
      const changed = shouldClearForAccountChange(pathname, observedUserId.current, nextUserId)
      if (nextUserId) observedUserId.current = nextUserId
      void synchronizeTrainingOfflineForAuthEvent(event, nextUserId)
        .catch(cause => console.error('[training-offline] auth synchronization failed', cause))
      if (!changed && !shouldClearForAuthEvent(event, pathname)) return
      if (navigationTimer.current !== null) return
      setEndedReason(changed ? 'account_changed' : 'signed_out')
      // Yield once so React removes protected content before navigation starts.
      navigationTimer.current = window.setTimeout(() => {
        window.location.assign(changed ? window.location.href : '/auth/sign-in?reason=signed_out')
      }, 0)
    })
    return () => subscription.unsubscribe()
  }, [pathname])

  if (endedReason) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="app-screen app-screen-x"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}
      >
        <EmptyState
          variant="page"
          icon={endedReason === 'account_changed' ? 'square-transfer-horizontal-linear' : 'lock-keyhole-minimalistic-linear'}
          title={endedReason === 'account_changed' ? 'Account changed' : 'Session ended'}
          body={endedReason === 'account_changed'
            ? 'Reloading this page for the current account…'
            : 'This device was signed out. Returning to the secure sign-in page…'}
        />
      </div>
    )
  }

  return children
}

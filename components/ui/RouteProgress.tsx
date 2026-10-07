'use client'

import { motion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { spring } from '@/lib/motion'
import styles from './RouteProgress.module.css'

const SHOW_DELAY_MS = 300
const SETTLE_MS = 200

/**
 * A 2px top bar on client navigations that take over 300ms (spec §6.1.7).
 * Detected on link clicks and `popstate` rather than a Next.js router event —
 * simple and safe, per the brief, for an App Router version whose internal
 * navigation lifecycle isn't exposed as a clean hook here.
 */
export default function RouteProgress() {
  const pathname = usePathname() ?? ''
  const [visible, setVisible] = useState(false)
  const [complete, setComplete] = useState(false)
  const [renderedPathname, setRenderedPathname] = useState(pathname)
  const pendingRef = useRef(false)
  const showTimerRef = useRef<number | null>(null)

  useEffect(() => {
    function armPending() {
      pendingRef.current = true
      if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current)
      showTimerRef.current = window.setTimeout(() => {
        if (pendingRef.current) setVisible(true)
      }, SHOW_DELAY_MS)
    }

    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return
      let url: URL
      try {
        url = new URL(anchor.href, window.location.href)
      } catch {
        return
      }
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      armPending()
    }

    document.addEventListener('click', onClick, true)
    window.addEventListener('popstate', armPending)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('popstate', armPending)
      if (showTimerRef.current !== null) window.clearTimeout(showTimerRef.current)
    }
  }, [])

  // "Adjusting state when a prop changes" (react.dev): the navigation that
  // `visible` was tracking just committed, so mark the bar complete — done
  // during render, not in an effect, so it can't trigger an extra render pass.
  if (pathname !== renderedPathname) {
    setRenderedPathname(pathname)
    if (visible) setComplete(true)
  }

  // Ref bookkeeping belongs in an effect (refs are read/written outside
  // render), one tick behind the state flip above — harmless, since this
  // only resets the click handler's "already armed" guard.
  useEffect(() => {
    pendingRef.current = false
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
  }, [renderedPathname])

  useEffect(() => {
    if (!complete) return
    const timer = window.setTimeout(() => {
      setVisible(false)
      setComplete(false)
    }, SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [complete])

  if (!visible) return null

  return (
    <div className={styles.track} role="presentation" aria-hidden="true">
      <motion.div
        className={styles.bar}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: complete ? 1 : 0.85 }}
        transition={complete ? { duration: 0.2, ease: 'easeOut' } : spring.loader}
      />
    </div>
  )
}

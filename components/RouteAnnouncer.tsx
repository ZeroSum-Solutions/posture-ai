'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * Route-change accessibility: a visually hidden polite live region announces
 * the new page, and focus moves to the page's `<h1>` (or `#main` if the page
 * has none) so a screen-reader or keyboard user lands somewhere meaningful
 * instead of staying on a now-stale control. Never fires on the first paint —
 * only a client-side navigation counts as a "route change".
 */
export default function RouteAnnouncer() {
  const pathname = usePathname() ?? ''
  const [message, setMessage] = useState('')
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    // Let the new route's DOM commit (and the entrance transition start)
    // before reading its heading and moving focus.
    const frame = requestAnimationFrame(() => {
      const main = document.getElementById('main')
      const heading = main?.querySelector('h1') ?? null
      const text = heading?.textContent?.trim() || document.title
      setMessage(text)

      const target = heading ?? main
      if (!target) return
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
      target.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [pathname])

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {message}
    </div>
  )
}

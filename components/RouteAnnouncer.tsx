'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

/**
 * Route-change accessibility: Next.js announces the new page; this moves focus
 * to the page's `<h1>` (or `#main` if the page
 * has none) so a screen-reader or keyboard user lands somewhere meaningful
 * instead of staying on a now-stale control. Never fires on the first paint —
 * only a client-side navigation counts as a "route change".
 */
export default function RouteAnnouncer() {
  const pathname = usePathname() ?? ''
  // The last path focus was handled for. Comparing paths (not a first-render
  // flag) keeps Strict Mode's double effect run from counting as a navigation
  // and tagging the h1 before streamed regions hydrate.
  const lastPath = useRef(pathname)

  useEffect(() => {
    if (lastPath.current === pathname) return
    lastPath.current = pathname
    // Let the new route's DOM commit (and the entrance transition start)
    // before reading its heading and moving focus.
    const frame = requestAnimationFrame(() => {
      const main = document.getElementById('main')
      const heading = main?.querySelector('h1') ?? null

      const target = heading ?? main
      if (!target) return
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
      target.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [pathname])

  // Next.js's own route announcer speaks the new page title; this component
  // only moves focus (a second live region would double the announcement and
  // collide with pages' own role="status" regions).
  return null
}

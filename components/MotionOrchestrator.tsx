'use client'

import { motion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import * as React from 'react'
import { useState, type ReactNode } from 'react'
import { spring } from '@/lib/motion'
import { shouldAnimateRouteEntrance } from './motionOrchestratorPolicy'
import { consumeNavigationDirection } from './routeDirection'

type VTProps = { enter?: string; exit?: string; default?: string; update?: string; children: ReactNode }

// React's <ViewTransition> ships in the canary React that the Next.js App
// Router bundles; the stable react package (unit tests) does not export it.
// Same guard as components/ui/Morph.tsx.
const ViewTransition = (React as unknown as { ViewTransition?: React.ComponentType<VTProps> }).ViewTransition

/**
 * One route-level entrance; descendants remain untouched during hydration.
 * This is the shell's only `<main>` (DESIGN.md › Accessibility): every page
 * component renders a `<div>`/`<section>` instead.
 *
 * Where React's <ViewTransition> exists (the App Router runtime), the route
 * change is a browser view transition: the old page fades out fast and the
 * new one crossfades in with an 8px rise (6px settle from above on Back) —
 * the `.route` / `.route-back` classes at the end of app/globals.css
 * ("overlays lane"). It is keyed by pathname, so only navigations animate:
 * `router.refresh()`, Suspense reveals and other transitions inside a page
 * produce no route animation (`default="none"`). `<main>` itself is never
 * transformed, so focus handling (RouteAnnouncer) and the reduced-motion
 * contract (globals zero every ::view-transition animation) are unchanged.
 *
 * Without ViewTransition (unit tests) the previous framer entrance remains:
 * opacity + translateY only, entrance only.
 */
export default function MotionOrchestrator({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? ''

  // "Adjusting state when a prop changes" (react.dev): resolved once per
  // pathname change, not on every render, with no effect needed.
  const [renderedPathname, setRenderedPathname] = useState(pathname)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  if (pathname !== renderedPathname) {
    setDirection(consumeNavigationDirection())
    setRenderedPathname(pathname)
  }

  if (!shouldAnimateRouteEntrance(pathname)) {
    return <main id="main" className="app-shell-main">{children}</main>
  }

  if (ViewTransition) {
    return (
      <main id="main" className="app-shell-main">
        <ViewTransition key={pathname} enter={direction === 'back' ? 'route-back' : 'route'} exit="route" default="none">
          <div className="app-route">{children}</div>
        </ViewTransition>
      </main>
    )
  }

  // A small vertical lift (forward) or settle (back).
  const y = direction === 'back' ? -6 : 8

  return (
    <motion.main
      key={pathname}
      id="main"
      className="app-shell-main"
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.page}
    >
      {children}
    </motion.main>
  )
}

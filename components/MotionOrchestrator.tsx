'use client'

import { motion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { spring } from '@/lib/motion'
import { shouldAnimateRouteEntrance } from './motionOrchestratorPolicy'
import { consumeNavigationDirection } from './routeDirection'

/**
 * One route-level entrance; descendants remain untouched during hydration.
 * This is the shell's only `<main>` (DESIGN.md › Accessibility, spec §2.8,
 * §6.2, §7.12): every page component renders a `<div>`/`<section>` instead.
 *
 * Direction-aware per spec §6.2: a forward navigation (Link click,
 * `router.push`) enters from +24px, a browser Back/Forward enters from -24px.
 * Entrance only: an exit animation (AnimatePresence) would hold the old App
 * Router tree on screen during navigation. Reduced motion removes the transform
 * (MotionConfig reducedMotion="user").
 */
export default function MotionOrchestrator({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? ''

  // "Adjusting state when a prop changes" (react.dev): resolved once per
  // pathname change, not on every render, with no effect needed — calling
  // setState conditionally during render like this is the documented pattern
  // for deriving state from a prop that just changed.
  const [renderedPathname, setRenderedPathname] = useState(pathname)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  if (pathname !== renderedPathname) {
    setDirection(consumeNavigationDirection())
    setRenderedPathname(pathname)
  }

  if (!shouldAnimateRouteEntrance(pathname)) {
    return <main id="main" className="app-shell-main">{children}</main>
  }

  const x = direction === 'back' ? -24 : 24

  return (
    <motion.main
      key={pathname}
      id="main"
      className="app-shell-main"
      initial={{ opacity: 0, x }}
      animate={{ opacity: 1, x: 0 }}
      transition={spring.page}
    >
      {children}
    </motion.main>
  )
}

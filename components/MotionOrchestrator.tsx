'use client'

import { motion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { shouldAnimateRouteEntrance } from './motionOrchestratorPolicy'

/** One route-level entrance; descendants remain untouched during hydration. */
export default function MotionOrchestrator({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? ''

  if (!shouldAnimateRouteEntrance(pathname)) {
    return <main className="app-shell-main">{children}</main>
  }

  return (
    <motion.main
      key={pathname}
      className="app-shell-main"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.main>
  )
}

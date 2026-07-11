'use client'

import { MotionConfig, motion } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import AppAtmosphere from './AppAtmosphere'
import NavBar from './NavBar'

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? ''
  const showAtmosphere = pathname !== '/' && !pathname.startsWith('/auth') && !pathname.startsWith('/onboarding')

  return (
    <MotionConfig reducedMotion="user">
      <div className={showAtmosphere ? 'app-shell app-shell--immersive' : 'app-shell'}>
        {showAtmosphere && <AppAtmosphere />}
        <NavBar />
        <motion.main
          key={pathname}
          className="app-shell-main"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </motion.main>
        <footer className="app-footer">
          <div>Screening only — not a medical diagnosis. Consult a qualified healthcare professional before making any clinical decisions.</div>
          <div className="app-footer-links">
            <Link href="/privacy">Privacy Policy</Link>
            <span aria-hidden="true">·</span>
            <Link href="/terms">Terms of Use</Link>
          </div>
        </footer>
      </div>
    </MotionConfig>
  )
}

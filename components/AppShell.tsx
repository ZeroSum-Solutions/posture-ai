'use client'

import { MotionConfig } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import AppAtmosphere from './AppAtmosphere'
import NavBar from './NavBar'
import MotionOrchestrator from './MotionOrchestrator'
import { shouldRenderAppAtmosphere } from './appAtmospherePolicy'

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? ''
  const showAtmosphere = shouldRenderAppAtmosphere(pathname)

  return (
    <MotionConfig reducedMotion="user">
      <div className={showAtmosphere ? 'app-shell app-shell--immersive' : 'app-shell'}>
        {showAtmosphere && <AppAtmosphere />}
        <NavBar />
        <MotionOrchestrator>{children}</MotionOrchestrator>
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

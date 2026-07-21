'use client'

import { MotionConfig } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import AppAtmosphere from './AppAtmosphere'
import NavBar from './NavBar'
import MotionOrchestrator from './MotionOrchestrator'
import AuthSessionGuard from './AuthSessionGuard'
import { shouldRenderAppAtmosphere } from './appAtmospherePolicy'
import LegalNotice from './LegalNotice'

export default function AppShell({
  children,
  clinicalContentEnabled,
}: {
  children: ReactNode
  clinicalContentEnabled: boolean
}) {
  const pathname = usePathname() ?? ''
  const showAtmosphere = shouldRenderAppAtmosphere(pathname)

  return (
    <MotionConfig reducedMotion="user">
      <div className={showAtmosphere ? 'app-shell app-shell--immersive' : 'app-shell'}>
        {showAtmosphere && <AppAtmosphere />}
        <AuthSessionGuard pathname={pathname}>
          <NavBar clinicalContentEnabled={clinicalContentEnabled} />
          <MotionOrchestrator>{children}</MotionOrchestrator>
        </AuthSessionGuard>
        <footer className="app-footer">
          <LegalNotice kind="screening_notice" compact />
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

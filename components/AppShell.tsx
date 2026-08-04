'use client'

import { MotionConfig } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import AmbientField from './array/AmbientField'
import IslandNav from './array/IslandNav'
import { shouldRenderAmbientField } from './array/fieldPolicy'
import MotionOrchestrator from './MotionOrchestrator'
import AuthSessionGuard from './AuthSessionGuard'
import LegalNotice from './LegalNotice'

export default function AppShell({
  children,
  clinicalContentEnabled,
}: {
  children: ReactNode
  clinicalContentEnabled: boolean
}) {
  const pathname = usePathname() ?? ''

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-shell">
        {shouldRenderAmbientField(pathname) && <AmbientField />}
        <AuthSessionGuard pathname={pathname}>
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
        <IslandNav clinicalContentEnabled={clinicalContentEnabled} />
      </div>
    </MotionConfig>
  )
}

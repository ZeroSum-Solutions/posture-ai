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
        {/* Disclaimers are one line. The governed screening document still renders
            in full where it legally matters — capture, assessment results and the
            privacy page — rather than under every screen in the app. */}
        <footer className="app-footer">
          <p>Screening support only — not a medical diagnosis.</p>
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

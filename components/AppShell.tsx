'use client'

import { MotionConfig } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import AmbientField from './array/AmbientField'
import { shouldRenderAmbientField } from './array/fieldPolicy'
import AuthSessionGuard from './AuthSessionGuard'
import ChunkErrorRecovery from './ChunkErrorRecovery'
import MotionOrchestrator from './MotionOrchestrator'
import RouteAnnouncer from './RouteAnnouncer'
import TabBar from './ui/TabBar'
import RouteProgress from './ui/RouteProgress'
import { ToastProvider } from './ui/Toast'
import { isTabBarHidden, type TabBarAudience } from './ui/tabBarPolicy'

export default function AppShell({
  children,
  clinicalContentEnabled,
  navigationAudience,
  renderedUserId,
}: {
  children: ReactNode
  clinicalContentEnabled: boolean
  navigationAudience: TabBarAudience
  renderedUserId: string | null
}) {
  const pathname = usePathname() ?? ''
  const tabBarHidden = isTabBarHidden(pathname)

  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
      {/* The shell's own chrome-bottom contract (app/globals.css) reads this
          attribute: a hidden tab bar means the var drops to just the safe
          area instead of tab-bar-height + safe area. */}
      <div className="app-shell" data-tabbar-hidden={tabBarHidden ? 'true' : undefined}>
        {/* First focusable element in the shell, per DESIGN.md › Accessibility. */}
        <nav aria-label="Skip links"><a href="#main" className="skip-link">Skip to content</a></nav>
        <ChunkErrorRecovery />
        <RouteProgress />
        <RouteAnnouncer />
        {shouldRenderAmbientField(pathname) && <AmbientField />}
        <AuthSessionGuard pathname={pathname} renderedUserId={renderedUserId}>
          <MotionOrchestrator>{children}</MotionOrchestrator>
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
          <TabBar clinicalContentEnabled={clinicalContentEnabled} audience={navigationAudience} />
        </AuthSessionGuard>
      </div>
      </ToastProvider>
    </MotionConfig>
  )
}

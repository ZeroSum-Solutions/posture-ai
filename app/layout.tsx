import type { Metadata, Viewport } from 'next'
import { Inter, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import AppShell from '@/components/AppShell'
import { siteOrigin } from '@/lib/site-origin'
import { serverClinicalContentAccess } from '@/lib/clinical-content/database'

// Clinical release activation is runtime authority. Never bake a fixture-enabled
// navigation shell or gated child page into a build artifact.
export const dynamic = 'force-dynamic'

const uiFont = Inter({
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
})

const dataFont = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-data',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: {
    default: 'Posture AI',
    template: '%s · Posture AI',
  },
  description: 'AI-assisted posture and musculoskeletal screening',
  openGraph: {
    title: 'Posture AI',
    description: 'AI-assisted posture and musculoskeletal screening',
    url: siteOrigin,
    siteName: 'Posture AI',
  },
}

export const viewport: Viewport = {
  themeColor: '#000000',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const clinicalAccess = await serverClinicalContentAccess()
  const clinicalContentEnabled = clinicalAccess.surfaces.recommendations
    || clinicalAccess.surfaces.knowledgeLinks
  return (
    <html lang="en" className={`${uiFont.variable} ${dataFont.variable}`}>
      <body>
        <AppShell clinicalContentEnabled={clinicalContentEnabled}>{children}</AppShell>
      </body>
    </html>
  )
}

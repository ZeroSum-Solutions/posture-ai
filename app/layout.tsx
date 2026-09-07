import type { Metadata, Viewport } from 'next'
import { Roboto } from 'next/font/google'
import './globals.css'
import AppShell from '@/components/AppShell'
import { siteOrigin } from '@/lib/site-origin'
import { currentPractitionerClinicalContentAccess } from '@/lib/clinical-content/current-practitioner'

// Clinical release activation is runtime authority. Never bake a fixture-enabled
// navigation shell or gated child page into a build artifact.
export const dynamic = 'force-dynamic'

/**
 * Roboto only. 100 carries the large readouts, 300 the headlines and body, 400
 * card titles, 500 labels and actions. IBM Plex Mono is gone — numerals are
 * Roboto Light with tabular figures.
 */
const uiFont = Roboto({
  subsets: ['latin'],
  weight: ['100', '300', '400', '500'],
  variable: '--font-ui',
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
  // The field runs to the edges and the island sits on the safe area.
  viewportFit: 'cover',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const clinicalAccess = await currentPractitionerClinicalContentAccess()
  const clinicalContentEnabled = clinicalAccess.surfaces.recommendations
    || clinicalAccess.surfaces.knowledgeLinks
  return (
    <html lang="en" className={uiFont.variable}>
      <body>
        <AppShell clinicalContentEnabled={clinicalContentEnabled}>{children}</AppShell>
      </body>
    </html>
  )
}

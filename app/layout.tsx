import type { Metadata, Viewport } from 'next'
import './globals.css'
import AppShell from '@/components/AppShell'
import { siteOrigin } from '@/lib/site-origin'
import { currentPractitionerClinicalContentAccess } from '@/lib/clinical-content/current-practitioner'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireTrainingServerActor } from '@/lib/training/access/server-actor'

// Clinical release activation is runtime authority. Never bake a fixture-enabled
// navigation shell or gated child page into a build artifact.
export const dynamic = 'force-dynamic'

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
  // The field runs to the edges and the tab bar sits on the safe area.
  viewportFit: 'cover',
  // The keyboard resizes the layout viewport rather than overlaying it, so
  // the ActionBar's visualViewport re-dock (spec §7.22) has a stable height
  // to measure against.
  interactiveWidget: 'resizes-content',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient()
  const [clinicalAccess, actor] = await Promise.all([
    currentPractitionerClinicalContentAccess(),
    requireTrainingServerActor(supabase),
  ])
  const clinicalContentEnabled = clinicalAccess.surfaces.recommendations
    || clinicalAccess.surfaces.knowledgeLinks
  const navigationAudience = actor.ok ? actor.actorKind : 'public'
  return (
    <html lang="en">
      <body>
        <AppShell clinicalContentEnabled={clinicalContentEnabled} navigationAudience={navigationAudience} renderedUserId={actor.ok ? actor.userId : null}>{children}</AppShell>
      </body>
    </html>
  )
}

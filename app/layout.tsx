import type { Metadata, Viewport } from 'next'
import { Inter, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import AppShell from '@/components/AppShell'
import { siteOrigin } from '@/lib/site-origin'

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${uiFont.variable} ${dataFont.variable}`}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  )
}

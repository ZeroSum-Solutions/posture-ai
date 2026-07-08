import type { Metadata, Viewport } from 'next'
import { Schibsted_Grotesk, Hanken_Grotesk, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import Link from 'next/link'
import NavBar from '@/components/NavBar'

const displayFont = Schibsted_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

const bodyFont = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})

const dataFont = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-data',
  display: 'swap',
})

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://posture-ai.vercel.app'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Posture AI',
    template: '%s · Posture AI',
  },
  description: 'AI-assisted posture and musculoskeletal screening',
  openGraph: {
    title: 'Posture AI',
    description: 'AI-assisted posture and musculoskeletal screening',
    url: siteUrl,
    siteName: 'Posture AI',
  },
}

export const viewport: Viewport = {
  themeColor: '#0E1420',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable} ${dataFont.variable}`}>
      <body style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--background)' }}>
        <NavBar />
        <main style={{ flex: 1 }}>
          {children}
        </main>
        <footer style={{
          borderTop: '1px solid var(--border)',
          padding: '12px 24px',
          color: 'var(--text-secondary)',
          fontSize: '12px',
          textAlign: 'center'
        }}>
          <div>Screening only — not a medical diagnosis. Consult a qualified healthcare professional before making any clinical decisions.</div>
          <div style={{ marginTop: 6 }}>
            <Link href="/privacy" style={{ color: 'var(--brand)', textDecoration: 'none' }}>Privacy Policy</Link>
            {' · '}
            <Link href="/terms" style={{ color: 'var(--brand)', textDecoration: 'none' }}>Terms of Use</Link>
          </div>
        </footer>
      </body>
    </html>
  )
}

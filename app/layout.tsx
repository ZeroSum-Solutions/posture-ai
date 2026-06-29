import type { Metadata } from 'next'
import './globals.css'
import Link from 'next/link'
import NavBar from '@/components/NavBar'

export const metadata: Metadata = {
  title: 'Posture AI',
  description: 'AI-assisted posture and musculoskeletal screening',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#0A0A0B' }}>
        <NavBar />
        <main style={{ flex: 1 }}>
          {children}
        </main>
        <footer style={{
          borderTop: '1px solid rgba(255,255,255,0.08)',
          padding: '12px 24px',
          color: '#A1A1AA',
          fontSize: '12px',
          textAlign: 'center'
        }}>
          <div>Screening only — not a medical diagnosis. Consult a qualified healthcare professional before making any clinical decisions.</div>
          <div style={{ marginTop: 6 }}>
            <Link href="/privacy" style={{ color: '#818CF8', textDecoration: 'none' }}>Privacy Policy</Link>
            {' · '}
            <Link href="/terms" style={{ color: '#818CF8', textDecoration: 'none' }}>Terms of Use</Link>
          </div>
        </footer>
      </body>
    </html>
  )
}

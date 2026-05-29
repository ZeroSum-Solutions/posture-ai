import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Posture AI',
  description: 'AI-assisted posture and musculoskeletal screening',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
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
          ⚠️ Screening only — not a medical diagnosis. Results require interpretation by qualified professionals.
        </footer>
      </body>
    </html>
  )
}
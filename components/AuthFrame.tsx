import Link from 'next/link'
import type { ReactNode } from 'react'
import BrandMark from './BrandMark'

export default function AuthFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <Link href="/" className="auth-brand" aria-label="Posture AI home"><BrandMark size={34} /><span>Posture AI</span></Link>
        <div className="auth-story-copy">
          <p className="app-page-kicker">Practitioner platform</p>
          <h2>Clarity at every point of the screen.</h2>
          <p>Consistent capture, focused review, and a practical next step for every client conversation.</p>
        </div>
        <div className="auth-signal" aria-hidden="true"><span /><span /><span /><span /><i /></div>
      </aside>
      <section className="auth-panel app-panel">
        <p className="app-page-kicker">Secure workspace</p>
        <h1>{title}</h1>
        <p className="auth-description">{description}</p>
        {children}
      </section>
    </div>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'
import BrandMark from '@/components/BrandMark'

export const metadata: Metadata = {
  title: 'Terms of Use — Posture AI',
  description: 'Terms governing the use of Posture AI.',
}

const wrap: React.CSSProperties = { maxWidth: 760, margin: '0 auto', padding: '40px 20px', color: 'var(--text-secondary)', lineHeight: 1.65 }
const h2: React.CSSProperties = { color: 'var(--text-primary)', fontSize: '1.1rem', marginTop: 28, marginBottom: 8 }

// NOTE: scaffolding pending legal counsel review. See docs/plans.
export default function TermsPage() {
  return (
    <main className="app-standard-page app-standard-page--narrow" style={{ ...wrap, paddingTop: 52 }}>
      <Link href="/" className="auth-brand" style={{ marginBottom: 54 }}><BrandMark size={32} /><span>Posture AI</span></Link>
      <p className="app-page-kicker">Usage agreement</p>
      <h1 className="app-page-heading" style={{ marginBottom: 8 }}>Terms of use</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Screening tool only — not a medical diagnosis.</p>

      <h2 style={h2}>A screening tool, not a diagnosis</h2>
      <p>
        Posture AI is an educational posture <strong>screening</strong> tool for qualified movement
        professionals. It is not a medical diagnosis, and its output is not medical advice. Results
        identify areas that may benefit from further professional evaluation and must be interpreted
        by a qualified professional.
      </p>

      <h2 style={h2}>Professional use & consent</h2>
      <p>
        Posture AI is intended for use by qualified practitioners (physical therapists, athletic
        trainers, chiropractors, movement/fitness coaches). Practitioners are responsible for
        obtaining each subject&rsquo;s informed consent before screening, and for reviewing and
        approving any report before it is shared. Exercise suggestions are not medical orders.
      </p>

      <h2 style={h2}>Not for consumer self-assessment</h2>
      <p>
        Posture AI is not offered as a direct-to-consumer self-assessment application, and it is not
        a substitute for professional care.
      </p>

      <h2 style={h2}>No warranty</h2>
      <p>
        The service is provided &ldquo;as is&rdquo; for screening and educational purposes, without
        warranties of any kind. Always consult a qualified health professional before making clinical
        decisions.
      </p>

      <p style={{ marginTop: 32, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        See also our <Link href="/privacy" style={{ color: 'var(--brand)', textDecoration: 'underline' }}>Privacy Policy</Link>.
      </p>
    </main>
  )
}

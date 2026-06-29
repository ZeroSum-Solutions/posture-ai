import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms of Use — Posture AI',
  description: 'Terms governing the use of Posture AI.',
}

const wrap: React.CSSProperties = { maxWidth: 760, margin: '0 auto', padding: '40px 20px', color: '#D4D4D8', lineHeight: 1.65 }
const h2: React.CSSProperties = { color: '#F5F5F5', fontSize: '1.1rem', marginTop: 28, marginBottom: 8 }

// NOTE: scaffolding pending legal counsel review. See docs/plans.
export default function TermsPage() {
  return (
    <main style={wrap}>
      <h1 style={{ color: '#F5F5F5', fontSize: '1.6rem', marginBottom: 8 }}>Terms of Use</h1>
      <p style={{ color: '#A1A1AA', fontSize: '0.85rem' }}>Screening tool only — not a medical diagnosis.</p>

      <h2 style={h2}>Screening, not diagnosis</h2>
      <p>
        Posture AI is an educational posture <strong>screening</strong> tool for qualified movement
        professionals. It does not diagnose, treat, or cure any condition, and its output is not
        medical advice. Results identify areas that may benefit from further professional evaluation
        and must be interpreted by a qualified professional.
      </p>

      <h2 style={h2}>Professional use & consent</h2>
      <p>
        Posture AI is intended for use by qualified practitioners (physical therapists, athletic
        trainers, chiropractors, movement/fitness coaches). Practitioners are responsible for
        obtaining each subject&rsquo;s informed consent before screening, and for reviewing and
        approving any report before it is shared. Exercise suggestions are not a prescription.
      </p>

      <h2 style={h2}>Not for consumer self-diagnosis</h2>
      <p>
        Posture AI is not offered as a direct-to-consumer diagnostic or treatment application.
      </p>

      <h2 style={h2}>No warranty</h2>
      <p>
        The service is provided &ldquo;as is&rdquo; for screening and educational purposes, without
        warranties of any kind. Always consult a qualified health professional before making clinical
        decisions.
      </p>

      <p style={{ marginTop: 32, fontSize: '0.85rem', color: '#71717A' }}>
        See also our <Link href="/privacy" style={{ color: '#818CF8' }}>Privacy Policy</Link>.
      </p>
    </main>
  )
}

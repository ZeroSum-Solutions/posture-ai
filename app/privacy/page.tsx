import type { Metadata } from 'next'
import Link from 'next/link'
import BrandMark from '@/components/BrandMark'

export const metadata: Metadata = {
  title: 'Privacy Policy — Posture AI',
  description: 'How Posture AI collects, uses, retains, and deletes data.',
}

const wrap: React.CSSProperties = { maxWidth: 760, margin: '0 auto', padding: '40px 20px', color: 'var(--text-secondary)', lineHeight: 1.65 }
const h2: React.CSSProperties = { color: 'var(--text-primary)', fontSize: '1.1rem', marginTop: 28, marginBottom: 8 }

// NOTE: scaffolding pending legal counsel review (BIPA/MHMD/CCPA/GDPR wording,
// retention periods, and the data-controller details). See docs/plans.
export default function PrivacyPage() {
  return (
    <main className="app-standard-page app-standard-page--narrow" style={{ ...wrap, paddingTop: 52 }}>
      <Link href="/" className="auth-brand" style={{ marginBottom: 54 }}><BrandMark size={32} /><span>Posture AI</span></Link>
      <p className="app-page-kicker">Legal & privacy</p>
      <h1 className="app-page-heading" style={{ marginBottom: 8 }}>Privacy policy</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Screening tool only — not a medical diagnosis.</p>

      <h2 style={h2}>What we collect</h2>
      <p>
        Posture AI computes <strong>body-position landmark coordinates</strong> from posture views.
        Photos are processed entirely on the device in your browser and are <strong>never uploaded
        or stored</strong> — only the derived position measurements are saved. We do not create a
        facial-recognition template or any face-geometry scan, and the eye/mouth landmarks the pose
        model produces are discarded before anything is saved.
      </p>

      <h2 style={h2}>How we use it</h2>
      <p>
        Measurements produce a posture screening summary and movement suggestions that a qualified
        practitioner reviews before sharing. Results are not a medical diagnosis and must be
        interpreted by a qualified professional.
      </p>

      <h2 style={h2}>Consumer health & biometric data</h2>
      <p>
        Posture and body-measurement data may be considered consumer health data under laws such as
        Washington&rsquo;s My Health My Data Act, and pose data may be regulated under biometric
        privacy laws such as the Illinois Biometric Information Privacy Act. We collect it only with
        the subject&rsquo;s (or their guardian&rsquo;s) consent, and we honor access, withdrawal, and
        deletion requests.
      </p>

      <h2 style={h2}>No sale, no trackers</h2>
      <p>
        We do <strong>not</strong> sell your data and do <strong>not</strong> share it with
        advertisers. Posture AI uses <strong>no third-party analytics, advertising, or
        session-replay trackers</strong> on intake, capture, or results pages.
      </p>

      <h2 style={h2}>Retention & deletion</h2>
      <p>
        Practitioners may permanently delete a client&rsquo;s data at any time. Deletion purges the
        stored landmark measurements, findings, and generated reports, leaving only a redacted,
        PII-free record that the deletion occurred (kept for audit). To request access to or deletion
        of your data, contact the practitioner who screened you.
      </p>

      <h2 style={h2}>Children</h2>
      <p>
        Posture AI may not be used to screen anyone under 13. Screening a minor aged 13–17 requires a
        parent or legal guardian to consent.
      </p>

      <p style={{ marginTop: 32, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        See also our <Link href="/terms" style={{ color: 'var(--brand)', textDecoration: 'underline' }}>Terms of Use</Link>.
      </p>
    </main>
  )
}

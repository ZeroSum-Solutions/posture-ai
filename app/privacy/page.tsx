import type { Metadata } from 'next'
import Link from 'next/link'

import BrandMark from '@/components/BrandMark'
import LegalNotice from '@/components/LegalNotice'
import { isProductionLegalDocumentPublished } from '@/lib/legal/publication'
import { snapshotLegalDocument } from '@/lib/legal/policy'
import { resolveRuntimeLegalDocument } from '@/lib/legal/runtime'

export function generateMetadata(): Metadata {
  const published = isProductionLegalDocumentPublished('privacy')
  return {
    title: 'Privacy Policy — Posture AI',
    description: 'How Posture AI collects, uses, retains, and deletes data.',
    robots: published ? { index: true, follow: true } : { index: false, follow: false },
  }
}

const wrap: React.CSSProperties = {
  maxWidth: 760,
  margin: '0 auto',
  padding: '52px 20px 40px',
  color: 'var(--text-secondary)',
  lineHeight: 1.65,
}

export default function PrivacyPage() {
  const resolution = resolveRuntimeLegalDocument({ kind: 'privacy' })
  return (
    <main className="app-standard-page app-standard-page--narrow" style={wrap}>
      <Link href="/" className="auth-brand" style={{ marginBottom: 54 }}>
        <BrandMark size={32} /><span>Posture AI</span>
      </Link>
      <p className="app-page-kicker">Legal & privacy</p>
      {resolution.ok ? (
        <LegalNotice document={snapshotLegalDocument(resolution.document)} headingLevel={1} />
      ) : (
        <div role="alert" style={{ color: 'var(--danger)' }}>
          The approved Privacy Policy is temporarily unavailable.
        </div>
      )}
      <p style={{ marginTop: 32, fontSize: '0.85rem' }}>
        See also our{' '}
        <Link href="/terms" style={{ color: 'var(--brand)', textDecoration: 'underline' }}>
          Terms of Use
        </Link>.
      </p>
    </main>
  )
}

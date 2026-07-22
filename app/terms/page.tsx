import type { Metadata } from 'next'
import Link from 'next/link'

import BrandMark from '@/components/BrandMark'
import LegalNotice from '@/components/LegalNotice'
import { isProductionLegalDocumentPublished } from '@/lib/legal/publication'
import { snapshotLegalDocument } from '@/lib/legal/policy'
import { resolveRuntimeLegalDocument } from '@/lib/legal/runtime'

export function generateMetadata(): Metadata {
  const published = isProductionLegalDocumentPublished('terms')
  return {
    title: 'Terms of Use — Posture AI',
    description: 'Terms governing the use of Posture AI.',
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

export default function TermsPage() {
  const resolution = resolveRuntimeLegalDocument({ kind: 'terms' })
  return (
    <main className="app-standard-page app-standard-page--narrow" style={wrap}>
      <Link href="/" className="auth-brand" style={{ marginBottom: 54 }}>
        <BrandMark size={32} /><span>Posture AI</span>
      </Link>
      <p className="app-page-kicker">Usage agreement</p>
      {resolution.ok ? (
        <LegalNotice document={snapshotLegalDocument(resolution.document)} headingLevel={1} />
      ) : (
        <div role="alert" style={{ color: 'var(--danger)' }}>
          The approved Terms of Use are temporarily unavailable.
        </div>
      )}
      <p style={{ marginTop: 32, fontSize: '0.85rem' }}>
        See also our{' '}
        <Link href="/privacy" style={{ color: 'var(--brand)', textDecoration: 'underline' }}>
          Privacy Policy
        </Link>.
      </p>
    </main>
  )
}

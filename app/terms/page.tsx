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

export default function TermsPage() {
  const resolution = resolveRuntimeLegalDocument({ kind: 'terms' })
  return (
    <main className="app-screen app-screen-x app-stack" style={{ paddingTop: 40 }}>
      <Link
        href="/"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          fontSize: 14, fontWeight: 400, letterSpacing: '-0.01em',
          color: 'var(--text-primary)', textDecoration: 'none',
        }}
      >
        <BrandMark size={32} /><span>Posture AI</span>
      </Link>
      <p className="t-kicker">Usage agreement</p>
      {resolution.ok ? (
        <LegalNotice document={snapshotLegalDocument(resolution.document)} headingLevel={1} />
      ) : (
        <p role="alert" className="a-error">
          The approved Terms of Use are temporarily unavailable.
        </p>
      )}
      <p className="a-help">
        See also our{' '}
        <Link href="/privacy" style={{ color: 'var(--text-secondary)', textDecoration: 'underline' }}>
          Privacy Policy
        </Link>.
      </p>
    </main>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'

import LegalNotice from '@/components/LegalNotice'
import { ErrorState } from '@/components/ui/ErrorState'
import TopBar from '@/components/ui/TopBar'
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
    <div className="app-screen app-screen-x">
      <TopBar title="Terms of Use" back={{ href: '/', label: 'Back to home' }} />
      <div className="app-stack">
        {resolution.ok ? (
          <LegalNotice
            document={snapshotLegalDocument(resolution.document)}
            headingBase={2}
            collapseFingerprint
            showToc
          />
        ) : (
          <ErrorState
            variant="page"
            title="Terms of Use unavailable"
            body="The approved Terms of Use are temporarily unavailable."
          />
        )}
        <p className="t-footnote" style={{ color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 'var(--s-4)', minHeight: 48 }}>
          See also our
          <Link href="/privacy" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 48, color: 'var(--text-2)', textDecoration: 'underline' }}>
            Privacy Policy
          </Link>.
        </p>
      </div>
    </div>
  )
}

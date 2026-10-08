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
    <div className="app-screen">
      <TopBar title="Terms of Use" back={{ href: '/', label: 'Back to home' }} />
      <div className="app-stack app-screen-x" style={{ paddingTop: 'var(--s-16)' }}>
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
        <p className="t-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)', minHeight: 48, margin: 0 }}>
          See also our
          <Link href="/privacy" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 48, color: 'var(--ink-1)', textDecoration: 'none' }}>
            Privacy Policy
          </Link>.
        </p>
      </div>
    </div>
  )
}

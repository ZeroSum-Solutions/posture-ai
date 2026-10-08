'use client'

import LegalDocumentView from './LegalDocumentView'
import useLegalDocument from './useLegalDocument'
import { Banner } from '@/components/ui/Banner'
import type { LegalDocumentKind, LegalSnapshot } from '@/lib/legal/types'

export default function LegalNotice({
  document: suppliedDocument,
  kind,
  headingLevel = 2,
  headingBase,
  compact = false,
  collapseFingerprint = false,
  showToc = false,
}: {
  document?: LegalSnapshot
  kind?: LegalDocumentKind
  headingLevel?: 1 | 2 | 3 | 4 | 5
  /** Forwarded to `LegalDocumentView` — see its doc comment. Additive. */
  headingBase?: 1 | 2 | 3 | 4 | 5
  compact?: boolean
  /** Forwarded to `LegalDocumentView` — see its doc comment. Additive. */
  collapseFingerprint?: boolean
  /** Forwarded to `LegalDocumentView` — see its doc comment. Additive. */
  showToc?: boolean
}) {
  // An exact supplied snapshot is authoritative. This is deliberate: artifact-aware
  // consumers must not replace pinned copy with whichever version is current now.
  const requestedKind = suppliedDocument?.kind ?? kind ?? 'screening_notice'
  const loaded = useLegalDocument(requestedKind, !suppliedDocument)
  const document = suppliedDocument ?? loaded.document

  if (loaded.isLoading) {
    return <p role="status" aria-live="polite" className="t-body">Loading required legal text…</p>
  }
  if (loaded.error || !document) {
    return (
      <Banner variant="error">
        {loaded.error ?? 'Required legal text is unavailable.'}
      </Banner>
    )
  }
  return (
    <LegalDocumentView
      document={document}
      headingLevel={headingLevel}
      headingBase={headingBase}
      compact={compact}
      collapseFingerprint={collapseFingerprint}
      showToc={showToc}
    />
  )
}

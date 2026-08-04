'use client'

import LegalDocumentView from './LegalDocumentView'
import useLegalDocument from './useLegalDocument'
import type { LegalDocumentKind, LegalSnapshot } from '@/lib/legal/types'

export default function LegalNotice({
  document: suppliedDocument,
  kind,
  headingLevel = 2,
  compact = false,
}: {
  document?: LegalSnapshot
  kind?: LegalDocumentKind
  headingLevel?: 1 | 2 | 3 | 4 | 5
  compact?: boolean
}) {
  // An exact supplied snapshot is authoritative. This is deliberate: artifact-aware
  // consumers must not replace pinned copy with whichever version is current now.
  const requestedKind = suppliedDocument?.kind ?? kind ?? 'screening_notice'
  const loaded = useLegalDocument(requestedKind, !suppliedDocument)
  const document = suppliedDocument ?? loaded.document

  if (loaded.isLoading) {
    return <p role="status" aria-live="polite" className="a-help">Loading required legal text…</p>
  }
  if (loaded.error || !document) {
    return (
      <p role="alert" aria-live="assertive" className="a-error">
        {loaded.error ?? 'Required legal text is unavailable.'}
      </p>
    )
  }
  return <LegalDocumentView document={document} headingLevel={headingLevel} compact={compact} />
}

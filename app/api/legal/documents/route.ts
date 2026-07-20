import { NextRequest, NextResponse } from 'next/server'

import { snapshotLegalDocument } from '@/lib/legal/policy'
import { resolveRuntimeLegalDocument } from '@/lib/legal/runtime'
import type { LegalDocumentKind } from '@/lib/legal/types'

const LEGAL_DOCUMENT_KINDS = new Set<LegalDocumentKind>([
  'privacy',
  'terms',
  'subject_consent',
  'screening_notice',
])

export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get('kind')
  if (!kind || !LEGAL_DOCUMENT_KINDS.has(kind as LegalDocumentKind)) {
    return NextResponse.json(
      { error: 'Invalid legal document kind.', code: 'invalid_kind' },
      { status: 400 },
    )
  }

  const resolution = resolveRuntimeLegalDocument({ kind: kind as LegalDocumentKind })
  if (!resolution.ok) {
    return NextResponse.json(
      { error: 'Legal documents are temporarily unavailable.', code: 'legal_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // Keep the response envelope explicit so browser consumers can distinguish a
  // document from future response metadata without guessing at the payload shape.
  return NextResponse.json({ document: snapshotLegalDocument(resolution.document) }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

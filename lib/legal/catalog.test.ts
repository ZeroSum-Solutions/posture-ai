import { describe, expect, it } from 'vitest'

import {
  FIXTURE_LEGAL_DOCUMENTS,
  PRODUCTION_LEGAL_DOCUMENTS,
  computeLegalDocumentHash,
} from './catalog'
import { LEGAL_CONTEXT_BY_KIND } from './types'

describe('legal document catalogs', () => {
  it('keeps the production catalog empty until counsel-approved text exists', () => {
    expect(PRODUCTION_LEGAL_DOCUMENTS).toEqual([])
    expect(Object.isFrozen(PRODUCTION_LEGAL_DOCUMENTS)).toBe(true)
  })

  it('provides immutable, visibly non-production fixtures covering every legal kind', () => {
    expect([...new Set(FIXTURE_LEGAL_DOCUMENTS.map((document) => document.kind))].sort()).toEqual([
      'privacy',
      'screening_notice',
      'subject_consent',
      'terms',
    ])
    expect(FIXTURE_LEGAL_DOCUMENTS.every((document) => (
      document.status === 'test_fixture'
      && document.counselApprovalRef === null
      && Object.isFrozen(document)
      && Object.isFrozen(document.context)
      && Object.isFrozen(document.sections)
      && document.bodySha256 === computeLegalDocumentHash(document)
      && document.context.jurisdiction === LEGAL_CONTEXT_BY_KIND[document.kind].jurisdiction
      && document.context.locale === LEGAL_CONTEXT_BY_KIND[document.kind].locale
      && document.context.productScope === LEGAL_CONTEXT_BY_KIND[document.kind].productScope
      && document.context.audience === LEGAL_CONTEXT_BY_KIND[document.kind].audience
    ))).toBe(true)
  })
})

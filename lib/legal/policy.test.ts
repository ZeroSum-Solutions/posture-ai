import { describe, expect, it } from 'vitest'

import { computeLegalDocumentHash } from './catalog'
import {
  evaluateAcceptance,
  resolveLegalDocument,
  snapshotLegalDocument,
} from './policy'
import {
  LEGAL_CONTEXT_BY_KIND,
  type LegalDocumentVersion,
} from './types'

const AT = '2026-07-20T12:00:00.000Z'
const PRIVACY_CONTEXT = LEGAL_CONTEXT_BY_KIND.privacy

function document(overrides: Partial<LegalDocumentVersion> = {}): LegalDocumentVersion {
  const base: LegalDocumentVersion = {
    id: 'privacy-v1',
    kind: 'privacy',
    version: '1.0.0',
    status: 'approved',
    title: 'Privacy Policy',
    context: PRIVACY_CONTEXT,
    effectiveAt: '2026-07-20T00:00:00.000Z',
    sections: [{
      id: 'collection',
      heading: 'What we collect',
      paragraphs: ['We save derived measurements.'],
    }],
    bodySha256: '',
    supersedesId: null,
    changeFromPrior: 'initial',
    acceptanceRequired: false,
    counselApprovalRef: 'COUNSEL-1',
    ...overrides,
  }
  return { ...base, bodySha256: overrides.bodySha256 ?? computeLegalDocumentHash(base) }
}

function resolve(
  documents: readonly LegalDocumentVersion[],
  overrides: Partial<Parameters<typeof resolveLegalDocument>[0]> = {},
) {
  return resolveLegalDocument({
    documents,
    kind: 'privacy',
    context: PRIVACY_CONTEXT,
    at: AT,
    ...overrides,
  })
}

describe('resolveLegalDocument', () => {
  it('fails closed when the only matching document is a draft', () => {
    expect(resolve([document({ status: 'draft', counselApprovalRef: null })]))
      .toMatchObject({ ok: false, code: 'draft_forbidden' })
  })

  it('never selects scaffolding or a fixture without explicit fixture permission', () => {
    expect(resolve([document({ status: 'scaffold', counselApprovalRef: null })]))
      .toMatchObject({ ok: false, code: 'scaffold_forbidden' })
    expect(resolve([document({ status: 'test_fixture', counselApprovalRef: null })]))
      .toMatchObject({ ok: false, code: 'fixture_forbidden' })
  })

  it('resolves one eligible approved document and ignores a newer draft', () => {
    const approved = document()
    const draft = document({
      id: 'privacy-v2-draft',
      version: '2.0.0',
      status: 'draft',
      supersedesId: approved.id,
      changeFromPrior: 'material',
      counselApprovalRef: null,
    })

    expect(resolve([approved, draft])).toMatchObject({
      ok: true,
      document: { id: approved.id, isFixture: false },
    })
  })

  it('resolves an exact pinned historical version instead of silently substituting', () => {
    const v1 = document({ status: 'retired' })
    const v2 = document({
      id: 'privacy-v2',
      version: '2.0.0',
      supersedesId: v1.id,
      changeFromPrior: 'non_material',
    })

    expect(resolve([v1, v2], { pinnedDocumentId: v1.id })).toMatchObject({
      ok: true,
      document: { id: v1.id },
    })
    expect(resolve([v1, v2], { pinnedDocumentId: 'missing' })).toMatchObject({
      ok: false,
      code: 'unknown_pinned_document',
    })
  })

  it.each([
    [document({ effectiveAt: null }), 'missing_effective_date'],
    [document({ effectiveAt: 'July someday' }), 'invalid_effective_date'],
    [document({ effectiveAt: '2026-07-21T00:00:00.000Z' }), 'not_yet_effective'],
    [document({ counselApprovalRef: null }), 'missing_counsel_approval'],
    [document({ bodySha256: '0'.repeat(64) }), 'hash_mismatch'],
  ])('rejects invalid approved-document metadata', (candidate, code) => {
    expect(resolve([candidate])).toMatchObject({ ok: false, code })
  })

  it.each([
    [document({ id: '' }), 'blank id'],
    [document({ id: 'x'.repeat(129) }), 'oversized id'],
    [document({ version: '' }), 'blank version'],
    [document({ version: 'x'.repeat(129) }), 'oversized version'],
    [document({ title: '' }), 'blank title'],
    [document({ title: 'x'.repeat(201) }), 'oversized title'],
    [document({ sections: [] }), 'empty sections'],
    [document({ sections: [{ id: '', heading: null, paragraphs: ['Text.'] }] }), 'blank section id'],
    [document({ sections: [{ id: 'one', heading: null, paragraphs: [] }] }), 'empty section text'],
    [document({ sections: [{ id: 'one', heading: null, paragraphs: ['   '] }] }), 'blank paragraph'],
    [document({ sections: [
      { id: 'same', heading: null, paragraphs: ['First.'] },
      { id: 'same', heading: null, paragraphs: ['Second.'] },
    ] }), 'duplicate section ids'],
  ])('rejects structurally invalid approved content: %s', (candidate) => {
    expect(resolve([candidate])).toMatchObject({ ok: false, code: 'invalid_structure' })
  })

  it('rejects wrong context and kind for both current and pinned resolution', () => {
    const wrongContext = document({
      context: { ...PRIVACY_CONTEXT, audience: 'subject' },
    })
    expect(resolve([wrongContext])).toMatchObject({ ok: false, code: 'context_mismatch' })
    expect(resolve([wrongContext], { pinnedDocumentId: wrongContext.id })).toMatchObject({
      ok: false,
      code: 'context_mismatch',
    })

    for (const context of [
      { ...PRIVACY_CONTEXT, jurisdiction: 'CA' },
      { ...PRIVACY_CONTEXT, productScope: 'another_product' },
    ]) {
      const wrongBoundary = document({
        id: `privacy-wrong-${context.jurisdiction}-${context.productScope}`,
        context: context as unknown as LegalDocumentVersion['context'],
      })
      expect(resolve([wrongBoundary])).toMatchObject({ ok: false, code: 'context_mismatch' })
    }

    const terms = document({
      id: 'terms-v1',
      kind: 'terms',
      context: LEGAL_CONTEXT_BY_KIND.terms,
    })
    expect(resolve([terms], { pinnedDocumentId: terms.id })).toMatchObject({
      ok: false,
      code: 'kind_mismatch',
    })
  })

  it('rejects duplicate ids, parallel active heads, and broken supersession chains', () => {
    const first = document()
    expect(resolve([first, { ...first }])).toMatchObject({
      ok: false,
      code: 'duplicate_document_id',
    })

    const parallel = document({ id: 'privacy-parallel', version: '1.1.0' })
    expect(resolve([first, parallel])).toMatchObject({
      ok: false,
      code: 'ambiguous_eligible_versions',
    })

    const broken = document({
      id: 'privacy-broken',
      supersedesId: 'privacy-unknown',
      changeFromPrior: 'material',
    })
    expect(resolve([broken])).toMatchObject({ ok: false, code: 'invalid_supersession' })
  })

  it('selects the unique active head of a valid supersession chain', () => {
    const v1 = document()
    const v2 = document({
      id: 'privacy-v2',
      version: '2.0.0',
      supersedesId: v1.id,
      changeFromPrior: 'material',
    })

    expect(resolve([v1, v2])).toMatchObject({ ok: true, document: { id: v2.id } })
  })
})

describe('evaluateAcceptance', () => {
  const v1 = document({ acceptanceRequired: true })
  const v2 = document({
    id: 'privacy-v2',
    version: '2.0.0',
    supersedesId: v1.id,
    changeFromPrior: 'non_material',
    acceptanceRequired: true,
  })
  const v3 = document({
    id: 'privacy-v3',
    version: '3.0.0',
    supersedesId: v2.id,
    changeFromPrior: 'material',
    acceptanceRequired: true,
  })
  const required = { ...v3, isFixture: false }
  const acceptedV1 = {
    state: 'accepted',
    documentId: v1.id,
    bodySha256: v1.bodySha256,
    acceptedAt: AT,
  } as const

  it('requires reacceptance across a material change but not only non-material changes', () => {
    expect(evaluateAcceptance({ requiredDocument: required, evidence: acceptedV1, documents: [v1, v2, v3] }))
      .toMatchObject({ state: 'reconsent_required' })
    expect(evaluateAcceptance({ requiredDocument: { ...v2, isFixture: false }, evidence: acceptedV1, documents: [v1, v2] }))
      .toMatchObject({ state: 'current' })
  })

  it('recognizes exact acceptance and fails legacy or withdrawn evidence closed', () => {
    expect(evaluateAcceptance({
      requiredDocument: required,
      evidence: { state: 'accepted', documentId: v3.id, bodySha256: v3.bodySha256, acceptedAt: AT },
      documents: [v1, v2, v3],
    })).toMatchObject({ state: 'current' })
    expect(evaluateAcceptance({
      requiredDocument: required,
      evidence: {
        state: 'accepted',
        documentId: v3.id,
        bodySha256: v3.bodySha256,
        acceptedAt: '2026-07-20T12:00:00.123456+00:00',
      },
      documents: [v1, v2, v3],
    })).toMatchObject({ state: 'current' })
    expect(evaluateAcceptance({ requiredDocument: required, evidence: null, documents: [v1, v2, v3] }))
      .toMatchObject({ state: 'missing' })
    expect(evaluateAcceptance({
      requiredDocument: required,
      evidence: { state: 'withdrawn', documentId: v3.id, bodySha256: v3.bodySha256, acceptedAt: AT },
      documents: [v1, v2, v3],
    })).toMatchObject({ state: 'withdrawn' })
    expect(evaluateAcceptance({
      requiredDocument: required,
      evidence: { state: 'accepted', documentId: null, bodySha256: null, acceptedAt: AT },
      documents: [v1, v2, v3],
    })).toMatchObject({ state: 'legacy_unverified' })
  })

  it('rejects tampered and unknown acceptance evidence', () => {
    expect(evaluateAcceptance({
      requiredDocument: required,
      evidence: { ...acceptedV1, bodySha256: '0'.repeat(64) },
      documents: [v1, v2, v3],
    })).toMatchObject({ state: 'legacy_unverified' })
    expect(evaluateAcceptance({
      requiredDocument: required,
      evidence: { ...acceptedV1, documentId: 'unknown' },
      documents: [v1, v2, v3],
    })).toMatchObject({ state: 'legacy_unverified' })
  })
})

describe('snapshotLegalDocument', () => {
  it('captures immutable version, scope, hash, and canonical display text', () => {
    const resolved = { ...document(), isFixture: false }
    expect(snapshotLegalDocument(resolved)).toEqual({
      schemaVersion: 1,
      documentId: resolved.id,
      kind: resolved.kind,
      version: resolved.version,
      title: resolved.title,
      effectiveAt: resolved.effectiveAt,
      jurisdiction: 'US',
      locale: 'en-US',
      productScope: 'us_fitness_wellness_assessment_beta_v1',
      audience: 'public',
      bodySha256: resolved.bodySha256,
      text: 'Privacy Policy\n\nWhat we collect\n\nWe save derived measurements.',
      sections: resolved.sections,
      isFixture: false,
    })
    const snapshot = snapshotLegalDocument(resolved)
    expect(Object.isFrozen(snapshot.sections)).toBe(true)
    expect(Object.isFrozen(snapshot.sections[0])).toBe(true)
    expect(Object.isFrozen(snapshot.sections[0].paragraphs)).toBe(true)
  })
})

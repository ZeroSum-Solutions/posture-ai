import { describe, expect, it } from 'vitest'

import { isLegalFixtureMode, resolveRuntimeLegalDocument } from './runtime'

describe('isLegalFixtureMode', () => {
  it('requires the explicit posture test flag and never permits Vercel production', () => {
    expect(isLegalFixtureMode({ POSTURE_TEST_MODE_ENABLED: '1', VERCEL_ENV: 'preview' })).toBe(true)
    expect(isLegalFixtureMode({ POSTURE_TEST_MODE_ENABLED: '1', VERCEL_ENV: 'production' })).toBe(false)
    expect(isLegalFixtureMode({ NODE_ENV: 'test' })).toBe(false)
  })

  it('does not let NODE_ENV production disable an explicit non-production test fixture', () => {
    expect(isLegalFixtureMode({
      NODE_ENV: 'production',
      POSTURE_TEST_MODE_ENABLED: '1',
      VERCEL_ENV: 'preview',
    })).toBe(true)
  })
})

describe('resolveRuntimeLegalDocument', () => {
  it('fails closed when production has no approved document and fixture mode is off', () => {
    expect(resolveRuntimeLegalDocument({ kind: 'privacy' }, {})).toMatchObject({
      ok: false,
      code: 'no_eligible_document',
    })
  })

  it('uses fixtures only with explicit non-production authorization', () => {
    const env = { POSTURE_TEST_MODE_ENABLED: '1', VERCEL_ENV: 'preview' }
    expect(resolveRuntimeLegalDocument({ kind: 'subject_consent' }, env)).toMatchObject({
      ok: true,
      document: { kind: 'subject_consent', status: 'test_fixture', isFixture: true },
    })
  })

  it('refuses fixtures in Vercel production even when the explicit test flag is set', () => {
    expect(resolveRuntimeLegalDocument(
      { kind: 'screening_notice' },
      { POSTURE_TEST_MODE_ENABLED: '1', VERCEL_ENV: 'production' },
    )).toMatchObject({ ok: false, code: 'no_eligible_document' })
  })

  it('supports an exact pinned fixture only in authorized fixture mode', () => {
    const fixtureId = 'subject-consent-test-fixture-v1'
    expect(resolveRuntimeLegalDocument(
      { kind: 'subject_consent', pinnedDocumentId: fixtureId },
      { POSTURE_TEST_MODE_ENABLED: '1', VERCEL_ENV: 'preview' },
    )).toMatchObject({ ok: true, document: { id: fixtureId } })
    expect(resolveRuntimeLegalDocument(
      { kind: 'subject_consent', pinnedDocumentId: fixtureId },
      { POSTURE_TEST_MODE_ENABLED: '0', VERCEL_ENV: 'preview' },
    )).toMatchObject({ ok: false, code: 'unknown_pinned_document' })
  })
})

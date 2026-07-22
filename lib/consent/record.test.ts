import { beforeEach, describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getConsentStatus, captureEligibility } from './record'

// Minimal fake of the supabase query-builder chain getConsentStatus uses. The
// filters/order are exercised against the real DB elsewhere (e2e); here we lock
// the revocation-authority logic over the single latest row it resolves to.
function fakeDb(row: Record<string, unknown> | null, error: unknown = null): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: row, error }),
  }
  return { from: () => chain } as unknown as SupabaseClient
}

describe('getConsentStatus revocation authority (regression)', () => {
  beforeEach(() => {
    process.env.POSTURE_TEST_MODE_ENABLED = '1'
    process.env.VERCEL_ENV = 'preview'
  })

  it('reports consent when the latest event is a valid enrollment', async () => {
    const s = await getConsentStatus(
      fakeDb({
        kind: 'enrollment',
        signer_relationship: 'self',
        revoked_at: null,
        signed_at: '2026-07-20T01:00:00.000Z',
        legal_document_id: 'subject-consent-test-fixture-v1',
        legal_document_version: 'test-1',
        legal_document_body_sha256: '66ccb18e51a1b930ea7ca0091c7e18100fe97d66970a7cadadfc2adfa3979b7c',
        legal_document_effective_at: '2026-07-20T00:00:00+00:00',
        legal_jurisdiction: 'US',
        legal_product_scope: 'us_fitness_wellness_assessment_beta_v1',
        legal_provenance_state: 'governed',
      }),
      'c1',
    )
    expect(s).toMatchObject({
      hasConsent: true,
      signerRelationship: 'self',
      legalState: 'current',
      document: { documentId: 'subject-consent-test-fixture-v1' },
    })
  })

  it('keeps the exact signed document when a non-material successor is current', async () => {
    const s = await getConsentStatus(
      fakeDb({
        kind: 'enrollment',
        signer_relationship: 'self',
        revoked_at: null,
        signed_at: '2026-07-20T01:00:00+00:00',
        legal_document_id: 'subject-consent-test-fixture-v0',
        legal_document_version: 'test-0',
        legal_document_body_sha256: '68fe57a42ab60861f59b6a8d2c0525db721d909d3a4fd928afafab13d82e3cde',
        legal_document_effective_at: '2026-07-19T00:00:00+00:00',
        legal_jurisdiction: 'US',
        legal_product_scope: 'us_fitness_wellness_assessment_beta_v1',
        legal_provenance_state: 'governed',
      }),
      'c1',
    )

    expect(s).toMatchObject({
      hasConsent: true,
      legalState: 'current',
      document: {
        documentId: 'subject-consent-test-fixture-v0',
        version: 'test-0',
      },
    })
  })

  it('reports NO consent when the latest event is a revocation', async () => {
    const s = await getConsentStatus(
      fakeDb({ kind: 'revocation', signer_relationship: 'self', revoked_at: null }),
      'c1',
    )
    expect(s.hasConsent).toBe(false)
  })

  it('reports NO consent when the latest enrollment was revoked (revoked_at set)', async () => {
    const s = await getConsentStatus(
      fakeDb({ kind: 'enrollment', signer_relationship: 'parent', revoked_at: '2026-06-03T00:00:00Z' }),
      'c1',
    )
    expect(s.hasConsent).toBe(false)
  })

  it('reports NO consent when there is no record', async () => {
    const s = await getConsentStatus(fakeDb(null), 'c1')
    expect(s.hasConsent).toBe(false)
    expect(s.legalState).toBe('missing')
  })

  it('requires reconsent for a legacy row without governed provenance', async () => {
    const s = await getConsentStatus(
      fakeDb({
        kind: 'enrollment',
        signer_relationship: 'self',
        revoked_at: null,
        signed_at: '2026-07-20T01:00:00.000Z',
        legal_document_id: null,
        legal_document_body_sha256: null,
        legal_provenance_state: 'legacy_unverified',
      }),
      'c1',
    )

    expect(s).toMatchObject({ hasConsent: false, legalState: 'reconsent_required' })
  })

  it('requires reconsent for stale or forged evidence', async () => {
    const s = await getConsentStatus(
      fakeDb({
        kind: 'enrollment',
        signer_relationship: 'self',
        revoked_at: null,
        signed_at: '2026-07-20T01:00:00.000Z',
        legal_document_id: 'subject-consent-test-fixture-v1',
        legal_document_body_sha256: '0'.repeat(64),
        legal_provenance_state: 'governed',
      }),
      'c1',
    )

    expect(s).toMatchObject({ hasConsent: false, legalState: 'reconsent_required' })
  })

  it('fails closed when the consent record lookup errors', async () => {
    const s = await getConsentStatus(fakeDb(null, { message: 'db unavailable' }), 'c1')
    expect(s).toMatchObject({ hasConsent: false, legalState: 'legal_unavailable' })
  })

  it('captureEligibility blocks capture once consent is revoked', () => {
    const r = captureEligibility('1990-01-01', {
      hasConsent: false,
      signerRelationship: null,
      legalState: 'withdrawn',
      document: null,
    })
    expect(r.ok).toBe(false)
  })
})

import { beforeEach, describe, expect, test, vi } from 'vitest'

const { maybeSingle } = vi.hoisted(() => ({ maybeSingle: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => {
      expect(table).toBe('consent_tokens')
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle,
      }
      return query
    },
  }),
}))

import ConsentPage from './page'

const governedToken = {
  legal_document_id: 'subject-consent-test-fixture-v1',
  legal_document_version: 'test-1',
  legal_document_body_sha256: '66ccb18e51a1b930ea7ca0091c7e18100fe97d66970a7cadadfc2adfa3979b7c',
  legal_document_effective_at: '2026-07-20T00:00:00+00:00',
  legal_jurisdiction: 'US',
  legal_product_scope: 'us_fitness_wellness_assessment_beta_v1',
  legal_provenance_state: 'governed',
  created_at: '2026-07-20T01:00:00.000Z',
  consumed_at: null,
  expires_at: '2099-07-27T01:00:00.000Z',
}

describe('remote consent token page', () => {
  beforeEach(() => {
    process.env.POSTURE_TEST_MODE_ENABLED = '1'
    process.env.VERCEL_ENV = 'preview'
    maybeSingle.mockReset().mockResolvedValue({ data: governedToken, error: null })
  })

  test('passes the exact verified token-pinned snapshot to the responder', async () => {
    const element = await ConsentPage({ params: Promise.resolve({ token: 'a'.repeat(43) }) })

    expect(element.props.document).toMatchObject({
      documentId: governedToken.legal_document_id,
      version: governedToken.legal_document_version,
      bodySha256: governedToken.legal_document_body_sha256,
    })
  })

  test.each([
    ['legacy', { ...governedToken, legal_provenance_state: 'legacy_unverified' }],
    ['consumed', { ...governedToken, consumed_at: '2026-07-20T02:00:00.000Z' }],
    ['expired', { ...governedToken, expires_at: '2020-07-20T02:00:00.000Z' }],
  ])('does not render signable copy for a %s token', async (_label, row) => {
    maybeSingle.mockResolvedValueOnce({ data: row, error: null })

    const element = await ConsentPage({ params: Promise.resolve({ token: 'a'.repeat(43) }) })

    expect(element.props.document).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getConsentStatus, captureEligibility } from './record'

// Minimal fake of the supabase query-builder chain getConsentStatus uses. The
// filters/order are exercised against the real DB elsewhere (e2e); here we lock
// the revocation-authority logic over the single latest row it resolves to.
function fakeDb(row: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: row }),
  }
  return { from: () => chain } as unknown as SupabaseClient
}

describe('getConsentStatus revocation authority (regression)', () => {
  it('reports consent when the latest event is a valid enrollment', async () => {
    const s = await getConsentStatus(
      fakeDb({ kind: 'enrollment', signer_relationship: 'self', revoked_at: null }),
      'c1',
    )
    expect(s).toEqual({ hasConsent: true, signerRelationship: 'self' })
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
  })

  it('captureEligibility blocks capture once consent is revoked', () => {
    const r = captureEligibility('1990-01-01', { hasConsent: false, signerRelationship: null })
    expect(r.ok).toBe(false)
  })
})

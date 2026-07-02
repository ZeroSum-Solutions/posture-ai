import { describe, test, expect, vi, beforeEach } from 'vitest'

// Mock the service-role client factory used for the org read.
const serviceOrgResult = { data: null as unknown, error: null as unknown }
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => serviceOrgResult,
        }),
      }),
    }),
  }),
}))

import { practitionerGate } from './requirePractitioner'

// Minimal fake of the caller's authed client: returns whatever practitioner row
// the test sets.
function fakeSupabase(pracRow: unknown) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: pracRow, error: null }),
        }),
      }),
    }),
  } as never
}

describe('practitionerGate', () => {
  beforeEach(() => {
    serviceOrgResult.data = null
    serviceOrgResult.error = null
  })

  test('returns 403 when the user is not a practitioner', async () => {
    const res = await practitionerGate(fakeSupabase(null), 'u1')
    expect(res?.status).toBe(403)
  })

  test('allows a practitioner with no organization', async () => {
    const res = await practitionerGate(fakeSupabase({ id: 'u1', organization_id: null }), 'u1')
    expect(res).toBeNull()
  })

  test('allows an org practitioner whose covered-entity BAA is signed', async () => {
    serviceOrgResult.data = { is_covered_entity: true, baa_status: 'signed' }
    const res = await practitionerGate(fakeSupabase({ id: 'u1', organization_id: 'org1' }), 'u1')
    expect(res).toBeNull()
  })

  test('blocks a covered entity whose BAA is not signed (403)', async () => {
    serviceOrgResult.data = { is_covered_entity: true, baa_status: 'pending' }
    const res = await practitionerGate(fakeSupabase({ id: 'u1', organization_id: 'org1' }), 'u1')
    expect(res?.status).toBe(403)
  })

  test('allows a non-covered-entity org', async () => {
    serviceOrgResult.data = { is_covered_entity: false, baa_status: null }
    const res = await practitionerGate(fakeSupabase({ id: 'u1', organization_id: 'org1' }), 'u1')
    expect(res).toBeNull()
  })

  test('FAILS CLOSED when the org read errors — the HIPAA gate must not be skipped on error', async () => {
    serviceOrgResult.data = null
    serviceOrgResult.error = { message: 'connection reset' }
    const res = await practitionerGate(fakeSupabase({ id: 'u1', organization_id: 'org1' }), 'u1')
    expect(res?.status).toBe(403)
  })

  test('FAILS CLOSED when the org row is missing for an org-linked practitioner', async () => {
    serviceOrgResult.data = null
    serviceOrgResult.error = null
    const res = await practitionerGate(fakeSupabase({ id: 'u1', organization_id: 'org1' }), 'u1')
    expect(res?.status).toBe(403)
  })
})

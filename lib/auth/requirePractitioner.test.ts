import { beforeEach, describe, expect, test, vi } from 'vitest'

const serviceOrgResult = { data: null as unknown, error: null as unknown }
const serviceAcceptanceResult = { data: [] as unknown[], error: null as unknown }
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      select: () => table === 'organizations'
        ? {
            eq: () => ({ maybeSingle: async () => serviceOrgResult }),
          }
        : {
            eq: () => ({ order: async () => serviceAcceptanceResult }),
          },
    }),
  }),
}))

import { practitionerAdmission, practitionerGate } from './requirePractitioner'

const activePractitioner = {
  id: 'u1',
  organization_id: null,
  practice_name: null,
  display_name: null,
  access_status: 'active',
  role: 'practitioner',
}

const fixtureAcceptances = [
  {
    legal_document_id: 'terms-test-fixture-v1',
    legal_document_version: 'test-1',
    legal_document_body_sha256: '57a4cdb692b60cde1662346c292a6213ac1351dee20ed55ec23339ecf6a733b2',
    legal_document_effective_at: '2026-07-20T00:00:00+00:00',
    legal_jurisdiction: 'US',
    legal_product_scope: 'us_fitness_wellness_assessment_beta_v1',
    accepted_at: '2026-07-20T01:00:00.000Z',
  },
  {
    legal_document_id: 'privacy-test-fixture-v1',
    legal_document_version: 'test-1',
    legal_document_body_sha256: '0b15b685fd1032bff1547563c6ce44dffb573485f6aef46d16e3f472597cea3b',
    legal_document_effective_at: '2026-07-20T00:00:00+00:00',
    legal_jurisdiction: 'US',
    legal_product_scope: 'us_fitness_wellness_assessment_beta_v1',
    accepted_at: '2026-07-20T01:00:00.000Z',
  },
  {
    legal_document_id: 'screening-notice-test-fixture-v1',
    legal_document_version: 'test-1',
    legal_document_body_sha256: 'ce14bfa5b311aeed4c47267068730ef35b5daf6944a3fcf0d776c3a0868fac8f',
    legal_document_effective_at: '2026-07-20T00:00:00+00:00',
    legal_jurisdiction: 'US',
    legal_product_scope: 'us_fitness_wellness_assessment_beta_v1',
    accepted_at: '2026-07-20T01:00:00.000Z',
  },
]

type FakeOptions = {
  assurance?: unknown
  assuranceError?: unknown
  assuranceReject?: boolean
  practitioner?: unknown
  practitionerError?: unknown
  practitionerReject?: boolean
}

function fakeSupabase({
  assurance = { currentLevel: 'aal2', nextLevel: 'aal2' },
  assuranceError = null,
  assuranceReject = false,
  practitioner = activePractitioner,
  practitionerError = null,
  practitionerReject = false,
}: FakeOptions = {}) {
  return {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: assuranceReject
          ? async () => { throw new Error('assurance unavailable') }
          : async () => ({ data: assurance, error: assuranceError }),
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: practitionerReject
            ? async () => { throw new Error('practitioner unavailable') }
            : async () => ({ data: practitioner, error: practitionerError }),
        }),
      }),
    }),
  } as never
}

async function responseBody(response: Response | null) {
  return response ? response.json() : null
}

describe('practitionerAdmission', () => {
  test.each([
    ['AAL lookup errors', { assuranceError: { message: 'auth unavailable' } }],
    ['AAL data is null', { assurance: null }],
    ['current level is aal1', { assurance: { currentLevel: 'aal1', nextLevel: 'aal2' } }],
    ['AAL lookup throws', { assuranceReject: true }],
  ])('fails closed when %s', async (_label, options) => {
    const result = await practitionerAdmission(fakeSupabase(options), 'u1')

    expect(result.response?.status).toBe(403)
    expect(await responseBody(result.response)).toMatchObject({ code: 'mfa_required' })
  })

  test.each(['invited', 'review_required', 'revoked'])('rejects %s access', async (accessStatus) => {
    const result = await practitionerAdmission(
      fakeSupabase({ practitioner: { ...activePractitioner, access_status: accessStatus } }),
      'u1',
    )

    expect(result.response?.status).toBe(403)
    expect(await responseBody(result.response)).toMatchObject({
      code: 'practitioner_access_required',
    })
  })

  test('rejects a row with the wrong role', async () => {
    const result = await practitionerAdmission(
      fakeSupabase({ practitioner: { ...activePractitioner, role: 'admin' } }),
      'u1',
    )

    expect(await responseBody(result.response)).toMatchObject({
      code: 'practitioner_access_required',
    })
  })

  test.each([
    ['query error', { practitionerError: { message: 'connection reset' } }],
    ['missing row', { practitioner: null }],
    ['thrown query', { practitionerReject: true }],
  ])('fails closed for a practitioner %s', async (_label, options) => {
    const result = await practitionerAdmission(fakeSupabase(options), 'u1')

    expect(result.response?.status).toBe(403)
    expect(await responseBody(result.response)).toMatchObject({
      code: 'practitioner_access_required',
    })
  })

  test('admits only an active practitioner at aal2', async () => {
    const result = await practitionerAdmission(fakeSupabase(), 'u1')

    expect(result.response).toBeNull()
    expect(result.practitioner).toEqual(activePractitioner)
  })
})

describe('practitionerGate BAA enforcement', () => {
  beforeEach(() => {
    process.env.POSTURE_TEST_MODE_ENABLED = '1'
    process.env.VERCEL_ENV = 'preview'
    serviceOrgResult.data = null
    serviceOrgResult.error = null
    serviceAcceptanceResult.data = fixtureAcceptances
    serviceAcceptanceResult.error = null
  })

  test('allows an active AAL2 practitioner with no organization', async () => {
    expect(await practitionerGate(fakeSupabase(), 'u1')).toBeNull()
  })

  test('allows a covered entity whose BAA is signed', async () => {
    serviceOrgResult.data = { is_covered_entity: true, baa_status: 'signed' }
    const practitioner = { ...activePractitioner, organization_id: 'org1' }

    expect(await practitionerGate(fakeSupabase({ practitioner }), 'u1')).toBeNull()
  })

  test.each(['pending', 'not_required', null])(
    'blocks a covered entity whose BAA status is %s',
    async (baaStatus) => {
      serviceOrgResult.data = { is_covered_entity: true, baa_status: baaStatus }
      const practitioner = { ...activePractitioner, organization_id: 'org1' }
      const response = await practitionerGate(fakeSupabase({ practitioner }), 'u1')

      expect(response?.status).toBe(403)
      expect(await responseBody(response)).toMatchObject({ code: 'compliance' })
    },
  )

  test('allows a non-covered-entity organization', async () => {
    serviceOrgResult.data = { is_covered_entity: false, baa_status: null }
    const practitioner = { ...activePractitioner, organization_id: 'org1' }

    expect(await practitionerGate(fakeSupabase({ practitioner }), 'u1')).toBeNull()
  })

  test.each([
    ['the organization read errors', { data: null, error: { message: 'connection reset' } }],
    ['the organization row is missing', { data: null, error: null }],
  ])('fails closed when %s', async (_label, orgResult) => {
    serviceOrgResult.data = orgResult.data
    serviceOrgResult.error = orgResult.error
    const practitioner = { ...activePractitioner, organization_id: 'org1' }
    const response = await practitionerGate(fakeSupabase({ practitioner }), 'u1')

    expect(response?.status).toBe(403)
    expect(await responseBody(response)).toMatchObject({ code: 'compliance' })
  })

  test('blocks a legacy acknowledgement timestamp without governed evidence', async () => {
    serviceAcceptanceResult.data = []

    const response = await practitionerGate(fakeSupabase(), 'u1')

    expect(response?.status).toBe(403)
    expect(await responseBody(response)).toMatchObject({ code: 'legal_acceptance_required' })
  })

  test('blocks when any one of the three current documents is missing', async () => {
    serviceAcceptanceResult.data = fixtureAcceptances.slice(0, 2)

    const response = await practitionerGate(fakeSupabase(), 'u1')

    expect(response?.status).toBe(403)
    expect(await responseBody(response)).toMatchObject({ code: 'legal_acceptance_required' })
  })

  test('blocks stale or forged evidence', async () => {
    serviceAcceptanceResult.data = [
      { ...fixtureAcceptances[0], legal_document_body_sha256: '0'.repeat(64) },
      ...fixtureAcceptances.slice(1),
    ]

    const response = await practitionerGate(fakeSupabase(), 'u1')

    expect(response?.status).toBe(403)
    expect(await responseBody(response)).toMatchObject({ code: 'legal_acceptance_required' })
  })

  test('fails closed when current approved production documents are unavailable', async () => {
    delete process.env.POSTURE_TEST_MODE_ENABLED
    process.env.VERCEL_ENV = 'production'

    const response = await practitionerGate(fakeSupabase(), 'u1')

    expect(response?.status).toBe(503)
    expect(await responseBody(response)).toMatchObject({ code: 'legal_unavailable' })
  })
})

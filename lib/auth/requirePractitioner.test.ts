import { beforeEach, describe, expect, test, vi } from 'vitest'

const serviceOrgResult = { data: null as unknown, error: null as unknown }
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => serviceOrgResult }),
      }),
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
    serviceOrgResult.data = null
    serviceOrgResult.error = null
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
})

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  authError: null as unknown,
  admission: null as unknown,
  organization: null as unknown,
  organizationError: null as unknown,
  updatedOrganization: null as unknown,
  updateError: null as unknown,
  updateFields: vi.fn(),
  admissionSpy: vi.fn(),
}))

vi.mock('@/lib/auth/requirePractitioner', () => ({
  practitionerAdmission: (...args: unknown[]) => {
    mocks.admissionSpy(...args)
    return mocks.admission
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: mocks.user }, error: mocks.authError }),
    },
  }),
  createSupabaseServiceClient: () => ({
    from: (table: string) => {
      if (table !== 'organizations') throw new Error(`Unexpected table: ${table}`)
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: mocks.organization,
              error: mocks.organizationError,
            }),
          }),
        }),
        update: (fields: unknown) => {
          mocks.updateFields(fields)
          return {
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: mocks.updatedOrganization,
                  error: mocks.updateError,
                }),
              }),
            }),
          }
        },
      }
    },
  }),
}))

vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => true }))
vi.mock('@/lib/log', () => ({ logEvent: vi.fn(), hashUser: () => 'user-hash' }))

import { GET, PATCH } from './route'

const practitioner = {
  id: 'u1',
  organization_id: 'org1',
  practice_name: 'Practice',
  display_name: 'Practitioner',
  access_status: 'active',
  role: 'practitioner',
}

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/settings/organization', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('/api/settings/organization admission', () => {
  beforeEach(() => {
    mocks.user = { id: 'u1' }
    mocks.authError = null
    mocks.admission = { practitioner, response: null }
    mocks.organization = {
      id: 'org1',
      name: 'Practice',
      is_covered_entity: true,
      baa_status: 'pending',
      baa_signed_at: null,
    }
    mocks.organizationError = null
    mocks.updatedOrganization = {
      ...mocks.organization as Record<string, unknown>,
      baa_status: 'signed',
      baa_signed_at: '2026-07-19T00:00:00.000Z',
    }
    mocks.updateError = null
    mocks.updateFields.mockClear()
    mocks.admissionSpy.mockClear()
  })

  test('leaves unauthenticated requests as 401 for the caller to handle', async () => {
    mocks.user = null

    const response = await GET()

    expect(response.status).toBe(401)
    expect(mocks.admissionSpy).not.toHaveBeenCalled()
  })

  test('forwards the core AAL2/active-account denial and code', async () => {
    mocks.admission = {
      practitioner: null,
      response: NextResponse.json(
        { error: 'Multi-factor authentication is required.', code: 'mfa_required' },
        { status: 403 },
      ),
    }

    const response = await GET()

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'mfa_required' })
  })

  test.each(['pending', 'not_required']) (
    'allows an admitted covered entity to read organization settings while BAA is %s',
    async (baaStatus) => {
      mocks.organization = { ...mocks.organization as Record<string, unknown>, baa_status: baaStatus }

      const response = await GET()

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        organization: { is_covered_entity: true, baa_status: baaStatus },
      })
      expect(mocks.admissionSpy).toHaveBeenCalledOnce()
    },
  )

  test('lets an admitted unsigned covered entity record a signed BAA', async () => {
    const response = await PATCH(patchRequest({
      baa_status: 'signed',
      baa_signed_at: '2026-07-19T00:00:00.000Z',
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      organization: { baa_status: 'signed' },
    })
    expect(mocks.updateFields).toHaveBeenCalledWith(expect.objectContaining({
      baa_status: 'signed',
      baa_signed_at: '2026-07-19T00:00:00.000Z',
    }))
  })
})

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { getUser, practitionerAdmission, insert } = vi.hoisted(() => ({
  getUser: vi.fn(),
  practitionerAdmission: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser } }),
  createSupabaseServiceClient: () => ({
    from: (table: string) => {
      expect(table).toBe('practitioner_legal_acceptances')
      return { upsert: insert }
    },
  }),
}))

vi.mock('@/lib/auth/requirePractitioner', () => ({ practitionerAdmission }))

import { POST } from './route'

const ORIGINAL_TEST_MODE = process.env.POSTURE_TEST_MODE_ENABLED
const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV

const fixtureEvidence = [
  {
    document_id: 'terms-test-fixture-v1',
    body_sha256: '57a4cdb692b60cde1662346c292a6213ac1351dee20ed55ec23339ecf6a733b2',
  },
  {
    document_id: 'privacy-test-fixture-v1',
    body_sha256: '0b15b685fd1032bff1547563c6ce44dffb573485f6aef46d16e3f472597cea3b',
  },
  {
    document_id: 'screening-notice-test-fixture-v1',
    body_sha256: 'ce14bfa5b311aeed4c47267068730ef35b5daf6944a3fcf0d776c3a0868fac8f',
  },
]

function request(documents: unknown = fixtureEvidence) {
  return new NextRequest('http://localhost/api/legal/accept', {
    method: 'POST',
    body: JSON.stringify({ documents }),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/legal/accept', () => {
  beforeEach(() => {
    process.env.POSTURE_TEST_MODE_ENABLED = '1'
    process.env.VERCEL_ENV = 'preview'
    getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    practitionerAdmission.mockReset().mockResolvedValue({
      practitioner: { id: 'u1' },
      response: null,
    })
    insert.mockReset().mockResolvedValue({ error: null })
  })

  afterEach(() => {
    if (ORIGINAL_TEST_MODE === undefined) delete process.env.POSTURE_TEST_MODE_ENABLED
    else process.env.POSTURE_TEST_MODE_ENABLED = ORIGINAL_TEST_MODE
    if (ORIGINAL_VERCEL_ENV === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV
  })

  test('requires an authenticated session', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null })

    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(practitionerAdmission).not.toHaveBeenCalled()
  })

  test('requires admitted AAL2 but does not call the normal legal gate', async () => {
    practitionerAdmission.mockResolvedValueOnce({
      practitioner: null,
      response: NextResponse.json({ code: 'mfa_required' }, { status: 403 }),
    })

    const response = await POST(request())

    expect(response.status).toBe(403)
    expect(insert).not.toHaveBeenCalled()
  })

  test('atomically appends exact server-resolved evidence for all three documents', async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(insert).toHaveBeenCalledTimes(1)
    const rows = insert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.legal_document_id).sort()).toEqual(
      fixtureEvidence.map((item) => item.document_id).sort(),
    )
    expect(rows.every((row) => (
      row.practitioner_id === 'u1'
      && row.legal_document_version === 'test-1'
      && row.legal_jurisdiction === 'US'
      && row.legal_product_scope === 'us_fitness_wellness_assessment_beta_v1'
      && row.acceptance_context === 'practitioner_onboarding_v1'
      && row.acceptance_method === 'authenticated_checkbox'
      && typeof row.accepted_at === 'string'
    ))).toBe(true)
    await expect(response.json()).resolves.toEqual({ accepted: true })
  })

  test.each([
    ['omits a required document', fixtureEvidence.slice(0, 2)],
    ['submits a stale or forged hash', [
      { ...fixtureEvidence[0], body_sha256: '0'.repeat(64) },
      ...fixtureEvidence.slice(1),
    ]],
  ])('returns superseded when the client %s', async (_label, documents) => {
    const response = await POST(request(documents))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'superseded' })
    expect(insert).not.toHaveBeenCalled()
  })

  test('fails closed when production has no approved documents', async () => {
    delete process.env.POSTURE_TEST_MODE_ENABLED
    process.env.VERCEL_ENV = 'production'

    const response = await POST(request())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: 'legal_unavailable' })
    expect(insert).not.toHaveBeenCalled()
  })
})

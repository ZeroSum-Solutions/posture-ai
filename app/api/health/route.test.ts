import { beforeEach, describe, expect, test, vi } from 'vitest'

type ProbeResult = { error: { code?: string; message: string } | null }

const probeResults: Record<string, ProbeResult> = {}
const observedProbes: string[] = []

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: (column: string) => ({
        limit: async () => {
          const key = `${table}.${column}`
          observedProbes.push(key)
          return probeResults[key] ?? { error: null }
        },
      }),
    }),
  }),
}))

import { GET } from './route'

describe('GET /api/health schema readiness', () => {
  beforeEach(() => {
    observedProbes.length = 0
    for (const key of Object.keys(probeResults)) delete probeResults[key]
  })

  test('probes every column required by the current assessment write path', async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    expect(observedProbes).toEqual(expect.arrayContaining([
      'practitioners.id, role, access_status, invitation_id, session_valid_after',
      'muscles.slug',
      'assessments.priority_keys',
      'assessments.submission_id, submission_digest',
      'assessments.legal_document_id, legal_document_version, legal_document_body_sha256, legal_document_effective_at, legal_jurisdiction, legal_product_scope, legal_provenance_state',
      'captures.profile_side',
      'assessment_findings.observations',
      'practitioner_legal_acceptances.legal_document_id, legal_document_version, legal_document_body_sha256, legal_document_effective_at, legal_jurisdiction, legal_product_scope, accepted_at',
      'clinical_content_review_receipts.receipt_sha256',
      'clinical_content_releases.id, inventory_sha256, hg03_receipt_sha256',
      'clinical_content_release_items.release_id, item_id, item_sha256, review_status',
      'reports.report_scope, clinical_content_version, clinical_inventory_sha256, clinical_review_receipt_sha256',
      'workout_sessions.clinical_content_version, clinical_inventory_sha256, clinical_review_receipt_sha256',
    ]))
    expect(await response.json()).toMatchObject({
      schema: 'ready',
      clinical_content: {
        status: 'assessment_only',
        reason: 'hg03_activation_absent',
      },
    })
  })

  test.each([
    'practitioners.id, role, access_status, invitation_id, session_valid_after',
    'assessments.submission_id, submission_digest',
    'assessments.legal_document_id, legal_document_version, legal_document_body_sha256, legal_document_effective_at, legal_jurisdiction, legal_product_scope, legal_provenance_state',
    'captures.profile_side',
    'assessment_findings.observations',
    'practitioner_legal_acceptances.legal_document_id, legal_document_version, legal_document_body_sha256, legal_document_effective_at, legal_jurisdiction, legal_product_scope, accepted_at',
    'clinical_content_review_receipts.receipt_sha256',
    'clinical_content_releases.id, inventory_sha256, hg03_receipt_sha256',
    'clinical_content_release_items.release_id, item_id, item_sha256, review_status',
    'reports.report_scope, clinical_content_version, clinical_inventory_sha256, clinical_review_receipt_sha256',
    'workout_sessions.clinical_content_version, clinical_inventory_sha256, clinical_review_receipt_sha256',
  ])('reports pending_migration when %s is missing', async (probe) => {
    probeResults[probe] = { error: { code: '42703', message: 'column does not exist' } }

    const response = await GET()

    expect(response.status).toBe(200)
    expect((await response.json()).schema).toBe('pending_migration')
  })

  test.each(['PGRST204', 'PGRST205'])(
    'reports pending_migration for PostgREST schema code %s',
    async (code) => {
      probeResults['clinical_content_releases.id, inventory_sha256, hg03_receipt_sha256'] = {
        error: { code, message: 'schema cache is behind' },
      }

      const response = await GET()

      expect(response.status).toBe(200)
      expect((await response.json()).schema).toBe('pending_migration')
    },
  )
})

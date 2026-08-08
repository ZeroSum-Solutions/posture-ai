import { beforeEach, describe, expect, test, vi } from 'vitest'

type ProbeResult = { error: { code?: string; message: string } | null }
type RpcProbe = {
  name: string
  args: Record<string, unknown>
  options: { head?: boolean } | undefined
}

const probeResults: Record<string, ProbeResult> = {}
const rpcProbeResults: Record<string, ProbeResult> = {}
const observedProbes: string[] = []
const observedRpcProbes: RpcProbe[] = []

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
    rpc: async (
      name: string,
      args: Record<string, unknown>,
      options?: { head?: boolean },
    ) => {
      observedRpcProbes.push({ name, args, options })
      return rpcProbeResults[name] ?? { error: null }
    },
  }),
}))

import { GET } from './route'

describe('GET /api/health schema readiness', () => {
  beforeEach(() => {
    observedProbes.length = 0
    observedRpcProbes.length = 0
    for (const key of Object.keys(probeResults)) delete probeResults[key]
    for (const key of Object.keys(rpcProbeResults)) delete rpcProbeResults[key]
  })

  test('probes every schema contract required by current application paths', async () => {
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
    expect(observedRpcProbes).toEqual(expect.arrayContaining([
      {
        name: 'list_owned_clients_page',
        args: {
          p_search: '',
          p_snapshot_at: '1970-01-01T00:00:00.000Z',
          p_after_at: '1970-01-01T00:00:00.000Z',
          p_after_id: '00000000-0000-0000-0000-000000000000',
          p_limit: 1,
          p_filter: 'all',
        },
        options: { head: true },
      },
      {
        name: 'owned_client_directory_summary',
        args: { p_snapshot_at: '1970-01-01T00:00:00.000Z' },
        options: { head: true },
      },
      {
        name: 'owned_client_longest_since_scan',
        args: { p_snapshot_at: '1970-01-01T00:00:00.000Z' },
        options: { head: true },
      },
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

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      status: 'error',
      database: 'connected',
      schema: 'pending_migration',
    })
  })

  test.each(['PGRST204', 'PGRST205'])(
    'reports pending_migration for PostgREST schema code %s',
    async (code) => {
      probeResults['clinical_content_releases.id, inventory_sha256, hg03_receipt_sha256'] = {
        error: { code, message: 'schema cache is behind' },
      }

      const response = await GET()

      expect(response.status).toBe(503)
      expect((await response.json()).schema).toBe('pending_migration')
    },
  )

  test.each([
    'list_owned_clients_page',
    'owned_client_directory_summary',
    'owned_client_longest_since_scan',
  ])('reports pending_migration when RPC %s is missing', async (rpc) => {
    rpcProbeResults[rpc] = {
      error: { code: 'PGRST202', message: 'function is missing from the schema cache' },
    }

    const response = await GET()

    expect(response.status).toBe(503)
    expect((await response.json()).schema).toBe('pending_migration')
  })

  test('reports pending_migration for PostgreSQL missing-function errors', async () => {
    rpcProbeResults.owned_client_longest_since_scan = {
      error: { code: '42883', message: 'function does not exist' },
    }

    const response = await GET()

    expect(response.status).toBe(503)
    expect((await response.json()).schema).toBe('pending_migration')
  })
})

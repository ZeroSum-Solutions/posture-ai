import { describe, expect, it } from 'vitest'

import {
  assertLocalDatabaseUrl,
  buildPsqlBatches,
  normalizeFixtureManifest,
  parsePsqlEvidence,
  psqlConnectionEnv,
  summarizeExplain,
  validateQueryPlanArtifact,
} from './capture-query-plans.mjs'

const CLIENT_INDEX = 'clients_active_practitioner_created_id_idx'
const ASSESSMENT_INDEX = 'assessments_complete_client_practitioner_assessed_id_idx'
const SHA = 'a'.repeat(64)
const BASE = 'b'.repeat(40)
const HEAD = 'c'.repeat(40)
const PRACTITIONER = '11111111-1111-5111-8111-111111111111'
const CLIENT = '22222222-2222-5222-8222-222222222222'

function manifest() {
  return {
    schema_version: 1,
    fixture_contract_id: 'posture-ai-pr09-deterministic-performance-fixtures-v1',
    generated_at: '2026-07-22T00:00:00.000Z',
    local_only: true,
    fixture_environment: { database_host: '127.0.0.1' },
    fixtures: [{
      fixture_id: 'seeded_records_1000',
      fixture_record_count: 1000,
      practitioner_id: PRACTITIONER,
      anchor_client_id: CLIENT,
      counts: {
        active_clients: 1000,
        picker_search_clients: 1000,
        complete_anchor_assessments: 1000,
        assessment_findings: 8000,
        findings_per_assessment: 8,
      },
      db_projection_sha256: { clients: SHA, picker_search_clients: SHA, assessments: SHA, assessment_findings: SHA },
      browser: {
        fixture_id: 'seeded_records_1000',
        client_search_query: "D'Arcy",
      },
    }],
  }
}

function explain(indexName: string, relationName: string, rows = 51) {
  return [{
    Plan: {
      'Node Type': 'Limit',
      'Actual Rows': rows,
      'Actual Loops': 1,
      'Shared Hit Blocks': 10,
      Plans: [{
        'Node Type': 'Index Scan',
        'Relation Name': relationName,
        'Index Name': indexName,
        'Actual Rows': rows,
        'Actual Loops': 1,
        'Shared Hit Blocks': 8,
        'Shared Read Blocks': 2,
      }],
    },
    'Planning Time': 0.1,
    'Execution Time': 0.3,
  }]
}

function validArtifact() {
  const fixture = normalizeFixtureManifest(manifest())
  const { definitions } = buildPsqlBatches(fixture)
  const plans = definitions.flatMap((definition) => ['before', 'after'].map((phase) => {
    const isClient = definition.scenario_id.startsWith('client_')
    const index = phase === 'after'
      ? (isClient ? CLIENT_INDEX : ASSESSMENT_INDEX)
      : (isClient ? 'idx_clients_practitioner' : 'idx_assessments_client')
    const rows = definition.scenario_id === 'client_worst_case_no_match' ? 0 : 51
    return {
      phase,
      profile_kind: phase === 'before' ? 'retrospective_reconstruction' : 'current_after',
      query_capture_kind: 'reconstructed_sql_bound_to_source_hashes',
      scenario_id: definition.scenario_id,
      target_ids: definition.target_ids,
      sql: definition.sql,
      parameters: definition.parameters,
      explain: explain(index, isClient ? 'clients' : 'assessments', rows),
      summary: summarizeExplain(explain(index, isClient ? 'clients' : 'assessments', rows)),
    }
  }))
  return {
    schema_version: 1,
    local_supabase_only: true,
    query_capture_kind: 'reconstructed_sql_bound_to_source_hashes',
    provenance: {
      base_commit_sha: BASE,
      head_commit_sha: HEAD,
      fixture_manifest_sha256: SHA,
      fixture_source_sha256: SHA,
      query_source_files: [
        'app/api/clients/route.ts',
        'app/api/clients/[id]/assessments/route.ts',
        'supabase/migrations/20260722010000_bounded_history_indexes.sql',
        'supabase/migrations/20260722011000_owned_client_search.sql',
      ].map((path) => ({ path, sha256: SHA })),
    },
    fixture: {
      declared_counts: {
        active_clients: 1000,
        assessment_findings: 8000,
        complete_anchor_assessments: 1000,
        findings_per_assessment: 8,
        picker_search_clients: 1000,
      },
      observed_counts: {
        active_clients: 1000,
        assessment_findings: 8000,
        complete_anchor_assessments: 1000,
        findings_per_assessment: 8,
        picker_search_clients: 1000,
      },
    },
    index_state: {
      before_transactional_drop: [] as string[],
      rollback_verified: [CLIENT_INDEX, ASSESSMENT_INDEX],
      after: [CLIENT_INDEX, ASSESSMENT_INDEX],
    },
    plans,
  }
}

describe('query-plan fixture boundary', () => {
  it('accepts only the DB-projected local 1,000-record fixture', () => {
    expect(normalizeFixtureManifest(manifest())).toMatchObject({
      fixtureId: 'seeded_records_1000',
      fixtureRecordCount: 1000,
      practitionerId: PRACTITIONER,
      anchorClientId: CLIENT,
      searchQuery: "D'Arcy",
    })
  })

  it.each([
    ['remote manifest', (value: ReturnType<typeof manifest>) => { value.local_only = false }],
    ['wrong record count', (value: ReturnType<typeof manifest>) => { value.fixtures[0]!.fixture_record_count = 999 }],
    ['duplicate largest fixture', (value: ReturnType<typeof manifest>) => { value.fixtures.push(structuredClone(value.fixtures[0]!)) }],
    ['invalid projection hash', (value: ReturnType<typeof manifest>) => { value.fixtures[0]!.db_projection_sha256.clients = 'self-attested' }],
    ['inconsistent finding count', (value: ReturnType<typeof manifest>) => { value.fixtures[0]!.counts.assessment_findings -= 1 }],
  ])('rejects %s', (_label, mutate) => {
    const value = manifest()
    mutate(value)
    expect(() => normalizeFixtureManifest(value)).toThrow()
  })

  it('refuses production and non-PostgreSQL database URLs', () => {
    expect(assertLocalDatabaseUrl('postgresql://postgres:postgres@127.0.0.1:54322/postgres').hostname).toBe('127.0.0.1')
    expect(() => assertLocalDatabaseUrl('postgresql://prod.example.com/postgres')).toThrow(/loopback/)
    expect(() => assertLocalDatabaseUrl('https://127.0.0.1:54322/postgres')).toThrow(/loopback/)
  })

  it('passes local connection fields through libpq environment values, not a database-name URI', () => {
    expect(psqlConnectionEnv('postgresql://local%2Duser:s%40fe@127.0.0.1:54322/posture')).toEqual({
      PGHOST: '127.0.0.1', PGPORT: '54322', PGUSER: 'local-user', PGPASSWORD: 's@fe',
      PGDATABASE: 'posture', PGSSLMODE: 'disable',
    })
  })
})

describe('query-plan SQL and parser', () => {
  it('drops indexes only inside a rolled-back before transaction and captures five scenarios twice', () => {
    const fixture = normalizeFixtureManifest(manifest())
    const { before, after, definitions } = buildPsqlBatches(fixture)
    expect(definitions.map((row) => row.scenario_id)).toEqual([
      'client_empty_search',
      'client_prefix_search',
      'client_worst_case_no_match',
      'assessment_summary_history',
      'assessment_findings_heavy_history',
    ])
    expect(before.indexOf('BEGIN;')).toBeLessThan(before.indexOf(`DROP INDEX public.${CLIENT_INDEX};`))
    expect(before.indexOf(`DROP INDEX public.${ASSESSMENT_INDEX};`)).toBeLessThan(before.indexOf('ROLLBACK;'))
    expect(before.match(/EXPLAIN \(ANALYZE, BUFFERS, FORMAT JSON\)/g)).toHaveLength(5)
    expect(after).not.toContain('DROP INDEX')
    expect(after.match(/EXPLAIN \(ANALYZE, BUFFERS, FORMAT JSON\)/g)).toHaveLength(5)
    expect(after).toContain('count(*) FROM public.clients')
    expect(before).toContain('FROM public.clients')
    expect(before).not.toContain('FROM public.list_owned_clients_page')
    expect(before).toContain("D''Arcy")
  })

  it('parses exact marked plan, index, and count payloads', () => {
    const plan = JSON.stringify(explain(CLIENT_INDEX, 'clients'))
    const output = [
      '__POSTURE_AI_QUERY_PLAN__PLAN_BEGIN:after:client_empty_search',
      plan,
      '__POSTURE_AI_QUERY_PLAN__PLAN_END:after:client_empty_search',
      '__POSTURE_AI_QUERY_PLAN__INDEX_BEGIN:after',
      JSON.stringify([CLIENT_INDEX, ASSESSMENT_INDEX]),
      '__POSTURE_AI_QUERY_PLAN__INDEX_END:after',
      '__POSTURE_AI_QUERY_PLAN__COUNTS_BEGIN:seeded_records_1000',
      JSON.stringify({ active_clients: 1000 }),
      '__POSTURE_AI_QUERY_PLAN__COUNTS_END:seeded_records_1000',
    ].join('\n')
    const parsed = parsePsqlEvidence(output)
    expect(parsed.plans.get('after:client_empty_search')).toEqual(explain(CLIENT_INDEX, 'clients'))
    expect(parsed.indexes.get('after')).toEqual([CLIENT_INDEX, ASSESSMENT_INDEX])
    expect(parsed.counts.get('seeded_records_1000')).toEqual({ active_clients: 1000 })
  })

  it('fails closed for duplicate, unclosed, and malformed marked evidence', () => {
    const begin = '__POSTURE_AI_QUERY_PLAN__PLAN_BEGIN:after:client_empty_search'
    const end = '__POSTURE_AI_QUERY_PLAN__PLAN_END:after:client_empty_search'
    expect(() => parsePsqlEvidence(`${begin}\n[]\n${end}\n${begin}\n[]\n${end}`)).toThrow(/Duplicate/)
    expect(() => parsePsqlEvidence(`${begin}\n[]`)).toThrow(/Missing/)
    expect(() => parsePsqlEvidence(`${begin}\nnot-json\n${end}`)).toThrow(/Malformed/)
  })

  it('records nested index, sequential-scan, row, time, and buffer evidence', () => {
    const payload = explain(CLIENT_INDEX, 'clients')
    payload[0].Plan.Plans.push({
      'Node Type': 'Seq Scan',
      'Relation Name': 'assessment_findings',
      'Actual Rows': 8,
      'Actual Loops': 51,
      'Shared Hit Blocks': 4,
    } as never)
    expect(summarizeExplain(payload)).toMatchObject({
      planning_time_milliseconds: 0.1,
      execution_time_milliseconds: 0.3,
      actual_rows: 51,
      index_names: [CLIENT_INDEX],
      sequential_scans: ['assessment_findings'],
      has_sequential_scan: true,
      nodes: expect.arrayContaining([expect.objectContaining({ shared_read_blocks: 2 })]),
    })
  })
})

describe('query-plan artifact validation', () => {
  it('accepts complete target, fixture, rollback, and index-use evidence', () => {
    expect(validateQueryPlanArtifact(validArtifact())).toEqual([])
  })

  it.each([
    ['missing plan', (value: ReturnType<typeof validArtifact>) => { value.plans.pop() }],
    ['wrong before label', (value: ReturnType<typeof validArtifact>) => { value.plans[0]!.profile_kind = 'contemporaneous' }],
    ['index survived before drop', (value: ReturnType<typeof validArtifact>) => { value.index_state.before_transactional_drop = [CLIENT_INDEX] }],
    ['rollback did not restore index', (value: ReturnType<typeof validArtifact>) => { value.index_state.rollback_verified = [CLIENT_INDEX] }],
    ['fixture count mismatch', (value: ReturnType<typeof validArtifact>) => { value.fixture.observed_counts.active_clients = 999 }],
    ['missing query source binding', (value: ReturnType<typeof validArtifact>) => { value.provenance.query_source_files.pop() }],
    ['unlabeled reconstructed SQL', (value: ReturnType<typeof validArtifact>) => { value.query_capture_kind = 'live_route_sql' }],
    ['after plans never use client index', (value: ReturnType<typeof validArtifact>) => {
      for (const plan of value.plans.filter((row) => row.phase === 'after')) plan.summary.index_names = [ASSESSMENT_INDEX]
    }],
  ])('rejects %s', (_label, mutate) => {
    const value = validArtifact()
    mutate(value)
    expect(validateQueryPlanArtifact(value)).not.toEqual([])
  })
})

#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url)), REPO_ROOT = resolve(SCRIPT_DIR, '../..')
const DEFAULT_MANIFEST = 'test-results/performance/fixture-manifest.json', DEFAULT_OUTPUT = 'test-results/performance/query-plans.json', FIXTURE_ID = 'seeded_records_1000', FIXTURE_COUNT = 1000
const FIXTURE_CONTRACT_ID = 'posture-ai-pr09-deterministic-performance-fixtures-v1'
const REQUIRED_INDEXES = ['assessments_complete_client_practitioner_assessed_id_idx', 'clients_active_practitioner_created_id_idx'], REQUIRED_TARGETS = ['clients_page_list', 'clients_api_list', 'assessment_client_picker', 'client_assessment_history']
export const QUERY_SOURCE_PATHS = [
  'app/api/clients/route.ts',
  'app/api/clients/[id]/assessments/route.ts',
  'supabase/migrations/20260722010000_bounded_history_indexes.sql',
  'supabase/migrations/20260722011000_owned_client_search.sql',
]
const SHA256 = /^[a-f0-9]{64}$/, COMMIT = /^[a-f0-9]{40}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/, MARKER = '__POSTURE_AI_QUERY_PLAN__'
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  }
  return value
}
function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'` }
function repoPath(path) {
  const absolute = resolve(REPO_ROOT, path)
  const fromRoot = relative(REPO_ROOT, absolute)
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new Error(`Path escapes repository: ${path}`)
  return { absolute, relative: fromRoot }
}
export function assertLocalDatabaseUrl(raw) {
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('PERF_DB_URL must be a valid PostgreSQL URL')
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const isV4Loopback = /^127(?:\.(?:\d{1,3})){3}$/.test(host)
    && host.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255)
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['localhost', '::1'].includes(host) && !isV4Loopback) {
    throw new Error('PERF_DB_URL must target loopback PostgreSQL; production is forbidden')
  }
  return parsed
}
export function psqlConnectionEnv(raw) {
  const parsed = assertLocalDatabaseUrl(raw)
  return {
    PGHOST: parsed.hostname, PGPORT: parsed.port || '5432', PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password), PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, '')), PGSSLMODE: 'disable',
  }
}
export function normalizeFixtureManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Fixture manifest must be an object')
  if (manifest.schema_version !== 1) throw new Error('Fixture manifest schema_version must be 1')
  if (manifest.fixture_contract_id !== FIXTURE_CONTRACT_ID) throw new Error('Fixture contract ID mismatch')
  if (manifest.local_only !== true) throw new Error('Fixture manifest must be local_only')
  if (!Number.isFinite(Date.parse(manifest.generated_at ?? ''))) throw new Error('Fixture generated_at must be an ISO timestamp')
  const databaseHost = String(manifest.fixture_environment?.database_host ?? '').toLowerCase()
  if (!['localhost', '::1'].includes(databaseHost) && !/^127(?:\.(?:\d{1,3})){3}$/.test(databaseHost)) {
    throw new Error('Fixture environment must identify a loopback database')
  }
  const matches = Array.isArray(manifest.fixtures)
    ? manifest.fixtures.filter((row) => row?.fixture_id === FIXTURE_ID)
    : []
  if (matches.length !== 1) throw new Error(`Fixture manifest must contain exactly one ${FIXTURE_ID}`)
  const fixture = matches[0]
  const browser = fixture.browser ?? manifest.browser
  const counts = fixture.counts
  if (fixture.fixture_record_count !== FIXTURE_COUNT) throw new Error(`${FIXTURE_ID} must contain exactly ${FIXTURE_COUNT} records`)
  if (!UUID.test(fixture.practitioner_id ?? '')) throw new Error('Fixture practitioner_id must be a canonical UUID')
  if (!UUID.test(fixture.anchor_client_id ?? '')) throw new Error('Fixture anchor_client_id must be a canonical UUID')
  if (!browser || browser.fixture_id !== FIXTURE_ID || typeof browser.client_search_query !== 'string' || !browser.client_search_query.trim()) {
    throw new Error('Fixture browser alias/search query is missing or mismatched')
  }
  if (!counts || counts.active_clients !== FIXTURE_COUNT || counts.picker_search_clients !== FIXTURE_COUNT
    || counts.complete_anchor_assessments !== FIXTURE_COUNT) {
    throw new Error('Fixture DB counts must prove 1,000 active clients, picker matches, and anchor assessments')
  }
  if (!Number.isInteger(counts.findings_per_assessment) || counts.findings_per_assessment < 1
    || counts.assessment_findings !== FIXTURE_COUNT * counts.findings_per_assessment) {
    throw new Error('Fixture finding counts are internally inconsistent')
  }
  for (const table of ['clients', 'picker_search_clients', 'assessments', 'assessment_findings']) {
    if (!SHA256.test(fixture.db_projection_sha256?.[table] ?? '')) throw new Error(`Fixture ${table} projection SHA-256 is invalid`)
  }
  return {
    fixtureId: fixture.fixture_id, fixtureRecordCount: fixture.fixture_record_count,
    practitionerId: fixture.practitioner_id, anchorClientId: fixture.anchor_client_id,
    searchQuery: browser.client_search_query.trim(), databaseHost, counts,
    dbProjectionSha256: fixture.db_projection_sha256,
  }
}
function planDefinitions(fixture) {
  const snapshot = '9999-12-31T23:59:59.999Z'
  // EXPLAINing the RPC call hides its SET-search_path SQL body behind a
  // Function Scan. Expand the exact null-cursor body so the plan exposes the
  // table index and buffer evidence selected by PostgreSQL.
  const clientSql = `SELECT id, first_name, last_name, date_of_birth, created_at FROM public.clients
WHERE practitioner_id = $1 AND archived_at IS NULL AND deleted_at IS NULL AND created_at <= $2
  AND ($3 = '' OR first_name ILIKE $3 || '%' OR last_name ILIKE $3 || '%'
    OR concat_ws(' ', first_name, last_name) ILIKE $3 || '%'
    OR concat_ws(' ', last_name, first_name) ILIKE $3 || '%')
ORDER BY created_at DESC, id DESC LIMIT 51`
  const historySql = `SELECT id, assessed_at, overall_grade, overall_score, status, scoring_engine_version
FROM public.assessments
WHERE client_id = $1 AND practitioner_id = $2 AND status = 'complete' AND assessed_at <= $3
ORDER BY assessed_at DESC, id DESC LIMIT 51`
  const findingsSql = `WITH bounded AS MATERIALIZED (
  SELECT id, assessed_at, overall_grade, overall_score, status, scoring_engine_version
  FROM public.assessments
  WHERE client_id = $1 AND practitioner_id = $2 AND status = 'complete' AND assessed_at <= $3
  ORDER BY assessed_at DESC, id DESC LIMIT 51
)
SELECT bounded.*, finding.imbalance_key, finding.label, finding.severity_pct, finding.zone,
  finding.region, finding.deviation, finding.standard, finding.unit
FROM bounded
LEFT JOIN public.assessment_findings AS finding ON finding.assessment_id = bounded.id
  AND finding.practitioner_id = $2
ORDER BY bounded.assessed_at DESC, bounded.id DESC`
  const client = (scenarioId, targetIds, search) => ({
    scenario_id: scenarioId,
    target_ids: targetIds,
    sql: clientSql,
    parameters: [fixture.practitionerId, snapshot, search],
    executable: clientSql
      .replaceAll('$1', `${sqlLiteral(fixture.practitionerId)}::uuid`)
      .replaceAll('$2', `${sqlLiteral(snapshot)}::timestamptz`)
      .replaceAll('$3', sqlLiteral(search)),
  })
  return [
    client('client_empty_search', ['clients_page_list', 'clients_api_list'], ''),
    client('client_prefix_search', ['assessment_client_picker'], fixture.searchQuery),
    client('client_worst_case_no_match', ['clients_api_list'], 'ZzNeverMatchesPostureAiProof'),
    {
      scenario_id: 'assessment_summary_history',
      target_ids: ['client_assessment_history'],
      sql: historySql,
      parameters: [fixture.anchorClientId, fixture.practitionerId, snapshot],
      executable: historySql
        .replaceAll('$1', `${sqlLiteral(fixture.anchorClientId)}::uuid`)
        .replaceAll('$2', `${sqlLiteral(fixture.practitionerId)}::uuid`)
        .replaceAll('$3', `${sqlLiteral(snapshot)}::timestamptz`),
    },
    {
      scenario_id: 'assessment_findings_heavy_history',
      target_ids: ['client_assessment_history'],
      sql: findingsSql,
      parameters: [fixture.anchorClientId, fixture.practitionerId, snapshot],
      executable: findingsSql
        .replaceAll('$1', `${sqlLiteral(fixture.anchorClientId)}::uuid`)
        .replaceAll('$2', `${sqlLiteral(fixture.practitionerId)}::uuid`)
        .replaceAll('$3', `${sqlLiteral(snapshot)}::timestamptz`),
    },
  ]
}
function marker(kind, id = '') { return `${MARKER}${kind}${id ? `:${id}` : ''}` }
function explainBlock(phase, definition) {
  return [
    `\\echo ${marker('PLAN_BEGIN', `${phase}:${definition.scenario_id}`)}`,
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${definition.executable};`,
    `\\echo ${marker('PLAN_END', `${phase}:${definition.scenario_id}`)}`,
  ].join('\n')
}
function indexBlock(id) {
  return [
    `\\echo ${marker('INDEX_BEGIN', id)}`,
    `SELECT coalesce(json_agg(indexname ORDER BY indexname), '[]'::json)::text FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY(ARRAY[${REQUIRED_INDEXES.map(sqlLiteral).join(',')}]);`,
    `\\echo ${marker('INDEX_END', id)}`,
  ].join('\n')
}
export function buildPsqlBatches(fixture) {
  const definitions = planDefinitions(fixture)
  const prelude = ['\\pset tuples_only on', '\\pset format unaligned', '\\pset pager off', `SELECT set_config('request.jwt.claim.sub', ${sqlLiteral(fixture.practitionerId)}, false);`].join('\n')
  const before = [
    prelude,
    'BEGIN;',
    ...REQUIRED_INDEXES.map((index) => `DROP INDEX public.${index};`),
    indexBlock('before_transactional_drop'),
    ...definitions.map((definition) => explainBlock('before', definition)),
    'ROLLBACK;',
    indexBlock('rollback_verified'),
  ].join('\n')
  const after = [
    prelude,
    indexBlock('after'),
    `\\echo ${marker('COUNTS_BEGIN', FIXTURE_ID)}`,
    `SELECT json_build_object(
      'active_clients', (SELECT count(*) FROM public.clients WHERE practitioner_id = ${sqlLiteral(fixture.practitionerId)}::uuid AND archived_at IS NULL AND deleted_at IS NULL),
      'picker_search_clients', (SELECT count(*) FROM public.clients WHERE practitioner_id = ${sqlLiteral(fixture.practitionerId)}::uuid AND archived_at IS NULL AND deleted_at IS NULL AND (
        first_name ILIKE ${sqlLiteral(`${fixture.searchQuery}%`)} OR last_name ILIKE ${sqlLiteral(`${fixture.searchQuery}%`)}
        OR concat_ws(' ', first_name, last_name) ILIKE ${sqlLiteral(`${fixture.searchQuery}%`)}
        OR concat_ws(' ', last_name, first_name) ILIKE ${sqlLiteral(`${fixture.searchQuery}%`)}
      )),
      'complete_anchor_assessments', (SELECT count(*) FROM public.assessments WHERE practitioner_id = ${sqlLiteral(fixture.practitionerId)}::uuid AND client_id = ${sqlLiteral(fixture.anchorClientId)}::uuid AND status = 'complete'),
      'assessment_findings', (SELECT count(*) FROM public.assessment_findings f JOIN public.assessments a ON a.id = f.assessment_id WHERE a.practitioner_id = ${sqlLiteral(fixture.practitionerId)}::uuid AND a.client_id = ${sqlLiteral(fixture.anchorClientId)}::uuid AND a.status = 'complete')
    )::text;`,
    `\\echo ${marker('COUNTS_END', FIXTURE_ID)}`,
    ...definitions.map((definition) => explainBlock('after', definition)),
  ].join('\n')
  return { before, after, definitions }
}
function parseSections(output, kind) {
  const rows = new Map()
  const beginPrefix = marker(`${kind}_BEGIN`)
  const endPrefix = marker(`${kind}_END`)
  const lines = output.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line.startsWith(`${beginPrefix}:`)) continue
    const id = line.slice(beginPrefix.length + 1)
    if (!id || rows.has(id)) throw new Error(`Duplicate or invalid ${kind.toLowerCase()} marker: ${id}`)
    const body = []
    index += 1
    while (index < lines.length && lines[index].trim() !== `${endPrefix}:${id}`) {
      body.push(lines[index])
      index += 1
    }
    if (index >= lines.length) throw new Error(`Missing ${kind.toLowerCase()} end marker: ${id}`)
    try {
      rows.set(id, JSON.parse(body.join('\n').trim()))
    } catch {
      throw new Error(`Malformed ${kind.toLowerCase()} JSON: ${id}`)
    }
  }
  return rows
}
export function parsePsqlEvidence(output) {
  return { plans: parseSections(output, 'PLAN'), indexes: parseSections(output, 'INDEX'), counts: parseSections(output, 'COUNTS') }
}
export function summarizeExplain(explain) {
  if (!Array.isArray(explain) || explain.length !== 1 || !explain[0]?.Plan) throw new Error('EXPLAIN JSON must contain one analyzed plan')
  const nodes = []
  const visit = (node) => {
    nodes.push({
      node_type: node['Node Type'] ?? null,
      relation_name: node['Relation Name'] ?? null,
      index_name: node['Index Name'] ?? null,
      actual_rows: node['Actual Rows'] ?? null,
      actual_loops: node['Actual Loops'] ?? null,
      shared_hit_blocks: node['Shared Hit Blocks'] ?? 0,
      shared_read_blocks: node['Shared Read Blocks'] ?? 0,
      shared_dirtied_blocks: node['Shared Dirtied Blocks'] ?? 0,
      shared_written_blocks: node['Shared Written Blocks'] ?? 0,
      temp_read_blocks: node['Temp Read Blocks'] ?? 0,
      temp_written_blocks: node['Temp Written Blocks'] ?? 0,
    })
    for (const child of node.Plans ?? []) visit(child)
  }
  visit(explain[0].Plan)
  return {
    planning_time_milliseconds: explain[0]['Planning Time'] ?? null,
    execution_time_milliseconds: explain[0]['Execution Time'] ?? null,
    actual_rows: explain[0].Plan['Actual Rows'] ?? null,
    index_names: [...new Set(nodes.map((node) => node.index_name).filter(Boolean))].sort(),
    sequential_scans: nodes.filter((node) => node.node_type === 'Seq Scan').map((node) => node.relation_name).filter(Boolean).sort(),
    has_sequential_scan: nodes.some((node) => node.node_type === 'Seq Scan'),
    nodes,
  }
}
export function validateQueryPlanArtifact(artifact) {
  const errors = []
  if (artifact.schema_version !== 1 || artifact.local_supabase_only !== true) errors.push('LOCAL_PROVENANCE_INVALID')
  if (artifact.query_capture_kind !== 'reconstructed_sql_bound_to_source_hashes') errors.push('QUERY_CAPTURE_KIND_INVALID')
  if (!COMMIT.test(artifact.provenance?.base_commit_sha ?? '') || !COMMIT.test(artifact.provenance?.head_commit_sha ?? '')) errors.push('COMMIT_PROVENANCE_INVALID')
  if (!SHA256.test(artifact.provenance?.fixture_manifest_sha256 ?? '') || !SHA256.test(artifact.provenance?.fixture_source_sha256 ?? '')) errors.push('SOURCE_PROVENANCE_INVALID')
  const querySources = Array.isArray(artifact.provenance?.query_source_files) ? artifact.provenance.query_source_files : []
  const querySourcePaths = querySources.map((source) => source?.path).sort()
  if (JSON.stringify(querySourcePaths) !== JSON.stringify([...QUERY_SOURCE_PATHS].sort())
    || querySources.some((source) => !SHA256.test(source?.sha256 ?? ''))) errors.push('QUERY_SOURCE_PROVENANCE_INVALID')
  if (JSON.stringify(stable(artifact.fixture?.observed_counts)) !== JSON.stringify(stable(artifact.fixture?.declared_counts))) errors.push('FIXTURE_COUNT_MISMATCH')
  const before = artifact.index_state?.before_transactional_drop ?? []
  const after = artifact.index_state?.after ?? []
  const rollback = artifact.index_state?.rollback_verified ?? []
  if (before.some((index) => REQUIRED_INDEXES.includes(index))) errors.push('BEFORE_INDEX_DROP_FAILED')
  if (REQUIRED_INDEXES.some((index) => !after.includes(index) || !rollback.includes(index))) errors.push('INDEX_PRESENCE_INVALID')
  const plans = Array.isArray(artifact.plans) ? artifact.plans : []
  const expectedScenarios = new Set(planDefinitions({ searchQuery: 'Fixture', anchorClientId: '00000000-0000-1000-8000-000000000000', practitionerId: '00000000-0000-1000-8000-000000000000' }).map((row) => row.scenario_id))
  for (const phase of ['before', 'after']) {
    for (const scenario of expectedScenarios) {
      if (plans.filter((plan) => plan.phase === phase && plan.scenario_id === scenario).length !== 1) errors.push(`PLAN_COVERAGE_INVALID:${phase}:${scenario}`)
    }
  }
  const targets = new Set(plans.flatMap((plan) => plan.target_ids ?? []))
  for (const target of REQUIRED_TARGETS) if (!targets.has(target)) errors.push(`TARGET_COVERAGE_INVALID:${target}`)
  if (plans.some((plan) => plan.phase === 'before' && plan.profile_kind !== 'retrospective_reconstruction')) errors.push('BEFORE_LABEL_INVALID')
  if (plans.some((plan) => plan.phase === 'after' && plan.profile_kind !== 'current_after')) errors.push('AFTER_LABEL_INVALID')
  for (const plan of plans) {
    if (plan.query_capture_kind !== 'reconstructed_sql_bound_to_source_hashes') errors.push(`PLAN_QUERY_CAPTURE_KIND_INVALID:${plan.phase}:${plan.scenario_id}`)
    if (!plan.sql || !Array.isArray(plan.parameters) || !Array.isArray(plan.explain)) errors.push(`PLAN_PROVENANCE_INVALID:${plan.phase}:${plan.scenario_id}`)
    const summary = plan.summary
    if (!Number.isFinite(summary?.planning_time_milliseconds) || !Number.isFinite(summary?.execution_time_milliseconds)
      || !Number.isFinite(summary?.actual_rows) || !Array.isArray(summary?.nodes)
      || !Array.isArray(summary?.index_names) || !Array.isArray(summary?.sequential_scans)
      || typeof summary?.has_sequential_scan !== 'boolean') errors.push(`PLAN_SUMMARY_INVALID:${plan.phase}:${plan.scenario_id}`)
  }
  if (plans.some((plan) => plan.phase === 'before' && plan.summary?.index_names?.some((index) => REQUIRED_INDEXES.includes(index)))) errors.push('BEFORE_PLAN_USED_DROPPED_INDEX')
  const noMatch = plans.find((plan) => plan.phase === 'after' && plan.scenario_id === 'client_worst_case_no_match')
  if (noMatch?.summary?.actual_rows !== 0) errors.push('NO_MATCH_SCENARIO_INVALID')
  const usedAfter = new Set(plans.filter((plan) => plan.phase === 'after').flatMap((plan) => plan.summary?.index_names ?? []))
  for (const index of REQUIRED_INDEXES) if (!usedAfter.has(index)) errors.push(`REQUIRED_INDEX_UNUSED:${index}`)
  return [...new Set(errors)]
}
function executePsql(databaseUrl, sql) {
  const result = spawnSync('psql', ['-X', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--quiet'], {
    cwd: REPO_ROOT, env: { ...process.env, ...psqlConnectionEnv(databaseUrl) },
    input: sql, encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`Local query-plan capture failed: ${(result.stderr || 'psql exited non-zero').trim()}`)
  return result.stdout
}
function git(...args) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`Git provenance check failed: ${args.join(' ')}`)
  return result.stdout.trim()
}
export function captureQueryPlans(options) {
  const databaseUrl = assertLocalDatabaseUrl(options.databaseUrl).toString()
  const manifestFile = repoPath(options.manifestPath ?? DEFAULT_MANIFEST)
  const outputFile = repoPath(options.outputPath ?? DEFAULT_OUTPUT)
  const manifestBytes = readFileSync(manifestFile.absolute)
  const manifest = JSON.parse(manifestBytes)
  const fixture = normalizeFixtureManifest(manifest)
  if (assertLocalDatabaseUrl(databaseUrl).hostname.toLowerCase() !== fixture.databaseHost) {
    throw new Error('Fixture database host does not match PERF_DB_URL')
  }
  const sourceFile = repoPath(options.sourcePath ?? 'scripts/performance/seed.ts')
  const sourceBytes = readFileSync(sourceFile.absolute)
  const querySourceFiles = QUERY_SOURCE_PATHS.map((path) => {
    const source = repoPath(path)
    return { path: source.relative, sha256: sha256(readFileSync(source.absolute)) }
  })
  const headCommit = options.headCommit ?? git('rev-parse', 'HEAD')
  const baseCommit = options.baseCommit ?? git('merge-base', headCommit, 'origin/main')
  if (!COMMIT.test(headCommit) || !COMMIT.test(baseCommit)) throw new Error('Base/head commit must be full lowercase SHA-1 values')
  if (headCommit !== git('rev-parse', 'HEAD')) throw new Error('Declared head commit does not match checked-out HEAD')
  git('merge-base', '--is-ancestor', baseCommit, headCommit)
  const batches = buildPsqlBatches(fixture)
  const beforeEvidence = parsePsqlEvidence((options.executePsql ?? executePsql)(databaseUrl, batches.before))
  const afterEvidence = parsePsqlEvidence((options.executePsql ?? executePsql)(databaseUrl, batches.after))
  const plans = []
  for (const definition of batches.definitions) {
    for (const [phase, evidence, profileKind] of [
      ['before', beforeEvidence, 'retrospective_reconstruction'],
      ['after', afterEvidence, 'current_after'],
    ]) {
      const explain = evidence.plans.get(`${phase}:${definition.scenario_id}`)
      if (!explain) throw new Error(`Missing captured plan: ${phase}:${definition.scenario_id}`)
      plans.push({
        phase, profile_kind: profileKind, scenario_id: definition.scenario_id,
        query_capture_kind: 'reconstructed_sql_bound_to_source_hashes',
        target_ids: definition.target_ids, sql: definition.sql,
        parameters: definition.parameters, explain,
        summary: summarizeExplain(explain),
      })
    }
  }
  const observedCounts = afterEvidence.counts.get(FIXTURE_ID)
  if (!observedCounts) throw new Error('Database count evidence is missing')
  const artifact = {
    schema_version: 1, artifact_id: 'posture-ai-pr09-query-plan-evidence-v1',
    captured_at: new Date().toISOString(), local_supabase_only: true, status: 'PENDING_VALIDATION',
    query_capture_kind: 'reconstructed_sql_bound_to_source_hashes',
    timing_interpretation: 'diagnostic_only_not_a_controlled_latency_benchmark',
    provenance: {
      base_commit_sha: baseCommit, head_commit_sha: headCommit,
      fixture_manifest_path: manifestFile.relative, fixture_manifest_sha256: sha256(manifestBytes),
      fixture_source_path: sourceFile.relative, fixture_source_sha256: sha256(sourceBytes),
      query_source_files: querySourceFiles,
      fixture_projection_sha256: stable(fixture.dbProjectionSha256),
    },
    fixture: {
      fixture_id: fixture.fixtureId, fixture_record_count: fixture.fixtureRecordCount,
      declared_counts: stable(fixture.counts), observed_counts: { ...observedCounts, findings_per_assessment: fixture.counts.findings_per_assessment },
    },
    required_target_ids: REQUIRED_TARGETS, required_index_names: REQUIRED_INDEXES,
    index_state: {
      before_transactional_drop: beforeEvidence.indexes.get('before_transactional_drop') ?? null,
      rollback_verified: beforeEvidence.indexes.get('rollback_verified') ?? null, after: afterEvidence.indexes.get('after') ?? null,
    },
    plans,
  }
  const errors = validateQueryPlanArtifact(artifact)
  artifact.status = errors.length ? 'FAIL' : 'PASS'
  artifact.errors = errors
  writeFileSync(outputFile.absolute, `${JSON.stringify(artifact, null, 2)}\n`)
  if (errors.length) throw new Error(`Query-plan evidence failed: ${errors.join(', ')}`)
  return artifact
}
function parseArgs(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    if (!['--manifest', '--output', '--source', '--base-commit', '--head-commit'].includes(key)) throw new Error(`Unknown argument: ${key}`)
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`)
    options[key.slice(2).replaceAll('-', '_')] = value
    index += 1
  }
  return options
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2))
    const artifact = captureQueryPlans({
      databaseUrl: process.env.PERF_DB_URL ?? '', manifestPath: args.manifest,
      outputPath: args.output, sourcePath: args.source,
      baseCommit: args.base_commit, headCommit: args.head_commit,
    })
    process.stdout.write(`${JSON.stringify({ status: artifact.status, output: args.output ?? DEFAULT_OUTPUT, plans: artifact.plans.length })}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

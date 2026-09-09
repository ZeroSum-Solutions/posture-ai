#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import process from 'node:process'
import pg from 'pg'

const { Client } = pg
const databaseUrl = process.env.SUPABASE_DB_URL
if (!databaseUrl) throw new Error('Set SUPABASE_DB_URL to the isolated local test database')
const destination = new URL(databaseUrl)
if (!['127.0.0.1', 'localhost'].includes(destination.hostname)
  || !['54322', '55422'].includes(destination.port)) {
  throw new Error('Race fixtures require an explicitly selected local Supabase test database')
}

const fixturePath = new URL('./training_progression_proposals_test.sql', import.meta.url)
const coachId = '49000000-0000-4000-8000-000000000001'
const proposalId = '49000000-0000-4000-8000-000000000005'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function connection() {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  return client
}

async function asActor(client, actorId = coachId) {
  await client.query('BEGIN')
  await client.query("SET LOCAL statement_timeout = '10s'")
  await client.query("SET LOCAL lock_timeout = '5s'")
  await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [actorId])
  await client.query(
    "SELECT set_config('request.jwt.claims', $1, true)",
    [JSON.stringify({ sub: actorId, aal: 'aal2', iat: 2_000_000_000 })],
  )
  await client.query('SET LOCAL ROLE authenticated')
}

const evidenceSeed = `
INSERT INTO public.training_session_prescriptions (
  session_id, subject_id, assignment_id, program_revision_number,
  prescription_json, started_by_user_id, started_at
)
SELECT
  'progression-session-1',
  '49000000-0000-4000-8000-000000000002',
  'progression-assignment-1',
  1,
  pg_catalog.jsonb_build_object(
    'schemaVersion', 'training-session-prescription.v1',
    'sessionId', 'progression-session-1',
    'assignmentId', 'progression-assignment-1',
    'programRevisionNumber', 1,
    'subjectId', '49000000-0000-4000-8000-000000000002',
    'executionContext', program->'executionContext',
    'scheduledLocalDate', session->>'scheduledLocalDate',
    'athleteTimezone', session->>'athleteTimezone',
    'profileRevisionId', program->>'profileRevisionId',
    'eligibilitySourceRevisionId', program->>'eligibilitySourceRevisionId',
    'compilerPolicyVersion', program->>'compilerPolicyVersion',
    'catalogVersion', program->>'catalogVersion',
    'catalogOrigin', program->'catalogOrigin',
    'compiledProgramRevisionId', program->>'compiledProgramRevisionId',
    'ruleVersion', program->>'ruleVersion',
    'exercises', session->'exercises'
  ),
  '49000000-0000-4000-8000-000000000001',
  '2026-09-01T17:00:00Z'
FROM (SELECT pg_temp.progression_program(1) AS program) revision
CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(revision.program->'sessions') session
WHERE session->>'sessionId' = 'progression-session-1';

INSERT INTO public.training_set_log_events (
  id, subject_id, session_id, set_id, event_revision,
  replaces_event_id, actor_user_id, event_json, created_at
) VALUES (
  '49000000-0000-4000-8000-000000000020',
  '49000000-0000-4000-8000-000000000002',
  'progression-session-1',
  'progression-set-1-1',
  1,
  NULL,
  '49000000-0000-4000-8000-000000000001',
  '{
    "schemaVersion":"training-set-log-event.v1",
    "eventId":"49000000-0000-4000-8000-000000000020",
    "eventType":"set_actual_recorded",
    "eventRevision":1,
    "replacesEventId":null,
    "subjectId":"49000000-0000-4000-8000-000000000002",
    "sessionId":"progression-session-1",
    "exerciseInstanceId":"progression-exercise-1",
    "setId":"progression-set-1-1",
    "setKind":"working",
    "workingSetOrdinal":1,
    "executionContext":{"kind":"synthetic_simulation","simulationRunId":"49000000-0000-4000-8000-000000000003","fixtureId":"synthetic-starter-catalog.v1","fixtureHash":"ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717","label":"Practice data"},
    "equipmentId":"machine-1",
    "loadBasis":"machine_stack",
    "quantity":{"entered":{"value":"50","unit":"kg"},"canonicalKg":"50"},
    "reps":8,
    "rir":2,
    "side":"bilateral",
    "symptomState":"none",
    "actor":{"kind":"coach","userId":"49000000-0000-4000-8000-000000000001"},
    "occurredAt":"2026-09-01T17:30:00Z",
    "serverAt":"2026-09-01T17:30:01Z"
  }'::jsonb,
  '2026-09-01T17:30:01Z'
);
`

async function installFixture(admin) {
  const source = await readFile(fixturePath, 'utf8')
  const start = source.indexOf('SET LOCAL session_replication_role = replica;')
  const end = source.indexOf("SELECT set_config('request.jwt.claim.sub'", start)
  assert(start >= 0 && end > start, 'could not locate the canonical progression fixture')
  const fixture = source.slice(start, end).replace(
    'SET LOCAL session_replication_role = origin;',
    `${evidenceSeed}\nSET LOCAL session_replication_role = origin;`,
  )
  await admin.query(`BEGIN;\n${fixture}\nCOMMIT;`)
}

async function cleanupFixture(admin) {
  await admin.query(`
    BEGIN;
    SET LOCAL session_replication_role = replica;
    DELETE FROM public.training_progression_acceptances
      WHERE proposal_id = '${proposalId}';
    DELETE FROM public.training_progression_proposals
      WHERE subject_id = '49000000-0000-4000-8000-000000000002';
    DELETE FROM public.training_mutation_receipts
      WHERE session_id LIKE 'progression-session-%';
    DELETE FROM public.training_set_log_events
      WHERE session_id LIKE 'progression-session-%';
    DELETE FROM public.training_conditioning_log_events
      WHERE session_id LIKE 'progression-session-%';
    DELETE FROM public.training_session_progression_metadata
      WHERE session_id LIKE 'progression-session-%';
    DELETE FROM public.training_session_prescriptions
      WHERE session_id LIKE 'progression-session-%';
    DELETE FROM public.training_sessions
      WHERE assignment_id = 'progression-assignment-1';
    DELETE FROM public.training_program_revisions
      WHERE assignment_id = 'progression-assignment-1';
    DELETE FROM public.training_program_assignments
      WHERE id = 'progression-assignment-1';
    DELETE FROM public.training_program_drafts
      WHERE id = '49000000-0000-4000-8000-000000000004';
    DELETE FROM public.coaching_relationships
      WHERE subject_id = '49000000-0000-4000-8000-000000000002';
    DELETE FROM private.training_simulation_identities
      WHERE subject_id = '49000000-0000-4000-8000-000000000002';
    DELETE FROM private.athlete_invitations
      WHERE subject_id = '49000000-0000-4000-8000-000000000002';
    DELETE FROM public.training_simulation_runs
      WHERE subject_id = '49000000-0000-4000-8000-000000000002';
    DELETE FROM public.training_profile_revisions
      WHERE subject_id = '49000000-0000-4000-8000-000000000002';
    DELETE FROM public.training_subjects
      WHERE id = '49000000-0000-4000-8000-000000000002';
    DELETE FROM public.clients
      WHERE id = '49000000-0000-4000-8000-000000000010';
    DELETE FROM public.practitioners
      WHERE id = '${coachId}';
    DELETE FROM auth.users
      WHERE id IN ('${coachId}', '49000000-0000-4000-8000-000000000009');
    COMMIT;
  `)
}

async function waitUntilBlocked(observer, blockedPid, blockerPid) {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    const { rows } = await observer.query(`
      SELECT wait_event_type, pg_catalog.pg_blocking_pids(pid) AS blockers
      FROM pg_catalog.pg_stat_activity
      WHERE pid = $1
    `, [blockedPid])
    const row = rows[0]
    if (row?.wait_event_type === 'Lock' && row.blockers.includes(blockerPid)) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('competing mutation did not block on the writer-held session row')
}

async function verifyRejectedConflict(acceptancePromise, expectedMessage) {
  try {
    await acceptancePromise
  } catch (error) {
    assert(error?.code === 'PT409', `expected PT409, received ${error?.code ?? 'no SQLSTATE'}`)
    assert(error?.message === expectedMessage, `expected ${expectedMessage}, received ${error?.message}`)
    return
  }
  throw new Error('stale mutation unexpectedly succeeded')
}

async function runRace(kind) {
  const admin = await connection()
  const writer = await connection()
  const accepter = await connection()
  try {
    await cleanupFixture(admin)
    await installFixture(admin)
    await asActor(writer)
    await asActor(accepter)
    const writerPid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    const accepterPid = (await accepter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    const sessionId = kind === 'target_start' ? 'progression-session-2' : 'progression-session-1'
    // The fixture owns this connection; authenticated callers intentionally lack
    // direct table UPDATE rights. Hold the test lock as admin, then exercise the
    // actual mutation only through the authenticated security-definer RPC.
    await writer.query('RESET ROLE')
    await writer.query('SELECT id FROM public.training_sessions WHERE id = $1 FOR UPDATE', [sessionId])
    await writer.query('SET LOCAL ROLE authenticated')

    const acceptance = accepter.query(
      'SELECT public.accept_training_progression_proposal($1,$2)',
      [proposalId, kind === 'target_start'
        ? '51000000-0000-4000-8000-000000000010'
        : '51000000-0000-4000-8000-000000000011'],
    )
    await waitUntilBlocked(admin, accepterPid, writerPid)

    if (kind === 'target_start') {
      await writer.query("SELECT public.start_training_session('progression-session-2', 1)")
    } else {
      await writer.query(`
        SELECT public.write_training_set_log(
          'progression-session-1',
          'progression-set-1-1',
          4,
          '51000000-0000-4000-8000-000000000012',
          '{
            "quantity":{"entered":{"value":"50","unit":"kg"},"canonicalKg":"50"},
            "reps":7,"rir":2,"side":"bilateral","symptomState":"none",
            "occurredAt":"2026-09-01T18:05:00Z"
          }'::jsonb
        )
      `)
    }
    await writer.query('COMMIT')
    await verifyRejectedConflict(
      acceptance,
      kind === 'target_start' ? 'progression target changed' : 'progression evidence changed',
    )
    await accepter.query('ROLLBACK')

    const { rows } = await admin.query(`
      SELECT
        assignment.active_revision,
        target.state AS target_state,
        target.revision AS target_revision,
        source.revision AS source_revision,
        (SELECT count(*) FROM public.training_progression_acceptances
          WHERE proposal_id = '${proposalId}')::integer AS acceptances
      FROM public.training_program_assignments assignment
      JOIN public.training_sessions target ON target.id = 'progression-session-2'
      JOIN public.training_sessions source ON source.id = 'progression-session-1'
      WHERE assignment.id = 'progression-assignment-1'
    `)
    const result = rows[0]
    assert(result.active_revision === '1', 'stale acceptance changed the active program revision')
    assert(result.acceptances === 0, 'stale acceptance appended an acceptance row')
    if (kind === 'target_start') {
      assert(result.target_state === 'in_progress' && result.target_revision === '2', 'target start did not commit')
    } else {
      assert(result.source_revision === '5', 'source correction did not advance its session revision')
    }
    process.stdout.write(`${JSON.stringify({ kind, status: 'passed' })}\n`)
  } finally {
    await writer.query('ROLLBACK').catch(() => {})
    await accepter.query('ROLLBACK').catch(() => {})
    await cleanupFixture(admin).catch(() => {})
    await Promise.all([writer.end(), accepter.end(), admin.end()])
  }
}

await runRace('target_start')
await runRace('source_correction')


async function runOwnerCoachRace(winningActor) {
  const admin = await connection()
  const writer = await connection()
  const contender = await connection()
  const ownerId = '49000000-0000-4000-8000-000000000009'
  const winnerId = winningActor === 'athlete' ? ownerId : coachId
  const loserId = winningActor === 'athlete' ? coachId : ownerId
  const requestId = '51000000-0000-4000-8000-000000000013'
  const actual = {
    quantity: { entered: { value: '50', unit: 'kg' }, canonicalKg: '50' },
    reps: 6, rir: 2, side: 'bilateral', symptomState: 'none',
    occurredAt: '2026-09-01T18:05:00Z',
  }
  const write = (client, revision, id, value) => client.query(
    'SELECT public.write_training_set_log($1,$2,$3,$4,$5::jsonb) AS receipt',
    ['progression-session-1', 'progression-set-1-1', revision, id, JSON.stringify(value)],
  )
  try {
    await cleanupFixture(admin)
    await installFixture(admin)
    await asActor(writer, winnerId)
    await asActor(contender, loserId)
    const writerPid = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    const contenderPid = (await contender.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    await writer.query('RESET ROLE')
    await writer.query("SELECT id FROM public.training_sessions WHERE id='progression-session-1' FOR UPDATE")
    await writer.query('SET LOCAL ROLE authenticated')
    const staleWrite = write(contender, 4, '51000000-0000-4000-8000-000000000014', { ...actual, reps: 7 })
    await waitUntilBlocked(admin, contenderPid, writerPid)
    const committed = (await write(writer, 4, requestId, actual)).rows[0].receipt
    await writer.query('COMMIT')
    await verifyRejectedConflict(staleWrite, 'training session changed concurrently')
    await contender.query('ROLLBACK')
    await asActor(writer, winnerId)
    const retry = (await write(writer, 4, requestId, actual)).rows[0].receipt
    assert(JSON.stringify(retry) === JSON.stringify(committed), 'lost-ack retry changed the original acknowledgement')
    await writer.query('COMMIT')
    await asActor(contender, loserId)
    const projection = (await contender.query("SELECT public.read_training_session_projection('progression-session-1') AS value")).rows[0].value
    assert(projection.session.revision === 5, 'other actor did not receive the current session revision')
    assert(projection.currentActuals[0].reps === 6, 'stale actor overwrote the winning actual')
    assert(projection.currentActuals[0].actor.userId === winnerId, 'winning actor provenance was lost')
    await write(contender, 5, '51000000-0000-4000-8000-000000000015', { ...actual, reps: 7 })
    await contender.query('COMMIT')
    const events = (await admin.query("SELECT actor_user_id,event_revision FROM public.training_set_log_events WHERE session_id='progression-session-1' ORDER BY event_revision")).rows
    assert(events.length === 3, 'race or retry duplicated an event or erased prior history')
    assert(events[1].actor_user_id === winnerId && events[2].actor_user_id === loserId, 'explicit correction did not preserve both actors')
    process.stdout.write(`${JSON.stringify({ kind: 'athlete_coach_set_log', winningActor, status: 'passed' })}\n`)
  } finally {
    await writer.query('ROLLBACK').catch(() => {})
    await contender.query('ROLLBACK').catch(() => {})
    await cleanupFixture(admin).catch(() => {})
    await Promise.all([writer.end(), contender.end(), admin.end()])
  }
}

await runOwnerCoachRace('athlete')
await runOwnerCoachRace('coach')

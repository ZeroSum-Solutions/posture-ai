#!/usr/bin/env node

import process from 'node:process'
import pg from 'pg'

const { Client } = pg
const databaseUrl = process.env.SUPABASE_DB_URL
if (!databaseUrl) throw new Error('Set SUPABASE_DB_URL to the isolated local test database')
const destination = new URL(databaseUrl)
if (!['127.0.0.1', 'localhost'].includes(destination.hostname)
  || destination.port !== '55422') {
  throw new Error('Relationship race fixtures require the isolated local Supabase database on port 55422')
}

const ownerId = '93100000-0000-4000-8000-000000000001'
const coachId = '93100000-0000-4000-8000-000000000002'
const subjectId = '93100000-0000-4000-8000-000000000003'
const clientId = '93100000-0000-4000-8000-000000000004'
const relationshipId = '93100000-0000-4000-8000-000000000005'
const draftId = '93100000-0000-4000-8000-000000000006'
const requestId = '93100000-0000-4000-8000-000000000007'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function connection() {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  return client
}

async function asCoach(client) {
  await client.query('BEGIN')
  await client.query("SET LOCAL statement_timeout = '10s'")
  await client.query("SET LOCAL lock_timeout = '5s'")
  await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [coachId])
  await client.query("SELECT set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: coachId, aal: 'aal2', iat: 2_000_000_000 }),
  ])
  await client.query('SET LOCAL ROLE authenticated')
}

async function cleanup(admin) {
  await admin.query(`
    BEGIN;
    SET LOCAL session_replication_role = replica;
    DELETE FROM private.training_coaching_relationship_revocation_receipts
      WHERE relationship_id = '${relationshipId}';
    DELETE FROM public.training_program_revisions
      WHERE assignment_id = 'relationship-race-assignment';
    DELETE FROM public.training_program_assignments
      WHERE id = 'relationship-race-assignment';
    DELETE FROM public.training_program_drafts WHERE id = '${draftId}';
    DELETE FROM public.coaching_relationships WHERE id = '${relationshipId}';
    DELETE FROM public.client_accounts WHERE subject_id = '${subjectId}';
    DELETE FROM public.clients WHERE id = '${clientId}';
    DELETE FROM public.training_subjects WHERE id = '${subjectId}';
    DELETE FROM public.practitioners WHERE id = '${coachId}';
    DELETE FROM auth.users WHERE id IN ('${ownerId}','${coachId}');
    COMMIT;
  `)
}

async function install(admin) {
  await cleanup(admin)
  await admin.query(`
    BEGIN;
    SET CONSTRAINTS ALL DEFERRED;
    SET LOCAL session_replication_role = replica;
    INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
      ('${ownerId}','relationship-race-owner@example.invalid',now(),now()),
      ('${coachId}','relationship-race-coach@example.invalid',now(),now());
    INSERT INTO public.practitioners(id,display_name,access_status,role,session_valid_after)
      VALUES('${coachId}','Relationship race coach','active','practitioner','-infinity');
    INSERT INTO public.training_subjects(id,owner_user_id,status,activated_at)
      VALUES('${subjectId}','${ownerId}','active',now());
    INSERT INTO public.clients(id,practitioner_id,first_name,last_name)
      VALUES('${clientId}','${coachId}','Relationship','Race');
    INSERT INTO public.client_accounts(subject_id,client_id,status)
      VALUES('${subjectId}','${clientId}','active');
    INSERT INTO public.coaching_relationships(
      id,subject_id,practitioner_id,status,permissions,revision
    ) VALUES(
      '${relationshipId}','${subjectId}','${coachId}','active',
      ARRAY['program:coach_publish','relationship:revoke']::public.training_coach_permission[],1
    );
    INSERT INTO public.training_program_drafts(
      id,subject_id,created_by_user_id,profile_revision,program_json,expires_at
    ) VALUES(
      '${draftId}','${subjectId}','${coachId}',0,
      '{
        "schemaVersion":"training-program-revision.v1",
        "subjectId":"${subjectId}",
        "revisionNumber":1,
        "profileRevisionId":"0",
        "cycleLengthWeeks":12,
        "compilerPolicyVersion":"strength-cycle-compiler.v3",
        "sessions":[{}],
        "executionContext":{"kind":"live"}
      }'::jsonb,
      now()+interval '1 hour'
    );
    COMMIT;
  `)
}

async function waitUntilBlocked(observer, blockedPid, blockerPid) {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    const { rows } = await observer.query(`
      SELECT wait_event_type,pg_catalog.pg_blocking_pids(pid) AS blockers
      FROM pg_catalog.pg_stat_activity WHERE pid=$1
    `, [blockedPid])
    if (rows[0]?.wait_event_type === 'Lock' && rows[0].blockers.includes(blockerPid)) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('competing relationship operation did not block on the transaction lock')
}

async function exactRetryRace(admin) {
  await install(admin)
  const first = await connection()
  const retry = await connection()
  try {
    await asCoach(first)
    await asCoach(retry)
    const firstPid = (await first.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    const retryPid = (await retry.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    const firstReceipt = (await first.query(
      'SELECT public.revoke_training_coaching_relationship_transactional($1,$2,$3) AS receipt',
      [requestId, relationshipId, 1],
    )).rows[0].receipt
    const retryPromise = retry.query(
      'SELECT public.revoke_training_coaching_relationship_transactional($1,$2,$3) AS receipt',
      [requestId, relationshipId, 1],
    )
    await waitUntilBlocked(admin, retryPid, firstPid)
    await first.query('COMMIT')
    const retryReceipt = (await retryPromise).rows[0].receipt
    await retry.query('COMMIT')
    assert(JSON.stringify(retryReceipt) === JSON.stringify(firstReceipt), 'concurrent exact retry changed the committed receipt')
    const count = (await admin.query(
      'SELECT count(*)::integer AS count FROM private.training_coaching_relationship_revocation_receipts WHERE relationship_id=$1',
      [relationshipId],
    )).rows[0].count
    assert(count === 1, 'concurrent exact retry duplicated the receipt')
    process.stdout.write(`${JSON.stringify({ kind: 'exact_receipt_retry', status: 'passed' })}\n`)
  } finally {
    await first.query('ROLLBACK').catch(() => {})
    await retry.query('ROLLBACK').catch(() => {})
    await Promise.all([first.end(), retry.end()])
  }
}

async function assignmentPublicationRace(admin) {
  await install(admin)
  const revoker = await connection()
  const publisher = await connection()
  try {
    await asCoach(revoker)
    await publisher.query('BEGIN')
    await publisher.query("SET LOCAL statement_timeout = '10s'")
    await publisher.query("SET LOCAL lock_timeout = '5s'")
    const revokerPid = (await revoker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    const publisherPid = (await publisher.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    await revoker.query(
      'SELECT public.revoke_training_coaching_relationship_transactional($1,$2,$3)',
      [requestId, relationshipId, 1],
    )
    const publication = publisher.query(`
      INSERT INTO public.training_program_assignments(
        id,subject_id,program_mode,owning_practitioner_id,source_draft_id,
        status,active_revision,revision
      ) VALUES(
        'relationship-race-assignment',$1,'coach_assigned',$2,$3,'active',1,1
      )
    `, [subjectId, coachId, draftId])
    await waitUntilBlocked(admin, publisherPid, revokerPid)
    await revoker.query('COMMIT')
    try {
      await publication
      throw new Error('coach assignment publication unexpectedly crossed committed revocation')
    } catch (error) {
      assert(error?.code === 'P0001', `expected P0001 after revocation, received ${error?.code ?? 'no SQLSTATE'}`)
      assert(error?.message === 'training relationship revoked', `unexpected publication rejection: ${error?.message}`)
    }
    await publisher.query('ROLLBACK')
    const count = (await admin.query(
      "SELECT count(*)::integer AS count FROM public.training_program_assignments WHERE id='relationship-race-assignment'",
    )).rows[0].count
    assert(count === 0, 'a coach assignment appeared after revocation')
    process.stdout.write(`${JSON.stringify({ kind: 'assignment_publication', status: 'passed' })}\n`)
  } finally {
    await revoker.query('ROLLBACK').catch(() => {})
    await publisher.query('ROLLBACK').catch(() => {})
    await Promise.all([revoker.end(), publisher.end()])
  }
}

const admin = await connection()
try {
  await exactRetryRace(admin)
  await assignmentPublicationRace(admin)
} finally {
  await cleanup(admin).catch(() => {})
  await admin.end()
}

BEGIN;

SELECT plan(18);

SELECT is(
  private.is_training_session_stale(
    '2026-09-07T12:00:00Z'::timestamptz,
    '2026-09-08T12:00:00Z'::timestamptz
  ),
  false,
  'exactly 24 elapsed hours is not stale'
);
SELECT is(
  private.is_training_session_stale(
    '2026-09-07T11:59:59.999Z'::timestamptz,
    '2026-09-08T12:00:00Z'::timestamptz
  ),
  true,
  'strictly more than 24 elapsed hours is stale'
);
SELECT is(
  private.is_training_session_stale(
    '2026-09-08T12:00:00.001Z'::timestamptz,
    '2026-09-08T12:00:00Z'::timestamptz
  ),
  false,
  'a future start is not silently treated as stale'
);

SET CONSTRAINTS ALL DEFERRED;
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('58000000-0000-4000-8000-000000000001','lifecycle-owner@example.invalid',now(),now()),
  ('58000000-0000-4000-8000-000000000002','lifecycle-coach@example.invalid',now(),now());
INSERT INTO public.practitioners(id,display_name)
VALUES ('58000000-0000-4000-8000-000000000002','Lifecycle coach');
INSERT INTO public.training_subjects(id,owner_user_id,status,activated_at)
VALUES (
  '58000000-0000-4000-8000-000000000003',
  '58000000-0000-4000-8000-000000000001',
  'active',now()
);
INSERT INTO public.clients(id,practitioner_id,first_name,last_name)
VALUES (
  '58000000-0000-4000-8000-000000000020',
  '58000000-0000-4000-8000-000000000002',
  'Lifecycle','Athlete'
);
INSERT INTO public.client_accounts(subject_id,client_id,status)
VALUES (
  '58000000-0000-4000-8000-000000000003',
  '58000000-0000-4000-8000-000000000020',
  'active'
);
INSERT INTO public.coaching_relationships(
  id,subject_id,practitioner_id,status,permissions,revision
) VALUES (
  '58000000-0000-4000-8000-000000000004',
  '58000000-0000-4000-8000-000000000003',
  '58000000-0000-4000-8000-000000000002',
  'active',
  ARRAY['program:coach_publish','session:read','set_log:write','session:complete','relationship:revoke']::public.training_coach_permission[],
  1
);

INSERT INTO public.training_program_drafts(
  id,subject_id,created_by_user_id,profile_revision,program_json,expires_at
)
SELECT
  fixture.id,
  '58000000-0000-4000-8000-000000000003',
  fixture.author_id,
  1,
  pg_catalog.jsonb_build_object(
    'schemaVersion','training-program-revision.v1',
    'assignmentId',fixture.assignment_id,
    'revisionNumber',1,
    'subjectId','58000000-0000-4000-8000-000000000003',
    'cycleLengthWeeks',8,
    'profileRevisionId','1',
    'compilerPolicyVersion','eight-week-compiler.v1',
    'executionContext',pg_catalog.jsonb_build_object('kind','live'),
    'sessions',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('sessionId',fixture.session_id))
  ),
  now() + interval '1 hour'
FROM (VALUES
  ('58000000-0000-4000-8000-000000000010'::uuid,'coach-assignment'::text,'coach-session'::text,'58000000-0000-4000-8000-000000000002'::uuid),
  ('58000000-0000-4000-8000-000000000011'::uuid,'self-assignment'::text,'stale-session'::text,'58000000-0000-4000-8000-000000000001'::uuid),
  ('58000000-0000-4000-8000-000000000012'::uuid,'expired-assignment'::text,'expired-session'::text,'58000000-0000-4000-8000-000000000001'::uuid),
  ('58000000-0000-4000-8000-000000000013'::uuid,'blocked-coach-assignment'::text,'blocked-coach-session'::text,'58000000-0000-4000-8000-000000000002'::uuid)
) AS fixture(id,assignment_id,session_id,author_id);

INSERT INTO public.training_program_assignments(
  id,subject_id,program_mode,owning_practitioner_id,source_draft_id,status,active_revision,revision
) VALUES
  ('coach-assignment','58000000-0000-4000-8000-000000000003','coach_assigned','58000000-0000-4000-8000-000000000002','58000000-0000-4000-8000-000000000010','active',1,1),
  ('self-assignment','58000000-0000-4000-8000-000000000003','self_directed',NULL,'58000000-0000-4000-8000-000000000011','active',1,1),
  ('expired-assignment','58000000-0000-4000-8000-000000000003','self_directed',NULL,'58000000-0000-4000-8000-000000000012','ended',1,1);

INSERT INTO public.training_program_revisions(
  assignment_id,subject_id,revision_number,program_json,created_by_user_id
)
SELECT
  fixture.assignment_id,
  '58000000-0000-4000-8000-000000000003',
  1,
  pg_catalog.jsonb_build_object(
    'assignmentId',fixture.assignment_id,
    'subjectId','58000000-0000-4000-8000-000000000003',
    'revisionNumber',1,
    'cycleLengthWeeks',8,
    'compilerPolicyVersion','eight-week-compiler.v1'
  ),
  fixture.author_id
FROM (VALUES
  ('coach-assignment'::text,'58000000-0000-4000-8000-000000000002'::uuid),
  ('self-assignment'::text,'58000000-0000-4000-8000-000000000001'::uuid),
  ('expired-assignment'::text,'58000000-0000-4000-8000-000000000001'::uuid)
) AS fixture(assignment_id,author_id);

INSERT INTO public.training_sessions(
  id,assignment_id,subject_id,state,scheduled_local_date,athlete_timezone,revision
) VALUES
  ('coach-session','coach-assignment','58000000-0000-4000-8000-000000000003','in_progress','2026-09-07','UTC',2),
  ('coach-next-session','coach-assignment','58000000-0000-4000-8000-000000000003','scheduled','2026-09-09','UTC',1),
  ('stale-session','self-assignment','58000000-0000-4000-8000-000000000003','in_progress','2026-09-07','UTC',2),
  ('next-session','self-assignment','58000000-0000-4000-8000-000000000003','scheduled','2026-09-09','UTC',1),
  ('expired-session','expired-assignment','58000000-0000-4000-8000-000000000003','scheduled','2026-09-07','UTC',1);

INSERT INTO public.training_session_prescriptions(
  session_id,subject_id,assignment_id,program_revision_number,prescription_json,started_by_user_id,started_at
) VALUES
  ('coach-session','58000000-0000-4000-8000-000000000003','coach-assignment',1,
    '{"sessionId":"coach-session","subjectId":"58000000-0000-4000-8000-000000000003","assignmentId":"coach-assignment"}',
    '58000000-0000-4000-8000-000000000001',now()-interval '1 hour'),
  ('stale-session','58000000-0000-4000-8000-000000000003','self-assignment',1,
    '{"sessionId":"stale-session","subjectId":"58000000-0000-4000-8000-000000000003","assignmentId":"self-assignment"}',
    '58000000-0000-4000-8000-000000000001',now()-interval '25 hours');

SET LOCAL session_replication_role = origin;

SELECT throws_ok(
  $$ UPDATE public.training_sessions SET state='completed' WHERE id='stale-session' $$,
  'P0001','training session is stale',
  'a stale unfinished session cannot become a qualifying completion'
);
SELECT lives_ok(
  $$ UPDATE public.training_sessions SET state='aborted' WHERE id='stale-session' $$,
  'a stale session can be explicitly stopped'
);
SELECT results_eq(
  $$ SELECT state FROM public.training_sessions WHERE id IN ('stale-session','next-session') ORDER BY id $$,
  $$ VALUES ('scheduled'::text),('aborted'::text) $$,
  'stopping stale history leaves the next scheduled session reachable'
);

SELECT lives_ok(
  $$ UPDATE public.coaching_relationships
     SET status='revoked',ended_at=now(),revision=revision+1
     WHERE id='58000000-0000-4000-8000-000000000004' $$,
  'relationship revocation atomically ends its assignments'
);
SELECT results_eq(
  $$ SELECT status,revision FROM public.training_program_assignments WHERE id='coach-assignment' $$,
  $$ VALUES ('ended'::text,2::bigint) $$,
  'the coach assignment is ended without changing its immutable mode'
);
SELECT results_eq(
  $$ SELECT count(*) FROM public.training_program_revisions WHERE assignment_id='coach-assignment' $$,
  $$ VALUES (1::bigint) $$,
  'revocation preserves published history'
);

SELECT set_config('request.jwt.claim.sub','58000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"58000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.read_training_session_lifecycle_denial('coach-session'),
  'relationship_revoked',
  'the athlete receives the relationship-revoked lifecycle outcome'
);
SELECT is(
  public.read_training_session_lifecycle_denial('expired-session'),
  'assignment_expired',
  'an independently ended assignment receives the expired lifecycle outcome'
);
SELECT throws_ok(
  $$ SELECT public.start_training_session('coach-next-session',1) $$,
  'P0001','training session cannot be started',
  'an ended coach assignment cannot freeze a new prescription'
);
RESET ROLE;

SELECT throws_ok(
  $$ INSERT INTO public.training_program_assignments(
       id,subject_id,program_mode,owning_practitioner_id,source_draft_id,status,active_revision,revision
     ) VALUES (
       'blocked-coach-assignment','58000000-0000-4000-8000-000000000003','coach_assigned',
       '58000000-0000-4000-8000-000000000002','58000000-0000-4000-8000-000000000013','active',1,1
     ) $$,
  'P0001','training relationship revoked',
  'a revoked relationship cannot publish a new active coach assignment'
);

INSERT INTO public.coaching_relationships(
  id,subject_id,practitioner_id,status,permissions,revision
) VALUES (
  '58000000-0000-4000-8000-000000000021',
  '58000000-0000-4000-8000-000000000003',
  '58000000-0000-4000-8000-000000000002',
  'active',
  ARRAY['program:coach_publish','session:read']::public.training_coach_permission[],
  1
);
INSERT INTO public.training_program_assignments(
  id,subject_id,program_mode,owning_practitioner_id,source_draft_id,status,active_revision,revision
) VALUES (
  'blocked-coach-assignment','58000000-0000-4000-8000-000000000003','coach_assigned',
  '58000000-0000-4000-8000-000000000002','58000000-0000-4000-8000-000000000013','active',1,1
);
INSERT INTO public.training_program_revisions(
  assignment_id,subject_id,revision_number,program_json,created_by_user_id
) VALUES (
  'blocked-coach-assignment','58000000-0000-4000-8000-000000000003',1,
  '{
    "assignmentId":"blocked-coach-assignment",
    "subjectId":"58000000-0000-4000-8000-000000000003",
    "revisionNumber":1,
    "cycleLengthWeeks":8,
    "compilerPolicyVersion":"eight-week-compiler.v1"
  }',
  '58000000-0000-4000-8000-000000000002'
);
SELECT lives_ok(
  $$ UPDATE public.clients
     SET first_name='REDACTED',last_name='REDACTED',deleted_at=now(),
         deletion_reason_code='subject_request'
     WHERE id='58000000-0000-4000-8000-000000000020' $$,
  'linked-client erasure revokes its coaching authority'
);
SELECT results_eq(
  $$ SELECT relationship.status::text,assignment.status
     FROM public.coaching_relationships relationship
     JOIN public.training_program_assignments assignment
       ON assignment.subject_id=relationship.subject_id
      AND assignment.owning_practitioner_id=relationship.practitioner_id
     WHERE relationship.id='58000000-0000-4000-8000-000000000021'
       AND assignment.id='blocked-coach-assignment' $$,
  $$ VALUES ('revoked'::text,'ended'::text) $$,
  'linked-client erasure preserves history while ending the linked coach assignment'
);

SELECT ok(
  pg_catalog.pg_get_functiondef(
    'public.accept_training_progression_proposal(uuid,uuid)'::regprocedure
  ) LIKE '%v_assignment.status <> ''active''%',
  'pending progression acceptance remains blocked after revocation ends the assignment'
);

WITH definition AS (
  SELECT pg_catalog.pg_get_functiondef(
    'private.end_training_assignments_after_coach_revocation()'::regprocedure
  ) AS body
)
SELECT ok(
  pg_catalog.strpos(body, 'ORDER BY session.id') > 0
    AND pg_catalog.strpos(body, 'ORDER BY session.id')
      < pg_catalog.strpos(body, 'UPDATE public.training_program_assignments'),
  'revocation locks sessions in deterministic order before assignments'
)
FROM definition;

SELECT ok(
  pg_catalog.pg_get_functiondef(
    'private.require_active_coaching_relationship_for_assignment()'::regprocedure
  ) LIKE '%FOR KEY SHARE%',
  'new coach publication serializes against relationship revocation'
);

SELECT * FROM finish();
ROLLBACK;

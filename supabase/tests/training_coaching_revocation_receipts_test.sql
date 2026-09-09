BEGIN;

SELECT plan(24);

SELECT has_table(
  'private','training_coaching_relationship_revocation_receipts',
  'relationship revocation receipts are private and durable'
);
SELECT has_function(
  'public','revoke_training_coaching_relationship_transactional',
  ARRAY['uuid','uuid','bigint'],
  'request-bound relationship revocation RPC exists'
);
SELECT ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.revoke_training_coaching_relationship_transactional(uuid,uuid,bigint)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'anon',
    'public.revoke_training_coaching_relationship_transactional(uuid,uuid,bigint)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.revoke_training_coaching_relationship_transactional(uuid,uuid,bigint)',
    'EXECUTE'
  ),
  'only authenticated actors can invoke the guarded receipt writer'
);
SELECT ok(
  NOT pg_catalog.has_table_privilege(
    'authenticated','private.training_coaching_relationship_revocation_receipts','SELECT'
  )
  AND NOT pg_catalog.has_table_privilege(
    'service_role','private.training_coaching_relationship_revocation_receipts','SELECT'
  ),
  'application roles cannot read private revocation receipts directly'
);
SELECT ok(
  private.is_valid_training_session_id_array(
    ARRAY(
      SELECT pg_catalog.format('supported-session-%s', sequence)
      FROM pg_catalog.generate_series(1, 130) AS sequence
    )
  ),
  'a complete supported scope larger than 128 sessions is valid'
);
SELECT ok(
  NOT private.is_valid_training_session_id_array(ARRAY['duplicate','duplicate'])
  AND NOT private.is_valid_training_session_id_array(ARRAY['valid',NULL]::text[]),
  'duplicate or null session identifiers fail closed'
);

SET CONSTRAINTS ALL DEFERRED;
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('93000000-0000-4000-8000-000000000001','receipt-owner@example.invalid',now(),now()),
  ('93000000-0000-4000-8000-000000000002','receipt-coach@example.invalid',now(),now()),
  ('93000000-0000-4000-8000-000000000003','receipt-other-coach@example.invalid',now(),now()),
  ('93000000-0000-4000-8000-000000000004','erase-owner@example.invalid',now(),now());

INSERT INTO public.practitioners(id,display_name,access_status,role,session_valid_after) VALUES
  ('93000000-0000-4000-8000-000000000002','Receipt coach','active','practitioner','-infinity'),
  ('93000000-0000-4000-8000-000000000003','Other receipt coach','active','practitioner','-infinity');

INSERT INTO public.training_subjects(id,owner_user_id,status,activated_at) VALUES
  ('93000000-0000-4000-8000-000000000010','93000000-0000-4000-8000-000000000001','active',now()),
  ('93000000-0000-4000-8000-000000000011','93000000-0000-4000-8000-000000000004','active',now());

INSERT INTO public.clients(id,practitioner_id,first_name,last_name) VALUES
  ('93000000-0000-4000-8000-000000000020','93000000-0000-4000-8000-000000000002','Receipt','Athlete');
INSERT INTO public.client_accounts(subject_id,client_id,status) VALUES
  ('93000000-0000-4000-8000-000000000010','93000000-0000-4000-8000-000000000020','active');

INSERT INTO public.coaching_relationships(
  id,subject_id,practitioner_id,status,permissions,revision
) VALUES
  (
    '93000000-0000-4000-8000-000000000030',
    '93000000-0000-4000-8000-000000000010',
    '93000000-0000-4000-8000-000000000002','active',
    ARRAY['program:coach_publish','relationship:revoke']::public.training_coach_permission[],1
  ),
  (
    '93000000-0000-4000-8000-000000000031',
    '93000000-0000-4000-8000-000000000011',
    '93000000-0000-4000-8000-000000000002','active',
    ARRAY['relationship:revoke']::public.training_coach_permission[],1
  );

INSERT INTO public.training_program_drafts(
  id,subject_id,created_by_user_id,profile_revision,program_json,expires_at
)
SELECT
  fixture.draft_id,'93000000-0000-4000-8000-000000000010',
  '93000000-0000-4000-8000-000000000002',0,
  pg_catalog.jsonb_build_object(
    'schemaVersion','training-program-revision.v1',
    'subjectId','93000000-0000-4000-8000-000000000010',
    'revisionNumber',1,'profileRevisionId','0','cycleLengthWeeks',12,
    'compilerPolicyVersion','strength-cycle-compiler.v3',
    'sessions',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object()),
    'executionContext',pg_catalog.jsonb_build_object('kind','live')
  ),
  now()+interval '1 hour'
FROM (VALUES
  ('93000000-0000-4000-8000-000000000040'::uuid),
  ('93000000-0000-4000-8000-000000000041'::uuid)
) AS fixture(draft_id);

INSERT INTO public.training_program_assignments(
  id,subject_id,program_mode,owning_practitioner_id,source_draft_id,
  status,active_revision,revision
) VALUES
  (
    'receipt-coach-assignment-a','93000000-0000-4000-8000-000000000010',
    'coach_assigned','93000000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000040','active',1,1
  ),
  (
    'receipt-coach-assignment-b','93000000-0000-4000-8000-000000000010',
    'coach_assigned','93000000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000041','active',1,1
  );

INSERT INTO public.training_program_revisions(
  assignment_id,subject_id,revision_number,program_json,created_by_user_id
)
SELECT
  assignment.id,'93000000-0000-4000-8000-000000000010',1,
  pg_catalog.jsonb_build_object(
    'assignmentId',assignment.id,
    'subjectId','93000000-0000-4000-8000-000000000010',
    'revisionNumber',1,'cycleLengthWeeks',12,
    'compilerPolicyVersion','strength-cycle-compiler.v3'
  ),
  '93000000-0000-4000-8000-000000000002'
FROM (VALUES
  ('receipt-coach-assignment-a'::text),
  ('receipt-coach-assignment-b'::text)
) AS assignment(id);

INSERT INTO public.training_sessions(
  id,assignment_id,subject_id,session_kind,state,
  scheduled_local_date,athlete_timezone,revision
)
SELECT
  pg_catalog.format('receipt-scope-%s',pg_catalog.lpad(sequence::text,3,'0')),
  CASE WHEN sequence <= 65 THEN 'receipt-coach-assignment-a'
       ELSE 'receipt-coach-assignment-b' END,
  '93000000-0000-4000-8000-000000000010',
  CASE WHEN sequence % 3 = 0 THEN 'conditioning' ELSE 'strength' END,
  'scheduled','2030-01-01'::date + (sequence - 1),'UTC',1
FROM pg_catalog.generate_series(1,130) AS sequence;

SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000002',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-4000-8000-000000000002","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  public.revoke_training_coaching_relationship_transactional(
    '93000000-0000-4000-8000-000000000050',
    '93000000-0000-4000-8000-000000000030',1
  )->>'status',
  'revoked',
  'the coach can revoke through the request-bound writer'
);
SELECT is(
  pg_catalog.jsonb_array_length(
    public.revoke_training_coaching_relationship_transactional(
      '93000000-0000-4000-8000-000000000050',
      '93000000-0000-4000-8000-000000000030',1
    )->'affectedSessionIds'
  ),
  130,
  'exact retry recovers every affected session beyond the former 128 cap'
);
SELECT is(
  public.revoke_training_coaching_relationship_transactional(
    '93000000-0000-4000-8000-000000000050',
    '93000000-0000-4000-8000-000000000030',1
  )->>'revision',
  '2',
  'a lost response retry returns the original committed revision'
);
SELECT throws_ok(
  $$ SELECT public.revoke_training_coaching_relationship_transactional(
    '93000000-0000-4000-8000-000000000051',
    '93000000-0000-4000-8000-000000000030',1
  ) $$,
  'PT409','training relationship revocation request conflict',
  'a different request cannot replace an existing relationship receipt'
);
RESET ROLE;

SELECT results_eq(
  $$ SELECT status,revision FROM public.training_program_assignments
     WHERE id LIKE 'receipt-coach-assignment-%' ORDER BY id $$,
  $$ VALUES ('ended'::text,2::bigint),('ended'::text,2::bigint) $$,
  'the same transaction ends every affected coach assignment'
);
SELECT is(
  (SELECT pg_catalog.cardinality(affected_session_ids)
   FROM private.training_coaching_relationship_revocation_receipts
   WHERE request_id='93000000-0000-4000-8000-000000000050'),
  130,
  'the durable receipt stores the complete cleanup scope without truncation'
);
SELECT is(
  (SELECT affected_session_ids[1] || ':' || affected_session_ids[130]
   FROM private.training_coaching_relationship_revocation_receipts
   WHERE request_id='93000000-0000-4000-8000-000000000050'),
  'receipt-scope-001:receipt-scope-130',
  'the transaction records a stable sorted cleanup scope'
);

SELECT set_config('request.jwt.claims','{"sub":"93000000-0000-4000-8000-000000000002","aal":"aal1","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.revoke_training_coaching_relationship_transactional(
    '93000000-0000-4000-8000-000000000050',
    '93000000-0000-4000-8000-000000000030',1
  ) $$,
  '42501','current AAL2 user is required',
  'receipt replay rechecks current AAL2'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"93000000-0000-4000-8000-000000000003","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.revoke_training_coaching_relationship_transactional(
    '93000000-0000-4000-8000-000000000050',
    '93000000-0000-4000-8000-000000000030',1
  ) $$,
  '42501','relationship revocation is not authorized',
  'another current practitioner cannot replay the original coach receipt'
);
RESET ROLE;

UPDATE public.practitioners
SET access_status='suspended'
WHERE id='93000000-0000-4000-8000-000000000002';
SELECT set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"93000000-0000-4000-8000-000000000002","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.revoke_training_coaching_relationship_transactional(
    '93000000-0000-4000-8000-000000000050',
    '93000000-0000-4000-8000-000000000030',1
  ) $$,
  '42501','relationship revocation is not authorized',
  'a suspended practitioner cannot recover a receipt'
);
RESET ROLE;
UPDATE public.practitioners SET access_status='active'
WHERE id='93000000-0000-4000-8000-000000000002';

UPDATE public.clients
SET first_name='REDACTED',last_name='REDACTED',deleted_at=now(),
    deletion_reason_code='subject_request'
WHERE id='93000000-0000-4000-8000-000000000020';
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.revoke_training_coaching_relationship_transactional(
    '93000000-0000-4000-8000-000000000050',
    '93000000-0000-4000-8000-000000000030',1
  ) $$,
  '42501','relationship revocation is not authorized',
  'linked-client erasure does not preserve coach receipt access'
);
RESET ROLE;

UPDATE public.training_subjects
SET status='revoked',revoked_at=now(),deleted_at=now()
WHERE id='93000000-0000-4000-8000-000000000010';
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.revoke_training_coaching_relationship_transactional(
    '93000000-0000-4000-8000-000000000050',
    '93000000-0000-4000-8000-000000000030',1
  ) $$,
  '42501','relationship revocation is not authorized',
  'a revoked subject cannot leave a coach receipt replay corridor'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000004',true);
SELECT set_config('request.jwt.claims','{"sub":"93000000-0000-4000-8000-000000000004","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.revoke_training_coaching_relationship_transactional(
    '93000000-0000-4000-8000-000000000052',
    '93000000-0000-4000-8000-000000000031',1
  )->>'status',
  'revoked',
  'the subject owner can create the same bound receipt'
);
SELECT is(
  public.erase_training_subject_transactional(
    '93000000-0000-4000-8000-000000000053'
  )->>'status',
  'erased',
  'subject erasure removes its training identity'
);
SELECT throws_ok(
  $$ SELECT public.revoke_training_coaching_relationship_transactional(
    '93000000-0000-4000-8000-000000000052',
    '93000000-0000-4000-8000-000000000031',1
  ) $$,
  'P0001','coaching relationship is unavailable',
  'subject erasure prevents receipt replay and cannot resurrect cleanup scope'
);
RESET ROLE;

SELECT is_empty(
  $$ SELECT 1 FROM private.training_coaching_relationship_revocation_receipts
     WHERE subject_id='93000000-0000-4000-8000-000000000011' $$,
  'subject erasure cascades its private relationship receipt'
);
SELECT is(
  (SELECT count(*) FROM private.training_coaching_relationship_revocation_receipts
   WHERE relationship_id='93000000-0000-4000-8000-000000000030'),
  1::bigint,
  'exact retries never duplicate durable receipt evidence'
);
SELECT ok(
  pg_catalog.to_regprocedure(
    'public.revoke_training_coaching_relationship(uuid,bigint)'
  ) IS NOT NULL,
  'the legacy relationship revocation RPC remains available'
);

SELECT * FROM finish();
ROLLBACK;

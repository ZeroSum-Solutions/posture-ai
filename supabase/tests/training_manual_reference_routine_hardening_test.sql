BEGIN;
SELECT no_plan();

SELECT ok(
  (SELECT pg_catalog.bool_and(private.is_valid_manual_reference_exercise_display(display_json))
   FROM public.training_reference_library_records),
  'all 280 pinned reference displays satisfy the durable projection contract'
);

SELECT throws_ok($sql$
  INSERT INTO public.training_reference_library_records(
    reference_id,snapshot_id,source_record_id,source_record_updated_at,record_sha256,display_json
  )
  SELECT
    'wger:55000000-0000-4000-8000-000000000999',snapshot_id,999999,
    source_record_updated_at,pg_catalog.repeat('f',64),
    pg_catalog.jsonb_set(display_json,'{source,unexpected}','true'::jsonb,true)
  FROM public.training_reference_library_records
  WHERE reference_id='wger:d561c00c-436d-47d9-b647-222e7b637abd'
$sql$,'23514',NULL,
  'malformed nested display provenance is rejected before any routine can pin it'
);

SELECT ok(
  NOT has_function_privilege('authenticated',
    'private.is_valid_manual_reference_exercise_display(jsonb)','EXECUTE')
  AND has_function_privilege('authenticated',
    'public.list_training_manual_reference_routines_page(uuid,integer,timestamptz,uuid)','EXECUTE'),
  'the validator stays private while authenticated callers use the authorized page RPC'
);

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at)
VALUES ('55000000-0000-4000-8000-000000000001','routine-page-owner@example.invalid',now(),now());
INSERT INTO public.training_subjects(id,owner_user_id,status,activated_at)
VALUES (
  '55000000-0000-4000-8000-000000000002',
  '55000000-0000-4000-8000-000000000001','active',now()
);
SET LOCAL session_replication_role = origin;

INSERT INTO public.training_manual_reference_routines(
  id,subject_id,created_by_user_id,create_request_id,create_request_hash,
  status,current_revision,title,created_at,updated_at,archived_at
)
SELECT
  ('55000000-0000-4000-8000-' || pg_catalog.lpad(value::text,12,'0'))::uuid,
  '55000000-0000-4000-8000-000000000002',
  '55000000-0000-4000-8000-000000000001',
  ('55000000-0000-4000-9000-' || pg_catalog.lpad(value::text,12,'0'))::uuid,
  pg_catalog.repeat('a',64),'active',1,'Routine ' || value,
  '2026-09-08T12:00:00Z'::timestamptz,'2026-09-08T12:00:00Z'::timestamptz,NULL
FROM pg_catalog.generate_series(1,102) value;

INSERT INTO public.training_manual_reference_routine_revisions(
  routine_id,revision,routine_json,authored_by_user_id,created_at
)
SELECT
  routine.id,1,
  pg_catalog.jsonb_build_object(
    'schemaVersion','manual-reference-routine.v1',
    'routineId',routine.id,
    'subjectId',routine.subject_id,
    'revision',1,
    'status','active',
    'title',routine.title,
    'source',pg_catalog.jsonb_build_object(
      'kind','manual_reference','reviewStatus','reference_unreviewed','screeningInfluence','none'
    ),
    'items',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object()),
    'createdBy',pg_catalog.jsonb_build_object(
      'kind','athlete','userId','55000000-0000-4000-8000-000000000001'
    ),
    'createdAt',routine.created_at,
    'updatedAt',routine.updated_at,
    'archivedAt',NULL
  ),
  '55000000-0000-4000-8000-000000000001',routine.created_at
FROM public.training_manual_reference_routines routine
WHERE routine.subject_id='55000000-0000-4000-8000-000000000002';

SET CONSTRAINTS training_manual_reference_routines_current_revision_fk IMMEDIATE;

SELECT set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims',
  '{"sub":"55000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE page_results(page_number integer PRIMARY KEY, document jsonb);
GRANT SELECT, INSERT ON pg_temp.page_results TO authenticated;

INSERT INTO pg_temp.page_results VALUES (
  1,
  public.list_training_manual_reference_routines_page(
    '55000000-0000-4000-8000-000000000002',100,NULL,NULL
  )
);

SELECT is(
  pg_catalog.jsonb_array_length(document->'routines'),100,
  'the first page remains bounded at 100 routines'
) FROM pg_temp.page_results WHERE page_number=1;
SELECT is(document->>'hasMore','true',
  'the first page explicitly reports overflow')
FROM pg_temp.page_results WHERE page_number=1;
SELECT is(document#>>'{nextCursor,routineId}',
  '55000000-0000-4000-8000-000000000100',
  'the equal-timestamp cursor uses the final included UUID tie breaker')
FROM pg_temp.page_results WHERE page_number=1;
SELECT is(
  public.list_training_manual_reference_routines(
    '55000000-0000-4000-8000-000000000002'
  )->>'hasMore','true',
  'the backwards-compatible one-argument RPC no longer truncates silently'
);

INSERT INTO pg_temp.page_results
SELECT 2,public.list_training_manual_reference_routines_page(
  '55000000-0000-4000-8000-000000000002',100,
  (document#>>'{nextCursor,updatedAt}')::timestamptz,
  (document#>>'{nextCursor,routineId}')::uuid
)
FROM pg_temp.page_results WHERE page_number=1;

SELECT is(
  pg_catalog.jsonb_array_length(document->'routines'),2,
  'the second page contains the two remaining equal-timestamp routines'
) FROM pg_temp.page_results WHERE page_number=2;
SELECT is(document->>'hasMore','false',
  'the final page reports that pagination is complete')
FROM pg_temp.page_results WHERE page_number=2;
SELECT is(document->>'nextCursor',NULL,
  'the final page has no cursor')
FROM pg_temp.page_results WHERE page_number=2;

SELECT is(
  (SELECT pg_catalog.count(DISTINCT routine_id)
   FROM (
     SELECT (pg_catalog.jsonb_array_elements(document->'routines')->>'routineId')::uuid routine_id
     FROM pg_temp.page_results
   ) listed),
  102::bigint,
  'stable pagination neither duplicates nor omits equal-timestamp routines'
);

SELECT throws_ok($$
  SELECT public.list_training_manual_reference_routines_page(
    '55000000-0000-4000-8000-000000000002',101,NULL,NULL
  )
$$,'22023',NULL,'the page RPC rejects a limit above 100');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

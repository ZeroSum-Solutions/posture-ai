BEGIN;
SELECT no_plan();

SELECT is(
  (SELECT pg_catalog.count(*) FROM public.training_reference_library_records),
  280::bigint,
  'the immutable reference registry contains all 280 exact records'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.training_reference_library_records
    WHERE reference_id='wger:65d12ecf-54b8-466d-a412-e55c396cad69'
      AND snapshot_id='wger-1652-media-pilot-2026-09-08'
      AND display_json#>>'{media,source,author}'='AlucardEvil40'
  ),
  'the supplemental record retains its distinct snapshot and attributed media'
);
SELECT ok(
  has_function_privilege('authenticated',
    'public.create_training_manual_reference_routine(uuid,uuid,text,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.create_training_manual_reference_routine(uuid,uuid,text,jsonb)','EXECUTE')
  AND NOT has_table_privilege('authenticated',
    'public.training_manual_reference_routines','INSERT'),
  'authenticated actors use the validated RPC and cannot write routine tables directly'
);

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('54000000-0000-4000-8000-000000000001','routine-owner@example.invalid',now(),now()),
  ('54000000-0000-4000-8000-000000000002','routine-other@example.invalid',now(),now()),
  ('54000000-0000-4000-8000-000000000003','routine-coach@example.invalid',now(),now()),
  ('54000000-0000-4000-8000-000000000004','routine-unassigned-coach@example.invalid',now(),now()),
  ('54000000-0000-4000-8000-000000000005','routine-readonly-coach@example.invalid',now(),now());
INSERT INTO public.practitioners(id,display_name,access_status,role,session_valid_after)
VALUES ('54000000-0000-4000-8000-000000000003','Routine coach','active','practitioner','-infinity'),
  ('54000000-0000-4000-8000-000000000004','Unassigned routine coach','active','practitioner','-infinity'),
  ('54000000-0000-4000-8000-000000000005','Read-only routine coach','active','practitioner','-infinity');
INSERT INTO public.training_subjects(id,owner_user_id,status,activated_at) VALUES
  ('54000000-0000-4000-8000-000000000101','54000000-0000-4000-8000-000000000001','active',now()),
  ('54000000-0000-4000-8000-000000000102','54000000-0000-4000-8000-000000000002','active',now());
SET LOCAL session_replication_role = origin;
INSERT INTO public.coaching_relationships(
  id,subject_id,practitioner_id,status,permissions,started_at,revision
) VALUES (
  '54000000-0000-4000-8000-000000000201',
  '54000000-0000-4000-8000-000000000101',
  '54000000-0000-4000-8000-000000000003',
  'active',ARRAY['program:coach_publish']::public.training_coach_permission[],now(),1
);

INSERT INTO public.coaching_relationships(
  id,subject_id,practitioner_id,status,permissions,started_at,revision
) VALUES (
  '54000000-0000-4000-8000-000000000202',
  '54000000-0000-4000-8000-000000000101',
  '54000000-0000-4000-8000-000000000005',
  'active',ARRAY['subject:read','profile:read']::public.training_coach_permission[],now(),1
);

CREATE TEMP TABLE owner_create_result(document jsonb);
CREATE TEMP TABLE coach_create_result(document jsonb);
GRANT SELECT, INSERT ON pg_temp.owner_create_result, pg_temp.coach_create_result TO authenticated;

SELECT set_config('request.jwt.claim.sub','54000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims',
  '{"sub":"54000000-0000-4000-8000-000000000001","aal":"aal1","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$
  SELECT public.create_training_manual_reference_routine(
    '54000000-0000-4000-8000-000000000300',
    '54000000-0000-4000-8000-000000000101','AAL1 routine',
    '[{"itemId":"54000000-0000-4000-8000-000000000400","referenceExerciseId":"wger:d561c00c-436d-47d9-b647-222e7b637abd","kind":"conditioning","durationSeconds":60}]'::jsonb
  )
$$,'42501',NULL,'a signed-in owner without current AAL2 cannot create a routine');
RESET ROLE;

SELECT set_config('request.jwt.claims',
  '{"sub":"54000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
INSERT INTO pg_temp.owner_create_result
SELECT public.create_training_manual_reference_routine(
  '54000000-0000-4000-8000-000000000301',
  '54000000-0000-4000-8000-000000000101',
  'Tuesday routine',
  '[
    {"itemId":"54000000-0000-4000-8000-000000000401","referenceExerciseId":"wger:d561c00c-436d-47d9-b647-222e7b637abd","kind":"strength","sets":3,"reps":8,"load":{"value":"0012.500","unit":"kg"},"restSeconds":90},
    {"itemId":"54000000-0000-4000-8000-000000000402","referenceExerciseId":"wger:65d12ecf-54b8-466d-a412-e55c396cad69","kind":"conditioning","durationSeconds":600}
  ]'::jsonb
);

SELECT is(document#>>'{items,0,load,value}','0012.500',
  'the routine preserves the exact entered mass string') FROM pg_temp.owner_create_result;
SELECT is(document#>>'{items,1,exerciseDisplay,media,source,author}','AlucardEvil40',
  'the saved item pins display media attribution') FROM pg_temp.owner_create_result;
SELECT is(document#>>'{source,snapshotIds,1}','wger-1652-media-pilot-2026-09-08',
  'the routine declares the supplemental snapshot used by its items') FROM pg_temp.owner_create_result;
SELECT is(
  public.create_training_manual_reference_routine(
    '54000000-0000-4000-8000-000000000301',
    '54000000-0000-4000-8000-000000000101','Tuesday routine',
    '[
      {"itemId":"54000000-0000-4000-8000-000000000401","referenceExerciseId":"wger:d561c00c-436d-47d9-b647-222e7b637abd","kind":"strength","sets":3,"reps":8,"load":{"value":"0012.500","unit":"kg"},"restSeconds":90},
      {"itemId":"54000000-0000-4000-8000-000000000402","referenceExerciseId":"wger:65d12ecf-54b8-466d-a412-e55c396cad69","kind":"conditioning","durationSeconds":600}
    ]'::jsonb
  )->>'routineId',
  (SELECT document->>'routineId' FROM pg_temp.owner_create_result),
  'an exact create retry returns the original routine'
);
SELECT throws_ok($$
  SELECT public.create_training_manual_reference_routine(
    '54000000-0000-4000-8000-000000000301',
    '54000000-0000-4000-8000-000000000101','Changed title',
    '[{"itemId":"54000000-0000-4000-8000-000000000401","referenceExerciseId":"wger:d561c00c-436d-47d9-b647-222e7b637abd","kind":"strength","sets":3,"reps":8,"load":{"value":"12.5","unit":"kg"}}]'::jsonb
  )
$$,'PT409',NULL,'a changed payload cannot reuse a create request ID');
SELECT throws_ok($$
  SELECT public.create_training_manual_reference_routine(
    '54000000-0000-4000-8000-000000000302',
    '54000000-0000-4000-8000-000000000101','Unknown reference',
    '[{"itemId":"54000000-0000-4000-8000-000000000403","referenceExerciseId":"wger:00000000-0000-4000-8000-000000000000","kind":"conditioning","durationSeconds":60}]'::jsonb
  )
$$,'22023',NULL,'an unknown reference exercise cannot be persisted');
SELECT throws_ok($$
  SELECT public.create_training_manual_reference_routine(
    '54000000-0000-4000-8000-000000000303',
    '54000000-0000-4000-8000-000000000101','Forged provenance',
    '[{"itemId":"54000000-0000-4000-8000-000000000403","referenceExerciseId":"wger:d561c00c-436d-47d9-b647-222e7b637abd","kind":"conditioning","durationSeconds":60,"provenance":{"recordSha256":"forged"}}]'::jsonb
  )
$$,'22023',NULL,'the browser cannot submit provenance or extra authority fields');

SELECT is(
  public.update_training_manual_reference_routine(
    (SELECT (document->>'routineId')::uuid FROM pg_temp.owner_create_result),1,
    'Reordered routine',
    '[
      {"itemId":"54000000-0000-4000-8000-000000000402","referenceExerciseId":"wger:65d12ecf-54b8-466d-a412-e55c396cad69","kind":"conditioning","durationSeconds":720},
      {"itemId":"54000000-0000-4000-8000-000000000401","referenceExerciseId":"wger:d561c00c-436d-47d9-b647-222e7b637abd","kind":"strength","sets":4,"reps":8,"load":{"value":"15","unit":"kg"}}
    ]'::jsonb
  )#>>'{items,0,itemId}',
  '54000000-0000-4000-8000-000000000402',
  'an optimistic edit preserves stable item identity and authored order'
);
SELECT throws_ok(
  pg_catalog.format($sql$SELECT public.update_training_manual_reference_routine(%L,1,'Stale','[{"itemId":"54000000-0000-4000-8000-000000000401","referenceExerciseId":"wger:d561c00c-436d-47d9-b647-222e7b637abd","kind":"conditioning","durationSeconds":60}]'::jsonb)$sql$,
    (SELECT document->>'routineId' FROM pg_temp.owner_create_result)),
  'PT409',NULL,'a stale edit cannot overwrite the current revision'
);
SELECT is(
  public.list_training_manual_reference_routines('54000000-0000-4000-8000-000000000101')
    #>>'{routines,0,title}',
  'Reordered routine','the owner lists its persisted current routine'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','54000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims',
  '{"sub":"54000000-0000-4000-8000-000000000002","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.read_training_manual_reference_routine(
    (SELECT (document->>'routineId')::uuid FROM pg_temp.owner_create_result)
  ),NULL::jsonb,'an unrelated owner cannot read the routine'
);
SELECT throws_ok($$
  SELECT public.list_training_manual_reference_routines('54000000-0000-4000-8000-000000000101')
$$,'42501',NULL,'an unrelated owner cannot list the subject routines');
SELECT throws_ok(
  pg_catalog.format($sql$SELECT public.archive_training_manual_reference_routine(%L,2)$sql$,
    (SELECT document->>'routineId' FROM pg_temp.owner_create_result)),
  '42501',NULL,'an unrelated owner cannot use an archive retry to reveal the routine'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','54000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims',
  '{"sub":"54000000-0000-4000-8000-000000000003","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
INSERT INTO pg_temp.coach_create_result
SELECT public.create_training_manual_reference_routine(
  '54000000-0000-4000-8000-000000000304',
  '54000000-0000-4000-8000-000000000101','Coach authored routine',
  '[{"itemId":"54000000-0000-4000-8000-000000000404","referenceExerciseId":"wger:d561c00c-436d-47d9-b647-222e7b637abd","kind":"strength","sets":2,"reps":10,"load":{"value":"10","unit":"lb"}}]'::jsonb
);
SELECT is(document#>>'{createdBy,kind}','coach',
  'a coach with program publish scope is attributed as the author') FROM pg_temp.coach_create_result;
SELECT is(
  public.read_training_manual_reference_routine(
    (SELECT (document->>'routineId')::uuid FROM pg_temp.coach_create_result)
  )->>'title','Coach authored routine','the authorized coach reads its saved routine'
);
SELECT is(
  public.update_training_manual_reference_routine(
    (SELECT (document->>'routineId')::uuid FROM pg_temp.coach_create_result),1,
    'Coach edited routine',
    '[{"itemId":"54000000-0000-4000-8000-000000000404","referenceExerciseId":"wger:d561c00c-436d-47d9-b647-222e7b637abd","kind":"strength","sets":2,"reps":10,"load":{"value":"12","unit":"lb"}}]'::jsonb
  )->>'revision','2','the authorized coach edits a routine through the current revision'
);
SELECT is(
  public.archive_training_manual_reference_routine(
    (SELECT (document->>'routineId')::uuid FROM pg_temp.coach_create_result),2
  )->>'revision','3','the authorized coach archives a routine through the current revision'
);
RESET ROLE;

-- MR-03: identifiers and AAL2 do not confer manual-routine authority.
SELECT set_config('request.jwt.claim.sub','54000000-0000-4000-8000-000000000004',true);
SELECT set_config('request.jwt.claims',
  '{"sub":"54000000-0000-4000-8000-000000000004","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$
  SELECT public.create_training_manual_reference_routine(
    '54000000-0000-4000-8000-000000000301',
    '54000000-0000-4000-8000-000000000101','Unauthorized routine',
    '[{"itemId":"54000000-0000-4000-8000-000000000405","referenceExerciseId":"wger:d561c00c-436d-47d9-b647-222e7b637abd","kind":"conditioning","durationSeconds":60}]'::jsonb
  )
$$,'42501',NULL,'an unassigned practitioner cannot create a routine');
SELECT is(
  public.read_training_manual_reference_routine(
    (SELECT (document->>'routineId')::uuid FROM pg_temp.owner_create_result)
  ),NULL::jsonb,'an unassigned practitioner cannot read a known routine ID'
);
SELECT throws_ok($$
  SELECT public.list_training_manual_reference_routines('54000000-0000-4000-8000-000000000101')
$$,'42501',NULL,'an unassigned practitioner cannot list a known subject');
SELECT throws_ok(
  pg_catalog.format($sql$SELECT public.update_training_manual_reference_routine(%L,2,'Unauthorized edit','[{"itemId":"54000000-0000-4000-8000-000000000401","referenceExerciseId":"wger:d561c00c-436d-47d9-b647-222e7b637abd","kind":"conditioning","durationSeconds":60}]'::jsonb)$sql$,
    (SELECT document->>'routineId' FROM pg_temp.owner_create_result)),
  '42501',NULL,'an unassigned practitioner cannot edit the routine'
);
SELECT throws_ok(
  pg_catalog.format($sql$SELECT public.archive_training_manual_reference_routine(%L,2)$sql$,
    (SELECT document->>'routineId' FROM pg_temp.owner_create_result)),
  '42501',NULL,'an unassigned practitioner cannot archive the routine'
);
RESET ROLE;

-- MR-03: identifiers and AAL2 do not confer manual-routine authority.
SELECT set_config('request.jwt.claim.sub','54000000-0000-4000-8000-000000000005',true);
SELECT set_config('request.jwt.claims',
  '{"sub":"54000000-0000-4000-8000-000000000005","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$
  SELECT public.create_training_manual_reference_routine(
    '54000000-0000-4000-8000-000000000301',
    '54000000-0000-4000-8000-000000000101','Unauthorized routine',
    '[{"itemId":"54000000-0000-4000-8000-000000000405","referenceExerciseId":"wger:d561c00c-436d-47d9-b647-222e7b637abd","kind":"conditioning","durationSeconds":60}]'::jsonb
  )
$$,'42501',NULL,'a practitioner without program publish permission cannot create a routine');
SELECT is(
  public.read_training_manual_reference_routine(
    (SELECT (document->>'routineId')::uuid FROM pg_temp.owner_create_result)
  ),NULL::jsonb,'a practitioner without program publish permission cannot read a known routine ID'
);
SELECT throws_ok($$
  SELECT public.list_training_manual_reference_routines('54000000-0000-4000-8000-000000000101')
$$,'42501',NULL,'a practitioner without program publish permission cannot list a known subject');
SELECT throws_ok(
  pg_catalog.format($sql$SELECT public.update_training_manual_reference_routine(%L,2,'Unauthorized edit','[{"itemId":"54000000-0000-4000-8000-000000000401","referenceExerciseId":"wger:d561c00c-436d-47d9-b647-222e7b637abd","kind":"conditioning","durationSeconds":60}]'::jsonb)$sql$,
    (SELECT document->>'routineId' FROM pg_temp.owner_create_result)),
  '42501',NULL,'a practitioner without program publish permission cannot edit the routine'
);
SELECT throws_ok(
  pg_catalog.format($sql$SELECT public.archive_training_manual_reference_routine(%L,2)$sql$,
    (SELECT document->>'routineId' FROM pg_temp.owner_create_result)),
  '42501',NULL,'a practitioner without program publish permission cannot archive the routine'
);
RESET ROLE;

SELECT is(
  (SELECT pg_catalog.count(*) FROM public.training_manual_reference_routines
    WHERE subject_id='54000000-0000-4000-8000-000000000101'),
  2::bigint,'denied practitioner attempts do not create partial routines'
);
SELECT is(
  (SELECT pg_catalog.count(*) FROM public.training_manual_reference_routine_revisions
    WHERE routine_id=(SELECT (document->>'routineId')::uuid FROM pg_temp.owner_create_result)),
  2::bigint,'denied practitioner edits and archives leave owner history unchanged'
);

SELECT set_config('request.jwt.claim.sub','54000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims',
  '{"sub":"54000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.archive_training_manual_reference_routine(
    (SELECT (document->>'routineId')::uuid FROM pg_temp.owner_create_result),2
  )->>'revision','3','archive appends a new immutable revision'
);
SELECT is(
  public.archive_training_manual_reference_routine(
    (SELECT (document->>'routineId')::uuid FROM pg_temp.owner_create_result),2
  )->>'revision','3','an exact archive retry returns the same revision'
);
SELECT is(
  (SELECT pg_catalog.count(*) FROM public.training_manual_reference_routine_revisions
    WHERE routine_id=(SELECT (document->>'routineId')::uuid FROM pg_temp.owner_create_result)),
  3::bigint,'create, update, and archive history remains append-only'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

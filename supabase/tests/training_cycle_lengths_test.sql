BEGIN;
SELECT no_plan();

SELECT ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.training_program_builds'::regclass AND conname='training_program_builds_cycle_horizon' AND convalidated),
  'stored compiler builds bind explicit cycle length to their week horizon'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.training_program_drafts'::regclass AND conname='training_program_drafts_cycle_length' AND convalidated),
  'accepted drafts allow only supported explicit cycle lengths'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.training_program_revisions'::regclass AND conname='training_program_revisions_cycle_length' AND convalidated),
  'published revisions preserve the supported explicit cycle length'
);

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('53000000-0000-4000-8000-000000000001','cycle-four@example.invalid',now(),now()),
  ('53000000-0000-4000-8000-000000000002','cycle-eight@example.invalid',now(),now());
INSERT INTO public.training_subjects(
  id,owner_user_id,status,activated_at,current_profile_revision
) VALUES
  ('53000000-0000-4000-8000-000000000003','53000000-0000-4000-8000-000000000001','active',now(),1),
  ('53000000-0000-4000-8000-000000000004','53000000-0000-4000-8000-000000000002','active',now(),1);
WITH profiles(subject_id, owner_id, cycle_length) AS (
  VALUES
    ('53000000-0000-4000-8000-000000000003'::uuid,'53000000-0000-4000-8000-000000000001'::uuid,4),
    ('53000000-0000-4000-8000-000000000004'::uuid,'53000000-0000-4000-8000-000000000002'::uuid,8)
), payloads AS (
  SELECT subject_id, owner_id, jsonb_build_object(
    'schemaVersion','athlete-training-profile.v1',
    'origin',jsonb_build_object('kind','synthetic_fixture','fixtureId','cycle-lengths.v1','label','Synthetic cycle length fixture'),
    'goal','general_fitness','experience','beginner','recentConsistency','consistent',
    'cycleLengthWeeks',cycle_length,'strengthDays',jsonb_build_array('monday','thursday'),
    'localTimezone','UTC','sessionTimeBudgetMinutes',30,'preferredLoadUnit','kg',
    'equipmentInventory','[]'::jsonb,'startingHistory','[]'::jsonb
  ) AS profile
  FROM profiles
)
INSERT INTO public.training_profile_revisions(
  subject_id,revision,schema_version,profile_json,profile_hash,hash_encoding,created_by_user_id
)
SELECT subject_id,1,'athlete-training-profile.v1',profile,private.training_evidence_sha256(profile),
  'postgres-jsonb-text-utf8.v1',owner_id
FROM payloads;
SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.cycle_context(p_run_id uuid)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'kind','synthetic_simulation','simulationRunId',p_run_id,
    'fixtureId','cycle-lengths.v1','fixtureHash',repeat('c',64),'label','Practice data'
  );
$$;

CREATE FUNCTION pg_temp.compiled_cycle(
  p_subject_id uuid,
  p_run_id uuid,
  p_program_revision_id text,
  p_cycle_length integer,
  p_week_count integer
) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'kind','draft_program','schemaVersion','compiled-program.v1',
    'compilerPolicyVersion','strength-cycle-compiler.v3',
    'status','requires_explicit_acceptance','subjectId',p_subject_id,
    'profileRevisionId','1','programRevisionId',p_program_revision_id,
    'catalogVersion','cycle-catalog.v1','executionContext',pg_temp.cycle_context(p_run_id),
    'cycleStartLocalDate','2026-09-07','cycleLengthWeeks',p_cycle_length,
    'weeks',(
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('week',week_number) ORDER BY week_number
      )
      FROM pg_catalog.generate_series(1,p_week_count) week_number
    )
  );
$$;

CREATE FUNCTION pg_temp.accepted_cycle(
  p_assignment_id text,
  p_subject_id uuid,
  p_actor_id uuid,
  p_run_id uuid,
  p_program_revision_id text,
  p_cycle_length integer
) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion','training-program-revision.v1','assignmentId',p_assignment_id,
    'revisionNumber',1,'subjectId',p_subject_id,'programMode','self_directed',
    'owningPractitionerId',NULL,'executionContext',pg_temp.cycle_context(p_run_id),
    'cycleStartLocalDate','2026-09-07','cycleLengthWeeks',p_cycle_length,
    'profileRevisionId','1','eligibilitySourceRevisionId','simulation-only',
    'compilerPolicyVersion','strength-cycle-compiler.v3','catalogVersion','cycle-catalog.v1',
    'catalogOrigin',pg_catalog.jsonb_build_object(
      'kind','synthetic_fixture','source','server_fixture','fixtureId','cycle-lengths.v1',
      'fixtureHash',repeat('c',64),'label','Synthetic cycle length fixture'
    ),
    'ruleVersion','progression.v1','compiledProgramRevisionId',p_program_revision_id,
    'publishedAt','2026-09-08T12:00:00.000Z',
    'author',pg_catalog.jsonb_build_object('kind','athlete','userId',p_actor_id),
    'sessions',(
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'sessionId',p_assignment_id || '-session-' || week_number,
          'scheduledLocalDate',('2026-09-07'::date + ((week_number - 1) * 7))::text,
          'athleteTimezone','UTC','exercises',pg_catalog.jsonb_build_array()
        ) ORDER BY week_number
      )
      FROM pg_catalog.generate_series(1,p_cycle_length) week_number
    ),
    'conditioningBouts',pg_catalog.jsonb_build_array()
  );
$$;

SET LOCAL ROLE service_role;
INSERT INTO public.training_simulation_runs(
  id,subject_id,created_by_user_id,fixture_id,fixture_hash,expires_at
) VALUES
  (
    '53000000-0000-4000-8000-000000000005','53000000-0000-4000-8000-000000000003',
    '53000000-0000-4000-8000-000000000001','cycle-lengths.v1',repeat('c',64),now()+interval '1 hour'
  ),
  (
    '53000000-0000-4000-8000-000000000006','53000000-0000-4000-8000-000000000004',
    '53000000-0000-4000-8000-000000000002','cycle-lengths.v1',repeat('c',64),now()+interval '1 hour'
  );

SELECT lives_ok($$
  INSERT INTO public.training_program_builds(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    program_revision_id,compiler_policy_version,catalog_version,build_json,expires_at
  ) VALUES (
    '53000000-0000-4000-8000-000000000007','53000000-0000-4000-8000-000000000003',
    '53000000-0000-4000-8000-000000000001',1,'53000000-0000-4000-8000-000000000005',
    'cycle-four-build','strength-cycle-compiler.v3','cycle-catalog.v1',
    pg_temp.compiled_cycle(
      '53000000-0000-4000-8000-000000000003','53000000-0000-4000-8000-000000000005',
      'cycle-four-build',4,4
    ),now()+interval '30 minutes'
  )
$$, 'a stored four-week preview preserves its explicit four-week horizon');

SELECT lives_ok($$
  INSERT INTO public.training_program_drafts(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    source_build_id,selection_hash,program_json,expires_at
  ) VALUES (
    '53000000-0000-4000-8000-000000000008','53000000-0000-4000-8000-000000000003',
    '53000000-0000-4000-8000-000000000001',1,'53000000-0000-4000-8000-000000000005',
    '53000000-0000-4000-8000-000000000007',repeat('d',64),
    pg_temp.accepted_cycle(
      'cycle-four-assignment','53000000-0000-4000-8000-000000000003',
      '53000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000005',
      'cycle-four-build',4
    ),now()+interval '30 minutes'
  )
$$, 'four-week preview acceptance stores the same explicit cycle length');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','53000000-0000-4000-8000-000000000001',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"53000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT is(
  public.publish_training_program_draft('53000000-0000-4000-8000-000000000008'),
  'cycle-four-assignment',
  'the owning athlete publishes the accepted four-week program'
);
RESET ROLE;

SELECT results_eq(
  $$
    SELECT program_json->>'cycleLengthWeeks', count(session.id)
    FROM public.training_program_revisions revision
    JOIN public.training_sessions session ON session.assignment_id=revision.assignment_id
    WHERE revision.assignment_id='cycle-four-assignment'
    GROUP BY program_json->>'cycleLengthWeeks'
  $$,
  $$VALUES ('4'::text,4::bigint)$$,
  'published program and materialized horizon remain explicitly four weeks'
);

SELECT throws_ok($$
  INSERT INTO public.training_program_revisions(
    assignment_id,subject_id,revision_number,program_json,created_by_user_id
  )
  SELECT assignment_id,subject_id,2,
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(program_json,'{revisionNumber}','2'::jsonb),
      '{compilerPolicyVersion}','"eight-week-compiler.v1"'::jsonb
    ),
    created_by_user_id
  FROM public.training_program_revisions
  WHERE assignment_id='cycle-four-assignment' AND revision_number=1
$$, '23514', NULL,
  'a published non-eight-week revision cannot claim legacy compiler provenance');

SET LOCAL ROLE service_role;
SELECT lives_ok($$
  INSERT INTO public.training_program_builds(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    program_revision_id,compiler_policy_version,catalog_version,build_json,expires_at
  ) VALUES (
    '53000000-0000-4000-8000-000000000009','53000000-0000-4000-8000-000000000004',
    '53000000-0000-4000-8000-000000000002',1,'53000000-0000-4000-8000-000000000006',
    'cycle-eight-build','strength-cycle-compiler.v3','cycle-catalog.v1',
    pg_temp.compiled_cycle(
      '53000000-0000-4000-8000-000000000004','53000000-0000-4000-8000-000000000006',
      'cycle-eight-build',8,8
    ),now()+interval '30 minutes'
  );
  INSERT INTO public.training_program_drafts(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    source_build_id,selection_hash,program_json,expires_at
  ) VALUES (
    '53000000-0000-4000-8000-000000000010','53000000-0000-4000-8000-000000000004',
    '53000000-0000-4000-8000-000000000002',1,'53000000-0000-4000-8000-000000000006',
    '53000000-0000-4000-8000-000000000009',repeat('e',64),
    pg_temp.accepted_cycle(
      'cycle-eight-assignment','53000000-0000-4000-8000-000000000004',
      '53000000-0000-4000-8000-000000000002','53000000-0000-4000-8000-000000000006',
      'cycle-eight-build',8
    ),now()+interval '30 minutes'
  )
$$, 'existing eight-week build and accepted-draft shape remains valid');

SELECT lives_ok($$
  INSERT INTO public.training_program_builds(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    program_revision_id,compiler_policy_version,catalog_version,build_json,expires_at
  ) VALUES (
    '53000000-0000-4000-8000-000000000015','53000000-0000-4000-8000-000000000004',
    '53000000-0000-4000-8000-000000000002',1,'53000000-0000-4000-8000-000000000006',
    'legacy-eight-build','eight-week-compiler.v2','cycle-catalog.v1',
    pg_catalog.jsonb_set(
      pg_temp.compiled_cycle(
        '53000000-0000-4000-8000-000000000004','53000000-0000-4000-8000-000000000006',
        'legacy-eight-build',8,8
      ) - 'cycleLengthWeeks',
      '{compilerPolicyVersion}',
      '"eight-week-compiler.v2"'::jsonb
    ),now()+interval '30 minutes'
  )
$$, 'an immutable v2 eight-week build without the new explicit field remains valid');

SELECT lives_ok($$
  INSERT INTO public.training_program_builds(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    program_revision_id,compiler_policy_version,catalog_version,build_json,expires_at
  ) VALUES (
    '53000000-0000-4000-8000-000000000018','53000000-0000-4000-8000-000000000004',
    '53000000-0000-4000-8000-000000000002',1,'53000000-0000-4000-8000-000000000006',
    'legacy-v1-eight-build','eight-week-compiler.v1','cycle-catalog.v1',
    pg_catalog.jsonb_set(
      pg_temp.compiled_cycle(
        '53000000-0000-4000-8000-000000000004','53000000-0000-4000-8000-000000000006',
        'legacy-v1-eight-build',8,8
      ) - 'cycleLengthWeeks',
      '{compilerPolicyVersion}',
      '"eight-week-compiler.v1"'::jsonb
    ),now()+interval '30 minutes'
  )
$$, 'an immutable v1 eight-week build without the new explicit field remains valid');

SELECT throws_ok($$
  INSERT INTO public.training_program_drafts(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    program_json,expires_at
  ) VALUES (
    '53000000-0000-4000-8000-000000000019','53000000-0000-4000-8000-000000000003',
    '53000000-0000-4000-8000-000000000001',1,'53000000-0000-4000-8000-000000000005',
    pg_catalog.jsonb_set(
      pg_temp.accepted_cycle(
        'invalid-legacy-four-assignment','53000000-0000-4000-8000-000000000003',
        '53000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000005',
        'invalid-legacy-four-build',4
      ),
      '{compilerPolicyVersion}','"eight-week-compiler.v1"'::jsonb
    ),now()+interval '30 minutes'
  )
$$, '23514', NULL,
  'a non-eight-week draft cannot claim legacy compiler provenance');

SELECT throws_ok($$
  INSERT INTO public.training_program_builds(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    program_revision_id,compiler_policy_version,catalog_version,build_json,expires_at
  ) VALUES (
    '53000000-0000-4000-8000-000000000016','53000000-0000-4000-8000-000000000004',
    '53000000-0000-4000-8000-000000000002',1,'53000000-0000-4000-8000-000000000006',
    'invalid-explicit-v2-build','eight-week-compiler.v2','cycle-catalog.v1',
    pg_catalog.jsonb_set(
      pg_temp.compiled_cycle(
        '53000000-0000-4000-8000-000000000004','53000000-0000-4000-8000-000000000006',
        'invalid-explicit-v2-build',8,8
      ),
      '{compilerPolicyVersion}',
      '"eight-week-compiler.v2"'::jsonb
    ),now()+interval '30 minutes'
  )
$$, '23514', NULL,
  'the v2 grandfather does not authorize a new shape carrying the explicit field');

SELECT throws_ok($$
  INSERT INTO public.training_program_builds(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    program_revision_id,compiler_policy_version,catalog_version,build_json,expires_at
  ) VALUES (
    '53000000-0000-4000-8000-000000000017','53000000-0000-4000-8000-000000000004',
    '53000000-0000-4000-8000-000000000002',1,'53000000-0000-4000-8000-000000000006',
    'unknown-policy-build','unknown-cycle-compiler.v1','cycle-catalog.v1',
    pg_catalog.jsonb_set(
      pg_temp.compiled_cycle(
        '53000000-0000-4000-8000-000000000004','53000000-0000-4000-8000-000000000006',
        'unknown-policy-build',4,4
      ),
      '{compilerPolicyVersion}',
      '"unknown-cycle-compiler.v1"'::jsonb
    ),now()+interval '30 minutes'
  )
$$, '23514', NULL,
  'an unknown compiler policy cannot persist an otherwise valid explicit horizon');

SELECT throws_ok($$
  INSERT INTO public.training_program_builds(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    program_revision_id,compiler_policy_version,catalog_version,build_json,expires_at
  ) VALUES (
    '53000000-0000-4000-8000-000000000011','53000000-0000-4000-8000-000000000004',
    '53000000-0000-4000-8000-000000000002',1,'53000000-0000-4000-8000-000000000006',
    'cycle-mismatch-build','strength-cycle-compiler.v3','cycle-catalog.v1',
    pg_temp.compiled_cycle(
      '53000000-0000-4000-8000-000000000004','53000000-0000-4000-8000-000000000006',
      'cycle-mismatch-build',4,8
    ),now()+interval '30 minutes'
  )
$$, '23514', NULL, 'stored build rejects a cycle length that disagrees with its week horizon');

INSERT INTO public.training_program_builds(
  id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
  program_revision_id,compiler_policy_version,catalog_version,build_json,expires_at
) VALUES (
  '53000000-0000-4000-8000-000000000012','53000000-0000-4000-8000-000000000004',
  '53000000-0000-4000-8000-000000000002',1,'53000000-0000-4000-8000-000000000006',
  'cycle-source-build','strength-cycle-compiler.v3','cycle-catalog.v1',
  pg_temp.compiled_cycle(
    '53000000-0000-4000-8000-000000000004','53000000-0000-4000-8000-000000000006',
    'cycle-source-build',8,8
  ),now()+interval '30 minutes'
);
SELECT throws_ok($$
  INSERT INTO public.training_program_drafts(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    source_build_id,selection_hash,program_json,expires_at
  ) VALUES (
    '53000000-0000-4000-8000-000000000013','53000000-0000-4000-8000-000000000004',
    '53000000-0000-4000-8000-000000000002',1,'53000000-0000-4000-8000-000000000006',
    '53000000-0000-4000-8000-000000000012',repeat('f',64),
    pg_temp.accepted_cycle(
      'cycle-mismatch-assignment','53000000-0000-4000-8000-000000000004',
      '53000000-0000-4000-8000-000000000002','53000000-0000-4000-8000-000000000006',
      'cycle-source-build',4
    ),now()+interval '30 minutes'
  )
$$, '23514', 'accepted training draft cycle does not match its source build',
  'accepted draft cannot change the compiler-authored cycle length');

SELECT throws_ok($$
  INSERT INTO public.training_program_builds(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    program_revision_id,compiler_policy_version,catalog_version,build_json,expires_at
  ) VALUES (
    '53000000-0000-4000-8000-000000000014','53000000-0000-4000-8000-000000000004',
    '53000000-0000-4000-8000-000000000002',1,'53000000-0000-4000-8000-000000000006',
    'cycle-five-build','strength-cycle-compiler.v3','cycle-catalog.v1',
    pg_temp.compiled_cycle(
      '53000000-0000-4000-8000-000000000004','53000000-0000-4000-8000-000000000006',
      'cycle-five-build',5,5
    ),now()+interval '30 minutes'
  )
$$, '23514', NULL, 'unsupported cycle lengths cannot enter stored build evidence');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

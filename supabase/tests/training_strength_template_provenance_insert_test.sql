BEGIN;
SELECT no_plan();

CREATE FUNCTION pg_temp.template_context(p_run_id uuid)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'kind','synthetic_simulation','simulationRunId',p_run_id,
    'fixtureId','template-regression.v1','fixtureHash',repeat('a',64),
    'label','Practice data'
  );
$$;

CREATE FUNCTION pg_temp.undulating_template(p_version text DEFAULT 'intermediate-undulating.v1')
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion','strength-template.v1',
    'style','intermediate_undulating',
    'templateId','intermediate-undulating',
    'templateVersion',p_version,
    'provenance',pg_catalog.jsonb_build_object(
      'kind','synthetic_fixture','fixtureId','template-regression.v1',
      'fixtureHash',repeat('a',64),'label','Practice data'
    ),
    'heavy',pg_catalog.jsonb_build_object(
      'exposureType','heavy','repRange',jsonb_build_object('minimum',6,'maximum',8),
      'targetRir',jsonb_build_object('minimum',2,'maximum',3),'restSeconds',180
    ),
    'volume',pg_catalog.jsonb_build_object(
      'exposureType','volume','repRange',jsonb_build_object('minimum',10,'maximum',12),
      'targetRir',jsonb_build_object('minimum',2,'maximum',3),'restSeconds',120
    )
  );
$$;

CREATE FUNCTION pg_temp.compiled_undulating(
  p_subject_id uuid,
  p_run_id uuid,
  p_program_revision_id text,
  p_template_version text DEFAULT 'intermediate-undulating.v1'
) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'kind','draft_program','schemaVersion','compiled-program.v1',
    'compilerPolicyVersion','strength-cycle-compiler.v3',
    'status','requires_explicit_acceptance','subjectId',p_subject_id,
    'profileRevisionId','1','programRevisionId',p_program_revision_id,
    'catalogVersion','template-regression-catalog.v1',
    'executionContext',pg_temp.template_context(p_run_id),
    'strengthProgrammingStyle','intermediate_undulating',
    'strengthTemplate',pg_temp.undulating_template(p_template_version),
    'cycleStartLocalDate','2026-09-07','cycleLengthWeeks',8,
    'weeks',(
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('week',week_number) ORDER BY week_number
      ) FROM pg_catalog.generate_series(1,8) week_number
    )
  );
$$;

CREATE FUNCTION pg_temp.accepted_undulating(
  p_assignment_id text,
  p_subject_id uuid,
  p_actor_id uuid,
  p_run_id uuid,
  p_program_revision_id text,
  p_revision integer DEFAULT 1,
  p_template_version text DEFAULT 'intermediate-undulating.v1'
) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion','training-program-revision.v1','assignmentId',p_assignment_id,
    'revisionNumber',p_revision,'subjectId',p_subject_id,
    'programMode','self_directed','owningPractitionerId',NULL,
    'executionContext',pg_temp.template_context(p_run_id),
    'strengthProgrammingStyle','intermediate_undulating',
    'strengthTemplate',pg_temp.undulating_template(p_template_version),
    'cycleStartLocalDate','2026-09-07','cycleLengthWeeks',8,
    'profileRevisionId','1','eligibilitySourceRevisionId','simulation:template-regression',
    'compilerPolicyVersion','strength-cycle-compiler.v3',
    'catalogVersion','template-regression-catalog.v1',
    'catalogOrigin',pg_catalog.jsonb_build_object(
      'kind','synthetic_fixture','source','server_fixture',
      'fixtureId','template-regression.v1','fixtureHash',repeat('a',64),
      'label','Synthetic template regression catalog'
    ),
    'ruleVersion','progression.v1','compiledProgramRevisionId',p_program_revision_id,
    'publishedAt','2026-09-08T12:00:00.000Z',
    'author',pg_catalog.jsonb_build_object('kind','athlete','userId',p_actor_id),
    'sessions',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'sessionId','template-session-1','scheduledLocalDate','2026-09-07',
      'athleteTimezone','UTC','exercises',pg_catalog.jsonb_build_array()
    )),
    'conditioningBouts',pg_catalog.jsonb_build_array()
  );
$$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('62010000-0000-4000-8000-000000000001','template-owner@example.invalid',now(),now()),
  ('62010000-0000-4000-8000-000000000002','repeatable-owner@example.invalid',now(),now());
INSERT INTO public.training_subjects(
  id,owner_user_id,status,activated_at,current_profile_revision
) VALUES
  ('62010000-0000-4000-8000-000000000101','62010000-0000-4000-8000-000000000001','active',now(),1),
  ('62010000-0000-4000-8000-000000000102','62010000-0000-4000-8000-000000000002','active',now(),1);
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE profile_documents(
  subject_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  document jsonb NOT NULL
);
INSERT INTO profile_documents VALUES
  (
    '62010000-0000-4000-8000-000000000101',
    '62010000-0000-4000-8000-000000000001',
    '{
      "schemaVersion":"athlete-training-profile.v1",
      "origin":{"kind":"synthetic_fixture","fixtureId":"template-regression.v1","label":"Synthetic template regression profile"},
      "goal":"strength","experience":"intermediate","strengthProgrammingStyle":"intermediate_undulating",
      "recentConsistency":"consistent","cycleLengthWeeks":8,
      "strengthDays":["monday","thursday"],"localTimezone":"UTC",
      "sessionTimeBudgetMinutes":45,"preferredLoadUnit":"kg",
      "equipmentInventory":[],"startingHistory":[]
    }'
  ),
  (
    '62010000-0000-4000-8000-000000000102',
    '62010000-0000-4000-8000-000000000002',
    '{
      "schemaVersion":"athlete-training-profile.v1",
      "origin":{"kind":"synthetic_fixture","fixtureId":"template-regression.v1","label":"Synthetic repeatable regression profile"},
      "goal":"strength","experience":"intermediate","strengthProgrammingStyle":"repeatable",
      "recentConsistency":"consistent","cycleLengthWeeks":8,
      "strengthDays":["monday","thursday"],"localTimezone":"UTC",
      "sessionTimeBudgetMinutes":45,"preferredLoadUnit":"kg",
      "equipmentInventory":[],"startingHistory":[]
    }'
  );

SELECT lives_ok($$
  INSERT INTO public.training_profile_revisions(
    subject_id,revision,schema_version,profile_json,profile_hash,hash_encoding,created_by_user_id
  ) SELECT subject_id,1,'athlete-training-profile.v1',document,
    private.training_evidence_sha256(document),'postgres-jsonb-text-utf8.v1',owner_id
    FROM profile_documents
$$, 'real profile rows preserve explicit intermediate and repeatable styles');

INSERT INTO public.training_simulation_runs(
  id,subject_id,created_by_user_id,fixture_id,fixture_hash,expires_at
) VALUES
  ('62010000-0000-4000-8000-000000000201','62010000-0000-4000-8000-000000000101',
   '62010000-0000-4000-8000-000000000001','template-regression.v1',repeat('a',64),now()+interval '1 hour'),
  ('62010000-0000-4000-8000-000000000202','62010000-0000-4000-8000-000000000102',
   '62010000-0000-4000-8000-000000000002','template-regression.v1',repeat('a',64),now()+interval '1 hour');

SELECT lives_ok($$
  INSERT INTO public.training_program_builds(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    program_revision_id,compiler_policy_version,catalog_version,build_json,expires_at
  ) VALUES (
    '62010000-0000-4000-8000-000000000301','62010000-0000-4000-8000-000000000101',
    '62010000-0000-4000-8000-000000000001',1,'62010000-0000-4000-8000-000000000201',
    'template-build-1','strength-cycle-compiler.v3','template-regression-catalog.v1',
    pg_temp.compiled_undulating(
      '62010000-0000-4000-8000-000000000101','62010000-0000-4000-8000-000000000201',
      'template-build-1'
    ),now()+interval '30 minutes'
  )
$$, 'a real stored build accepts an exact profile-bound synthetic template');

SELECT throws_ok($$
  INSERT INTO public.training_program_builds(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    program_revision_id,compiler_policy_version,catalog_version,build_json,expires_at
  ) VALUES (
    '62010000-0000-4000-8000-000000000302','62010000-0000-4000-8000-000000000102',
    '62010000-0000-4000-8000-000000000002',1,'62010000-0000-4000-8000-000000000202',
    'template-build-cross-style','strength-cycle-compiler.v3','template-regression-catalog.v1',
    pg_temp.compiled_undulating(
      '62010000-0000-4000-8000-000000000102','62010000-0000-4000-8000-000000000202',
      'template-build-cross-style'
    ),now()+interval '30 minutes'
  )
$$, '23514', 'strength template does not match saved profile',
  'an undulating build cannot borrow authority from a repeatable profile');

SELECT lives_ok($$
  INSERT INTO public.training_program_drafts(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    source_build_id,selection_hash,program_json,expires_at
  ) VALUES (
    '62010000-0000-4000-8000-000000000401','62010000-0000-4000-8000-000000000101',
    '62010000-0000-4000-8000-000000000001',1,'62010000-0000-4000-8000-000000000201',
    '62010000-0000-4000-8000-000000000301',repeat('b',64),
    pg_temp.accepted_undulating(
      'template-assignment-1','62010000-0000-4000-8000-000000000101',
      '62010000-0000-4000-8000-000000000001','62010000-0000-4000-8000-000000000201',
      'template-build-1'
    ),now()+interval '30 minutes'
  )
$$, 'a real accepted draft preserves the exact source-build template');

SELECT throws_ok($$
  INSERT INTO public.training_program_drafts(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    source_build_id,selection_hash,program_json,expires_at
  ) VALUES (
    '62010000-0000-4000-8000-000000000402','62010000-0000-4000-8000-000000000101',
    '62010000-0000-4000-8000-000000000001',1,'62010000-0000-4000-8000-000000000201',
    '62010000-0000-4000-8000-000000000301',repeat('c',64),
    pg_temp.accepted_undulating(
      'template-assignment-altered','62010000-0000-4000-8000-000000000101',
      '62010000-0000-4000-8000-000000000001','62010000-0000-4000-8000-000000000201',
      'template-build-1',1,'intermediate-undulating.v2'
    ),now()+interval '30 minutes'
  )
$$, '23514', 'strength template changed from immutable source',
  'an accepted draft cannot replace its source-build template version');

SELECT throws_ok($$
  INSERT INTO public.training_program_drafts(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    source_build_id,selection_hash,program_json,expires_at
  ) VALUES (
    '62010000-0000-4000-8000-000000000403','62010000-0000-4000-8000-000000000102',
    '62010000-0000-4000-8000-000000000002',1,'62010000-0000-4000-8000-000000000202',
    '62010000-0000-4000-8000-000000000301',repeat('d',64),
    pg_temp.accepted_undulating(
      'template-cross-subject','62010000-0000-4000-8000-000000000102',
      '62010000-0000-4000-8000-000000000002','62010000-0000-4000-8000-000000000202',
      'template-build-1'
    ) - 'strengthProgrammingStyle' - 'strengthTemplate',now()+interval '30 minutes'
  )
$$, '23514', 'accepted training draft cycle does not match its source build',
  'a source build from another subject cannot authorize an undulating draft');

SELECT lives_ok($$
  INSERT INTO public.training_program_assignments(
    id,subject_id,program_mode,owning_practitioner_id,simulation_run_id,source_draft_id
  ) VALUES (
    'template-assignment-1','62010000-0000-4000-8000-000000000101',
    'self_directed',NULL,'62010000-0000-4000-8000-000000000201',
    '62010000-0000-4000-8000-000000000401'
  )
$$, 'a real assignment binds the accepted draft before revision insertion');

SELECT lives_ok($$
  INSERT INTO public.training_program_revisions(
    assignment_id,subject_id,revision_number,program_json,created_by_user_id
  ) VALUES (
    'template-assignment-1','62010000-0000-4000-8000-000000000101',1,
    pg_temp.accepted_undulating(
      'template-assignment-1','62010000-0000-4000-8000-000000000101',
      '62010000-0000-4000-8000-000000000001','62010000-0000-4000-8000-000000000201',
      'template-build-1'
    ),'62010000-0000-4000-8000-000000000001'
  )
$$, 'the first real program revision preserves the accepted draft template');

SELECT throws_ok($$
  INSERT INTO public.training_program_revisions(
    assignment_id,subject_id,revision_number,program_json,created_by_user_id
  ) VALUES (
    'template-assignment-1','62010000-0000-4000-8000-000000000101',2,
    pg_temp.accepted_undulating(
      'template-assignment-1','62010000-0000-4000-8000-000000000101',
      '62010000-0000-4000-8000-000000000001','62010000-0000-4000-8000-000000000201',
      'template-build-1',2,'intermediate-undulating.v2'
    ),'62010000-0000-4000-8000-000000000001'
  )
$$, '23514', 'strength template changed from immutable source',
  'a later program revision cannot replace the prior immutable template');

SELECT * FROM finish();
ROLLBACK;

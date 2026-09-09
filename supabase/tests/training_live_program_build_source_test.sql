BEGIN;
SELECT no_plan();

SELECT has_column(
  'public', 'training_program_builds', 'eligibility_source_revision_id',
  'stored builds have an exact eligibility evidence column'
);
SELECT has_column(
  'public', 'training_program_drafts', 'eligibility_source_revision_id',
  'accepted drafts have an exact eligibility evidence column'
);
SELECT has_function(
  'public', 'resolve_training_live_program_build_source',
  ARRAY['uuid', 'bigint', 'text'],
  'the authenticated live source resolver exists'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.resolve_training_live_program_build_source(uuid,bigint,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.resolve_training_live_program_build_source(uuid,bigint,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.resolve_training_live_program_build_source(uuid,bigint,text)',
    'EXECUTE'
  ),
  'only authenticated actors receive live source resolution authority'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.training_program_builds', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.training_program_drafts', 'INSERT'),
  'browser actors still cannot insert compiler evidence directly'
);

CREATE FUNCTION pg_temp.explicit_eight_week_build(p_build jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_build || '{
    "cycleLengthWeeks":8,
    "weeks":[
      {"week":1},{"week":2},{"week":3},{"week":4},
      {"week":5},{"week":6},{"week":7},{"week":8}
    ]
  }'::jsonb;
$$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('68000000-0000-4000-8000-000000000001','live-owner@example.invalid',now(),now()),
  ('68000000-0000-4000-8000-000000000002','other-owner@example.invalid',now(),now()),
  ('68000000-0000-4000-8000-000000000003','live-coach@example.invalid',now(),now()),
  ('68000000-0000-4000-8000-000000000004','read-coach@example.invalid',now(),now());
INSERT INTO public.practitioners(
  id,display_name,access_status,role,session_valid_after
) VALUES
  ('68000000-0000-4000-8000-000000000003','Live coach','active','practitioner','-infinity'),
  ('68000000-0000-4000-8000-000000000004','Read coach','active','practitioner','-infinity');
INSERT INTO public.training_subjects(id,owner_user_id,status,activated_at) VALUES
  ('68000000-0000-4000-8000-000000000101','68000000-0000-4000-8000-000000000001','active',now()),
  ('68000000-0000-4000-8000-000000000102','68000000-0000-4000-8000-000000000002','active',now());
SET LOCAL session_replication_role = origin;

INSERT INTO public.coaching_relationships(
  id,subject_id,practitioner_id,status,permissions,started_at,revision
) VALUES
  (
    '68000000-0000-4000-8000-000000000201',
    '68000000-0000-4000-8000-000000000101',
    '68000000-0000-4000-8000-000000000003',
    'active',
    ARRAY['subject:read','profile:read','program:coach_publish']::public.training_coach_permission[],
    now(),1
  ),
  (
    '68000000-0000-4000-8000-000000000202',
    '68000000-0000-4000-8000-000000000101',
    '68000000-0000-4000-8000-000000000004',
    'active',
    ARRAY['subject:read','profile:read']::public.training_coach_permission[],
    now(),1
  );

SELECT set_config('request.jwt.claim.sub','68000000-0000-4000-8000-000000000001',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"68000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$
  SELECT * FROM public.append_training_profile_revision(
    '68000000-0000-4000-8000-000000000101',0,
    '{
      "schemaVersion":"athlete-training-profile.v1",
      "origin":{"kind":"athlete_input"},
      "goal":"strength",
      "experience":"beginner",
      "recentConsistency":"intermittent",
      "cycleLengthWeeks":8,
      "strengthDays":["monday","thursday"],
      "localTimezone":"UTC",
      "sessionTimeBudgetMinutes":30,
      "preferredLoadUnit":"kg",
      "equipmentInventory":[{
        "kind":"dumbbell","equipmentId":"db","unit":"kg","perHandLoads":["10"]
      }],
      "startingHistory":[]
    }'::jsonb
  )
$$, 'the owner stores a real athlete-input profile');
SELECT lives_ok($$
  SELECT * FROM public.append_training_eligibility_response(
    '68000000-0000-4000-8000-000000000101',0,'answers:live:1',
    '{
      "schemaVersion":"eligibility-answers.v1",
      "questionnaireSourceVersion":"preparticipation-inputs.v1-unvalidated",
      "submittedAt":"2026-09-08T12:00:00Z",
      "origin":{"kind":"athlete_self_report"},
      "adultScope":"confirmed_18_plus",
      "currentActivity":"regularly_active",
      "knownConditions":{"cardiovascular":"no","metabolic":"no","renal":"no"},
      "relevantSignsOrSymptoms":"no",
      "desiredIntensity":"moderate",
      "answerCertainty":"complete",
      "pregnancyPostpartumContext":"pregnant",
      "requestedProgrammingScope":"strength_or_general_fitness"
    }'::jsonb
  )
$$, 'the owner stores self-reported eligibility inputs without a decision');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT lives_ok($$
  SELECT * FROM public.record_training_eligibility_decision(
    '68000000-0000-4000-8000-000000000101',NULL,
    '{
      "schemaVersion":"eligibility-decision.v1",
      "sourceRevisionId":"decision:live:1",
      "answersRevisionId":"answers:live:1",
      "answersSchemaVersion":"eligibility-answers.v1",
      "questionnaireSourceVersion":"preparticipation-inputs.v1-unvalidated",
      "policyVersion":"reviewed-policy.v1",
      "state":"eligible_general",
      "scope":"supported",
      "source":{
        "kind":"policy_service",
        "sourceVersion":"eligibility-policy-service.v1",
        "evaluatedAt":"2026-09-08T12:01:00Z"
      },
      "effectiveFrom":"2020-01-01T00:00:00Z",
      "effectiveUntil":"2099-01-01T00:00:00Z",
      "supersededAt":null,
      "constraintSet":null
    }'::jsonb
  )
$$, 'service authority stores the exact current general eligibility decision');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','68000000-0000-4000-8000-000000000001',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"68000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT is(
  public.resolve_training_live_program_build_source(
    '68000000-0000-4000-8000-000000000101',1,NULL
  )->>'kind',
  'live',
  'the AAL2 owner resolves a live source'
);
SELECT results_eq(
  $$
    SELECT
      source->>'subjectId',
      source->>'profileRevision',
      source->>'eligibilitySourceRevisionId',
      source->>'policyVersion'
    FROM (
      SELECT public.resolve_training_live_program_build_source(
        '68000000-0000-4000-8000-000000000101',1,NULL
      ) AS source
    ) resolved
  $$,
  $$ VALUES (
    '68000000-0000-4000-8000-000000000101'::text,
    '1'::text,
    'decision:live:1'::text,
    'reviewed-policy.v1'::text
  ) $$,
  'the projection binds exact profile and decision evidence'
);
SELECT ok(
  public.resolve_training_live_program_build_source(
    '68000000-0000-4000-8000-000000000101',1,NULL
  ) ?& ARRAY['effectiveFrom','effectiveUntil'],
  'the projection includes the authoritative decision window'
);
SELECT throws_ok(
  $$ SELECT public.resolve_training_live_program_build_source(
    '68000000-0000-4000-8000-000000000101',0,NULL
  ) $$,
  'PT409','training profile changed concurrently',
  'an authorized owner cannot resolve a stale profile revision'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','68000000-0000-4000-8000-000000000003',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"68000000-0000-4000-8000-000000000003","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT is(
  public.resolve_training_live_program_build_source(
    '68000000-0000-4000-8000-000000000101',1,NULL
  )->>'eligibilitySourceRevisionId',
  'decision:live:1',
  'an AAL2 coach with program publish permission resolves the same source'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','68000000-0000-4000-8000-000000000004',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"68000000-0000-4000-8000-000000000004","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT ok(
  public.resolve_training_live_program_build_source(
    '68000000-0000-4000-8000-000000000101',1,NULL
  ) IS NULL,
  'a read-only coach cannot resolve live build evidence'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','68000000-0000-4000-8000-000000000002',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"68000000-0000-4000-8000-000000000002","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT ok(
  public.resolve_training_live_program_build_source(
    '68000000-0000-4000-8000-000000000101',999,'decision:stale'
  ) IS NULL,
  'an unrelated actor receives no stale profile or eligibility detail'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','68000000-0000-4000-8000-000000000001',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"68000000-0000-4000-8000-000000000001","aal":"aal1","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.resolve_training_live_program_build_source(
    '68000000-0000-4000-8000-000000000101',1,NULL
  ) $$,
  '42501','active AAL2 training actor is required',
  'AAL1 cannot resolve live build evidence'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
INSERT INTO public.training_simulation_runs(
  id,subject_id,created_by_user_id,fixture_id,fixture_hash,expires_at
) VALUES (
  '68000000-0000-4000-8000-000000000301',
  '68000000-0000-4000-8000-000000000101',
  '68000000-0000-4000-8000-000000000001',
  'fixture.v1',repeat('a',64),now()+interval '1 hour'
);

SELECT throws_ok($$
  INSERT INTO public.training_program_builds(
    id,subject_id,created_by_user_id,profile_revision,program_revision_id,
    compiler_policy_version,catalog_version,build_json,created_at,expires_at
  ) VALUES (
    '68000000-0000-4000-8000-000000000401',
    '68000000-0000-4000-8000-000000000101',
    '68000000-0000-4000-8000-000000000001',1,'compiled-missing-source',
    'strength-cycle-compiler.v3','authored.v1',
    pg_temp.explicit_eight_week_build('{
      "kind":"draft_program",
      "subjectId":"68000000-0000-4000-8000-000000000101",
      "profileRevisionId":"1",
      "programRevisionId":"compiled-missing-source",
      "compilerPolicyVersion":"strength-cycle-compiler.v3",
      "catalogVersion":"authored.v1",
      "executionContext":{"kind":"live"},
      "catalogOrigin":{"kind":"authored_catalog"}
    }'::jsonb),
    now(),now()+interval '30 minutes'
  )
$$, '23514','new training source evidence is required',
  'new builds cannot use the legacy null/null source shape');

SELECT throws_ok($$
  INSERT INTO public.training_program_builds(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    eligibility_source_revision_id,program_revision_id,
    compiler_policy_version,catalog_version,build_json,created_at,expires_at
  ) VALUES (
    '68000000-0000-4000-8000-000000000402',
    '68000000-0000-4000-8000-000000000101',
    '68000000-0000-4000-8000-000000000001',1,
    '68000000-0000-4000-8000-000000000301','decision:live:1',
    'compiled-mixed-source','strength-cycle-compiler.v3','authored.v1',
    pg_temp.explicit_eight_week_build('{
      "kind":"draft_program",
      "subjectId":"68000000-0000-4000-8000-000000000101",
      "profileRevisionId":"1",
      "programRevisionId":"compiled-mixed-source",
      "compilerPolicyVersion":"strength-cycle-compiler.v3",
      "catalogVersion":"authored.v1",
      "executionContext":{"kind":"live"}
    }'::jsonb),
    now(),now()+interval '30 minutes'
  )
$$, '23514',NULL,
  'a build cannot mix simulation and live eligibility evidence');

SELECT lives_ok($$
  INSERT INTO public.training_program_builds(
    id,subject_id,created_by_user_id,profile_revision,
    eligibility_source_revision_id,program_revision_id,
    compiler_policy_version,catalog_version,build_json,created_at,expires_at
  ) VALUES
  (
    '68000000-0000-4000-8000-000000000403',
    '68000000-0000-4000-8000-000000000101',
    '68000000-0000-4000-8000-000000000001',1,
    'decision:live:1','compiled-live-1','strength-cycle-compiler.v3','authored.v1',
    pg_temp.explicit_eight_week_build('{
      "kind":"draft_program",
      "subjectId":"68000000-0000-4000-8000-000000000101",
      "profileRevisionId":"1",
      "programRevisionId":"compiled-live-1",
      "compilerPolicyVersion":"strength-cycle-compiler.v3",
      "catalogVersion":"authored.v1",
      "executionContext":{"kind":"live"},
      "catalogOrigin":{"kind":"authored_catalog"}
    }'::jsonb),
    now(),now()+interval '30 minutes'
  ),
  (
    '68000000-0000-4000-8000-000000000404',
    '68000000-0000-4000-8000-000000000101',
    '68000000-0000-4000-8000-000000000001',1,
    'decision:live:1','compiled-live-2','strength-cycle-compiler.v3','authored.v1',
    pg_temp.explicit_eight_week_build('{
      "kind":"draft_program",
      "subjectId":"68000000-0000-4000-8000-000000000101",
      "profileRevisionId":"1",
      "programRevisionId":"compiled-live-2",
      "compilerPolicyVersion":"strength-cycle-compiler.v3",
      "catalogVersion":"authored.v1",
      "executionContext":{"kind":"live"},
      "catalogOrigin":{"kind":"authored_catalog"}
    }'::jsonb),
    now(),now()+interval '30 minutes'
  )
$$, 'new live builds persist their exact eligibility evidence');

SELECT throws_ok($$
  INSERT INTO public.training_program_builds(
    id,subject_id,created_by_user_id,profile_revision,
    eligibility_source_revision_id,program_revision_id,
    compiler_policy_version,catalog_version,build_json,created_at,expires_at
  )
  SELECT
    '68000000-0000-4000-8000-000000000409',subject_id,created_by_user_id,
    profile_revision,eligibility_source_revision_id,'promoted-synthetic-catalog',
    compiler_policy_version,catalog_version,
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        build_json,
        '{programRevisionId}',
        '"promoted-synthetic-catalog"'::jsonb
      ),
      '{catalogOrigin}',
      '{"kind":"synthetic_fixture"}'::jsonb
    ),
    now(),now()+interval '30 minutes'
  FROM public.training_program_builds
  WHERE id = '68000000-0000-4000-8000-000000000403'
$$, '23514','live training evidence has invalid provenance',
  'a synthetic catalog cannot be relabeled as a live build source');

SELECT lives_ok($$
  INSERT INTO public.training_program_builds(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    program_revision_id,compiler_policy_version,catalog_version,
    build_json,created_at,expires_at
  ) VALUES (
    '68000000-0000-4000-8000-000000000405',
    '68000000-0000-4000-8000-000000000101',
    '68000000-0000-4000-8000-000000000001',1,
    '68000000-0000-4000-8000-000000000301',
    'compiled-simulation-1','strength-cycle-compiler.v3','fixture.v1',
    pg_temp.explicit_eight_week_build('{
      "kind":"draft_program",
      "subjectId":"68000000-0000-4000-8000-000000000101",
      "profileRevisionId":"1",
      "programRevisionId":"compiled-simulation-1",
      "compilerPolicyVersion":"strength-cycle-compiler.v3",
      "catalogVersion":"fixture.v1",
      "executionContext":{
        "kind":"synthetic_simulation",
        "simulationRunId":"68000000-0000-4000-8000-000000000301"
      }
    }'::jsonb),
    now(),now()+interval '30 minutes'
  )
$$, 'the existing simulation build branch remains accepted');

SELECT lives_ok($$
  INSERT INTO public.training_program_drafts(
    id,subject_id,created_by_user_id,profile_revision,
    eligibility_source_revision_id,source_build_id,selection_hash,
    program_json,created_at,expires_at
  ) VALUES (
    '68000000-0000-4000-8000-000000000501',
    '68000000-0000-4000-8000-000000000101',
    '68000000-0000-4000-8000-000000000001',1,
    'decision:live:1','68000000-0000-4000-8000-000000000403',repeat('b',64),
    '{
      "schemaVersion":"training-program-revision.v1",
      "assignmentId":"live-assignment-1",
      "revisionNumber":1,
      "subjectId":"68000000-0000-4000-8000-000000000101",
      "programMode":"self_directed",
      "owningPractitionerId":null,
      "executionContext":{"kind":"live"},
      "cycleLengthWeeks":8,
      "profileRevisionId":"1",
      "eligibilitySourceRevisionId":"decision:live:1",
      "compilerPolicyVersion":"strength-cycle-compiler.v3",
      "catalogVersion":"authored.v1",
      "catalogOrigin":{"kind":"authored_catalog"},
      "compiledProgramRevisionId":"compiled-live-1",
      "author":{"kind":"athlete","userId":"68000000-0000-4000-8000-000000000001"},
      "sessions":[{
        "sessionId":"live-session-1",
        "scheduledLocalDate":"2026-09-09",
        "athleteTimezone":"UTC",
        "exercises":[]
      }],
      "conditioningBouts":[]
    }'::jsonb,
    now(),now()+interval '30 minutes'
  )
$$, 'acceptance persists the exact build/profile/eligibility tuple');

SELECT throws_ok($$
  INSERT INTO public.training_program_drafts(
    id,subject_id,created_by_user_id,profile_revision,
    eligibility_source_revision_id,source_build_id,selection_hash,
    program_json,created_at,expires_at
  )
  SELECT
    '68000000-0000-4000-8000-000000000502',subject_id,created_by_user_id,
    profile_revision,eligibility_source_revision_id,
    '68000000-0000-4000-8000-000000000404',repeat('c',64),
    pg_catalog.jsonb_set(
      program_json,
      '{compiledProgramRevisionId}',
      '"not-the-source-build"'::jsonb
    ),
    now(),now()+interval '30 minutes'
  FROM public.training_program_drafts
  WHERE id = '68000000-0000-4000-8000-000000000501'
$$, '23514','accepted training draft does not match its source build',
  'a draft cannot change the build identity during acceptance');

SELECT lives_ok($$
  INSERT INTO public.training_program_drafts(
    id,subject_id,created_by_user_id,profile_revision,simulation_run_id,
    source_build_id,selection_hash,program_json,created_at,expires_at
  ) VALUES (
    '68000000-0000-4000-8000-000000000503',
    '68000000-0000-4000-8000-000000000101',
    '68000000-0000-4000-8000-000000000001',1,
    '68000000-0000-4000-8000-000000000301',
    '68000000-0000-4000-8000-000000000405',repeat('d',64),
    '{
      "schemaVersion":"training-program-revision.v1",
      "assignmentId":"simulation-assignment-1",
      "revisionNumber":1,
      "subjectId":"68000000-0000-4000-8000-000000000101",
      "programMode":"self_directed",
      "owningPractitionerId":null,
      "executionContext":{
        "kind":"synthetic_simulation",
        "simulationRunId":"68000000-0000-4000-8000-000000000301"
      },
      "cycleLengthWeeks":8,
      "profileRevisionId":"1",
      "eligibilitySourceRevisionId":"simulation:fixture",
      "compilerPolicyVersion":"strength-cycle-compiler.v3",
      "catalogVersion":"fixture.v1",
      "catalogOrigin":{"kind":"synthetic_fixture"},
      "compiledProgramRevisionId":"compiled-simulation-1",
      "author":{"kind":"athlete","userId":"68000000-0000-4000-8000-000000000001"},
      "sessions":[{}]
    }'::jsonb,
    now(),now()+interval '30 minutes'
  )
$$, 'the existing simulation acceptance branch remains accepted');

INSERT INTO public.training_program_builds(
  id,subject_id,created_by_user_id,profile_revision,
  eligibility_source_revision_id,program_revision_id,
  compiler_policy_version,catalog_version,build_json,created_at,expires_at
)
SELECT
  '68000000-0000-4000-8000-00000000040a',subject_id,
  '68000000-0000-4000-8000-000000000003',profile_revision,
  eligibility_source_revision_id,'compiled-live-coach-owned',
  compiler_policy_version,catalog_version,
  pg_catalog.jsonb_set(
    build_json,
    '{programRevisionId}',
    '"compiled-live-coach-owned"'::jsonb
  ),
  now(),now()+interval '30 minutes'
FROM public.training_program_builds
WHERE id = '68000000-0000-4000-8000-000000000403';

INSERT INTO public.training_program_drafts(
  id,subject_id,created_by_user_id,profile_revision,
  eligibility_source_revision_id,source_build_id,selection_hash,
  program_json,created_at,expires_at
)
SELECT
  '68000000-0000-4000-8000-00000000050a',subject_id,
  '68000000-0000-4000-8000-000000000003',profile_revision,
  eligibility_source_revision_id,
  '68000000-0000-4000-8000-00000000040a',repeat('a',64),
  program_json || pg_catalog.jsonb_build_object(
    'assignmentId','live-assignment-coach-owned',
    'programMode','coach_assigned',
    'owningPractitionerId','68000000-0000-4000-8000-000000000003',
    'compiledProgramRevisionId','compiled-live-coach-owned',
    'author',pg_catalog.jsonb_build_object(
      'kind','coach','userId','68000000-0000-4000-8000-000000000003'
    )
  ),
  now(),now()+interval '30 minutes'
FROM public.training_program_drafts
WHERE id = '68000000-0000-4000-8000-000000000501';

RESET ROLE;

SELECT set_config('request.jwt.claim.sub','68000000-0000-4000-8000-000000000001',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"68000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.publish_training_program_draft(
    '68000000-0000-4000-8000-00000000050a'
  ) $$,
  'P0001','training draft is unavailable',
  'the subject owner cannot publish a coach-authored coach-assigned draft'
);
SELECT is_empty(
  $$ SELECT id FROM public.training_program_assignments
     WHERE id = 'live-assignment-coach-owned' $$,
  'denied coach-owned publication leaves no partial assignment'
);
RESET ROLE;

SET LOCAL session_replication_role = replica;
SELECT lives_ok($$
  INSERT INTO public.training_program_builds(
    id,subject_id,created_by_user_id,profile_revision,program_revision_id,
    compiler_policy_version,catalog_version,build_json,created_at,expires_at
  ) VALUES (
    '68000000-0000-4000-8000-000000000406',
    '68000000-0000-4000-8000-000000000101',
    '68000000-0000-4000-8000-000000000001',1,'legacy-live-build',
    'eight-week-compiler.v2','legacy-authored.v1',
    '{
      "kind":"draft_program",
      "subjectId":"68000000-0000-4000-8000-000000000101",
      "profileRevisionId":"1",
      "programRevisionId":"legacy-live-build",
      "compilerPolicyVersion":"eight-week-compiler.v2",
      "catalogVersion":"legacy-authored.v1",
      "executionContext":{"kind":"live"},
      "weeks":[
        {"week":1},{"week":2},{"week":3},{"week":4},
        {"week":5},{"week":6},{"week":7},{"week":8}
      ]
    }'::jsonb,
    now(),now()+interval '30 minutes'
  )
$$, 'the additive constraints preserve a pre-48000 null/null build row');
SET LOCAL session_replication_role = origin;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;

SELECT lives_ok($$
  SELECT * FROM public.record_training_eligibility_decision(
    '68000000-0000-4000-8000-000000000101','decision:live:1',
    '{
      "schemaVersion":"eligibility-decision.v1",
      "sourceRevisionId":"decision:live:2",
      "answersRevisionId":"answers:live:1",
      "answersSchemaVersion":"eligibility-answers.v1",
      "questionnaireSourceVersion":"preparticipation-inputs.v1-unvalidated",
      "policyVersion":"reviewed-policy.v2",
      "state":"eligible_general",
      "scope":"supported",
      "source":{
        "kind":"policy_service",
        "sourceVersion":"eligibility-policy-service.v1",
        "evaluatedAt":"2026-09-08T12:02:00Z"
      },
      "effectiveFrom":"2020-01-02T00:00:00Z",
      "effectiveUntil":"2099-01-01T00:00:00Z",
      "supersededAt":null,
      "constraintSet":null
    }'::jsonb
  )
$$, 'a later authoritative decision advances the current pointer');

INSERT INTO public.training_program_builds(
  id,subject_id,created_by_user_id,profile_revision,
  eligibility_source_revision_id,program_revision_id,
  compiler_policy_version,catalog_version,build_json,created_at,expires_at
)
SELECT
  '68000000-0000-4000-8000-000000000407',subject_id,created_by_user_id,
  profile_revision,'decision:live:2','compiled-live-current',
  compiler_policy_version,catalog_version,
  pg_catalog.jsonb_set(
    build_json,
    '{programRevisionId}',
    '"compiled-live-current"'::jsonb
  ),
  now(),now()+interval '30 minutes'
FROM public.training_program_builds
WHERE id = '68000000-0000-4000-8000-000000000403';

INSERT INTO public.training_program_drafts(
  id,subject_id,created_by_user_id,profile_revision,
  eligibility_source_revision_id,source_build_id,selection_hash,
  program_json,created_at,expires_at
)
SELECT
  '68000000-0000-4000-8000-000000000505',subject_id,created_by_user_id,
  profile_revision,'decision:live:2',
  '68000000-0000-4000-8000-000000000407',repeat('f',64),
  pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        program_json,
        '{assignmentId}',
        '"live-assignment-current"'::jsonb
      ),
      '{compiledProgramRevisionId}',
      '"compiled-live-current"'::jsonb
    ),
    '{eligibilitySourceRevisionId}',
    '"decision:live:2"'::jsonb
  ),
  now(),now()+interval '30 minutes'
FROM public.training_program_drafts
WHERE id = '68000000-0000-4000-8000-000000000501';
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','68000000-0000-4000-8000-000000000001',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"68000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.resolve_training_live_program_build_source(
    '68000000-0000-4000-8000-000000000101',1,'decision:live:1'
  ) $$,
  'PT409','training eligibility changed concurrently',
  'an accepted caller revision fails closed after eligibility supersession'
);
SELECT is(
  public.resolve_training_live_program_build_source(
    '68000000-0000-4000-8000-000000000101',1,NULL
  )->>'eligibilitySourceRevisionId',
  'decision:live:2',
  'resolution without an expected revision returns only the new current decision'
);
SELECT lives_ok($$
  SELECT * FROM public.append_training_eligibility_response(
    '68000000-0000-4000-8000-000000000101',1,'answers:live:2',
    '{
      "schemaVersion":"eligibility-answers.v1",
      "questionnaireSourceVersion":"preparticipation-inputs.v1-unvalidated",
      "submittedAt":"2026-09-08T12:03:00Z",
      "origin":{"kind":"athlete_self_report"},
      "adultScope":"confirmed_18_plus",
      "currentActivity":"regularly_active",
      "knownConditions":{"cardiovascular":"no","metabolic":"no","renal":"no"},
      "relevantSignsOrSymptoms":"yes",
      "desiredIntensity":"moderate",
      "answerCertainty":"complete",
      "pregnancyPostpartumContext":"pregnant",
      "requestedProgrammingScope":"strength_or_general_fitness"
    }'::jsonb
  )
$$, 'a new self-report appends evidence without inventing a decision');
SELECT ok(
  public.resolve_training_live_program_build_source(
    '68000000-0000-4000-8000-000000000101',1,'decision:live:2'
  ) IS NULL,
  'new answers invalidate an older decision even before its pointer changes'
);
SELECT throws_ok(
  $$ SELECT public.publish_training_program_draft(
    '68000000-0000-4000-8000-000000000501'
  ) $$,
  'PT409','training eligibility changed concurrently',
  'publication revalidates and rejects a stale accepted draft'
);
SELECT throws_ok(
  $$ SELECT public.publish_training_program_draft(
    '68000000-0000-4000-8000-000000000505'
  ) $$,
  'P0001','current training eligibility is unavailable',
  'publication rejects a once-current decision after a newer answer arrives'
);
SELECT results_eq(
  'SELECT count(*) FROM public.training_program_assignments',
  'VALUES (0::bigint)',
  'stale publication leaves no partial assignment'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT throws_ok($$
  INSERT INTO public.training_program_drafts(
    id,subject_id,created_by_user_id,profile_revision,
    eligibility_source_revision_id,source_build_id,selection_hash,
    program_json,created_at,expires_at
  )
  SELECT
    '68000000-0000-4000-8000-000000000504',subject_id,created_by_user_id,
    profile_revision,eligibility_source_revision_id,
    '68000000-0000-4000-8000-000000000404',repeat('e',64),
    pg_catalog.jsonb_set(
      program_json,
      '{compiledProgramRevisionId}',
      '"compiled-live-2"'::jsonb
    ),
    now(),now()+interval '30 minutes'
  FROM public.training_program_drafts
  WHERE id = '68000000-0000-4000-8000-000000000501'
$$, 'PT409','training source evidence changed concurrently',
  'acceptance revalidates and rejects a build compiled under stale eligibility');

SELECT throws_ok($$
  INSERT INTO public.training_program_builds(
    id,subject_id,created_by_user_id,profile_revision,
    eligibility_source_revision_id,program_revision_id,
    compiler_policy_version,catalog_version,build_json,created_at,expires_at
  )
  SELECT
    '68000000-0000-4000-8000-000000000408',subject_id,created_by_user_id,
    profile_revision,eligibility_source_revision_id,'compiled-after-new-answers',
    compiler_policy_version,catalog_version,
    pg_catalog.jsonb_set(
      build_json,
      '{programRevisionId}',
      '"compiled-after-new-answers"'::jsonb
    ),
    now(),now()+interval '30 minutes'
  FROM public.training_program_builds
  WHERE id = '68000000-0000-4000-8000-000000000407'
$$, 'PT409','training source evidence changed concurrently',
  'build persistence rejects a decision that no longer covers the latest answers');

SELECT throws_ok($$
  INSERT INTO public.training_program_drafts(
    id,subject_id,created_by_user_id,profile_revision,
    eligibility_source_revision_id,source_build_id,selection_hash,
    program_json,created_at,expires_at
  )
  SELECT
    '68000000-0000-4000-8000-000000000506',subject_id,created_by_user_id,
    profile_revision,eligibility_source_revision_id,source_build_id,repeat('9',64),
    pg_catalog.jsonb_set(
      program_json,
      '{assignmentId}',
      '"live-assignment-after-new-answers"'::jsonb
    ),
    now(),now()+interval '30 minutes'
  FROM public.training_program_drafts
  WHERE id = '68000000-0000-4000-8000-000000000505'
$$, 'PT409','training source evidence changed concurrently',
  'acceptance rejects a decision that no longer covers the latest answers');

SELECT lives_ok($$
  SELECT * FROM public.record_training_eligibility_decision(
    '68000000-0000-4000-8000-000000000101','decision:live:2',
    '{
      "schemaVersion":"eligibility-decision.v1",
      "sourceRevisionId":"decision:synthetic:3",
      "answersRevisionId":"answers:live:2",
      "answersSchemaVersion":"eligibility-answers.v1",
      "questionnaireSourceVersion":"preparticipation-inputs.v1-unvalidated",
      "policyVersion":"synthetic-policy.v1",
      "state":"unanswered",
      "scope":"supported",
      "source":{
        "kind":"synthetic_fixture",
        "sourceVersion":"synthetic-eligibility-fixture.v1",
        "fixtureId":"synthetic-live-gate.v1",
        "label":"Synthetic eligibility test fixture"
      },
      "effectiveFrom":"2020-01-03T00:00:00Z",
      "effectiveUntil":"2099-01-01T00:00:00Z",
      "supersededAt":null,
      "constraintSet":null
    }'::jsonb
  )
$$, 'a labeled synthetic decision can become current evidence without live authority');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','68000000-0000-4000-8000-000000000001',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"68000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT ok(
  public.resolve_training_live_program_build_source(
    '68000000-0000-4000-8000-000000000101',1,NULL
  ) IS NULL,
  'synthetic or unanswered current eligibility never resolves as live authority'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

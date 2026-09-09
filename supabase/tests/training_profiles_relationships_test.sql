BEGIN;

SELECT plan(65);

SELECT has_table('public', 'training_profile_revisions', 'profile revisions are persisted');
SELECT has_table('public', 'training_eligibility_responses', 'eligibility answers are persisted separately');
SELECT has_table('public', 'training_eligibility_decisions', 'authoritative eligibility decisions are persisted separately');
SELECT has_table('public', 'coaching_relationships', 'coaching authority is persisted explicitly');

SELECT columns_are(
  'public',
  'training_profile_revisions',
  ARRAY[
    'subject_id', 'revision', 'schema_version', 'profile_json', 'profile_hash',
    'hash_encoding', 'created_by_user_id', 'created_at'
  ],
  'profile revision storage has an exact, provenance-preserving shape'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'training_subjects'
      AND column_name = 'current_profile_revision'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'training_subjects'
      AND column_name = 'current_eligibility_decision_source_revision_id'
  ),
  'the subject has explicit current profile and eligibility pointers'
);

SELECT ok(
  (
    SELECT pg_catalog.bool_and(c.relrowsecurity)
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'training_profile_revisions', 'training_eligibility_responses',
        'training_eligibility_decisions', 'coaching_relationships'
      )
  ),
  'all four new tables enable RLS'
);

SELECT ok(
  pg_catalog.to_regprocedure(
    'public.append_training_profile_revision(uuid,bigint,jsonb)'
  ) IS NOT NULL
  AND pg_catalog.to_regprocedure(
    'public.append_training_eligibility_response(uuid,bigint,text,jsonb)'
  ) IS NOT NULL
  AND pg_catalog.to_regprocedure(
    'public.record_training_eligibility_decision(uuid,text,jsonb)'
  ) IS NOT NULL
  AND pg_catalog.to_regprocedure(
    'public.revoke_training_coaching_relationship(uuid,bigint)'
  ) IS NOT NULL,
  'transactional evidence and revocation writers exist'
);

SELECT ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.training_profile_revisions', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.training_eligibility_responses', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.training_eligibility_decisions', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.coaching_relationships', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.coaching_relationships', 'UPDATE')
  AND NOT pg_catalog.has_table_privilege('service_role', 'public.training_profile_revisions', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('service_role', 'public.training_eligibility_responses', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('service_role', 'public.training_eligibility_decisions', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('service_role', 'public.coaching_relationships', 'INSERT'),
  'direct evidence and relationship writes are revoked from application roles'
);

SELECT ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.append_training_profile_revision(uuid,bigint,jsonb)', 'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'authenticated', 'public.append_training_eligibility_response(uuid,bigint,text,jsonb)', 'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'authenticated', 'public.revoke_training_coaching_relationship(uuid,bigint)', 'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'authenticated', 'public.record_training_eligibility_decision(uuid,text,jsonb)', 'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'service_role', 'public.record_training_eligibility_decision(uuid,text,jsonb)', 'EXECUTE'
  ),
  'RPC grants separate subject writes from authoritative decision writes'
);

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email, created_at, updated_at)
VALUES
  (
    '41000000-0000-4000-8000-000000000001',
    'assigned-coach-fixture@example.invalid',
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  ),
  (
    '41000000-0000-4000-8000-000000000002',
    'read-coach-fixture@example.invalid',
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  ),
  (
    '43000000-0000-4000-8000-000000000001',
    'owner-fixture@example.invalid',
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  ),
  (
    '43000000-0000-4000-8000-000000000002',
    'other-owner-fixture@example.invalid',
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  );

INSERT INTO public.practitioners (
  id, display_name, access_status, role, session_valid_after
) VALUES
  (
    '41000000-0000-4000-8000-000000000001',
    'Assigned coach fixture',
    'active',
    'practitioner',
    '-infinity'
  ),
  (
    '41000000-0000-4000-8000-000000000002',
    'Read only coach fixture',
    'active',
    'practitioner',
    '-infinity'
  );

INSERT INTO public.training_subjects (
  id, owner_user_id, status, activated_at
) VALUES
  (
    '42000000-0000-4000-8000-000000000001',
    '43000000-0000-4000-8000-000000000001',
    'active',
    pg_catalog.clock_timestamp()
  ),
  (
    '42000000-0000-4000-8000-000000000002',
    '43000000-0000-4000-8000-000000000002',
    'active',
    pg_catalog.clock_timestamp()
  );
SET LOCAL session_replication_role = origin;

INSERT INTO public.coaching_relationships (
  id, subject_id, practitioner_id, status, permissions, started_at, revision
) VALUES
  (
    '44000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '41000000-0000-4000-8000-000000000001',
    'active',
    ARRAY[
      'subject:read', 'profile:read', 'profile:write', 'program:coach_publish',
      'session:read', 'history:read', 'relationship:revoke'
    ]::public.training_coach_permission[],
    pg_catalog.clock_timestamp(),
    1
  ),
  (
    '44000000-0000-4000-8000-000000000002',
    '42000000-0000-4000-8000-000000000001',
    '41000000-0000-4000-8000-000000000002',
    'active',
    ARRAY['subject:read', 'profile:read']::public.training_coach_permission[],
    pg_catalog.clock_timestamp(),
    1
  ),
  (
    '44000000-0000-4000-8000-000000000003',
    '42000000-0000-4000-8000-000000000002',
    '41000000-0000-4000-8000-000000000001',
    'active',
    ARRAY['subject:read', 'relationship:revoke']::public.training_coach_permission[],
    pg_catalog.clock_timestamp(),
    1
  );

SELECT set_config('request.jwt.claim.sub', '43000000-0000-4000-8000-000000000001', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"43000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$
    INSERT INTO public.training_profile_revisions (
      subject_id, revision, schema_version, profile_json, profile_hash,
      created_by_user_id
    ) VALUES (
      '42000000-0000-4000-8000-000000000001',
      99,
      'athlete-training-profile.v1',
      '{}'::jsonb,
      repeat('0', 64),
      '43000000-0000-4000-8000-000000000001'
    )
  $$,
  '42501',
  NULL,
  'authenticated actors cannot bypass the validated profile RPC with direct insert'
);

SELECT results_eq(
  $$
    SELECT revision, profile_hash ~ '^[0-9a-f]{64}$', hash_encoding
    FROM public.append_training_profile_revision(
      '42000000-0000-4000-8000-000000000001',
      0,
      '{
        "schemaVersion":"athlete-training-profile.v1",
        "origin":{"kind":"athlete_input"},
        "goal":"strength",
        "experience":"beginner",
        "recentConsistency":"intermittent",
        "cycleLengthWeeks":8,
        "strengthDays":["monday","wednesday","friday"],
        "localTimezone":"America/Los_Angeles",
        "sessionTimeBudgetMinutes":45,
        "preferredLoadUnit":"kg",
        "equipmentInventory":[],
        "startingHistory":[]
      }'::jsonb
    )
  $$,
  $$ VALUES (1::bigint, true, 'postgres-jsonb-text-utf8.v1'::text) $$,
  'an AAL2 owner appends the first profile revision transactionally'
);

SELECT is(
  (
    SELECT current_profile_revision
    FROM public.training_subjects
    WHERE id = '42000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'profile append advances the subject pointer in the same transaction'
);

SELECT throws_ok(
  $$
    SELECT * FROM public.append_training_profile_revision(
      '42000000-0000-4000-8000-000000000001',
      0,
      '{"schemaVersion":"athlete-training-profile.v1"}'::jsonb
    )
  $$,
  'PT409',
  NULL,
  'a stale profile revision cannot overwrite the current pointer'
);

SELECT throws_ok(
  $$
    SELECT * FROM public.append_training_profile_revision(
      '42000000-0000-4000-8000-000000000001',
      1,
      '{"schemaVersion":"athlete-training-profile.v1"}'::jsonb
    )
  $$,
  '22023',
  NULL,
  'the persistence boundary rejects an incomplete profile contract'
);

SELECT results_eq(
  $$
    SELECT revision, source_revision_id
    FROM public.append_training_eligibility_response(
      '42000000-0000-4000-8000-000000000001',
      0,
      'answers:owner:1',
      '{
        "schemaVersion":"eligibility-answers.v1",
        "questionnaireSourceVersion":"preparticipation-inputs.v1-unvalidated",
        "submittedAt":"2026-09-07T20:00:00Z",
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
  $$,
  $$ VALUES (1::bigint, 'answers:owner:1'::text) $$,
  'the owner appends eligibility answers without deriving a decision'
);

SELECT ok(
  (
    SELECT answers_json->>'pregnancyPostpartumContext' = 'pregnant'
    FROM public.training_eligibility_responses
    WHERE subject_id = '42000000-0000-4000-8000-000000000001'
      AND revision = 1
  )
  AND (
    SELECT current_eligibility_decision_source_revision_id IS NULL
    FROM public.training_subjects
    WHERE id = '42000000-0000-4000-8000-000000000001'
  ),
  'pregnancy context is preserved and does not create blanket exclusion or clearance'
);

SELECT throws_ok(
  $$
    SELECT * FROM public.append_training_eligibility_response(
      '42000000-0000-4000-8000-000000000001',
      1,
      'answers:incomplete:2',
      '{
        "schemaVersion":"eligibility-answers.v1",
        "questionnaireSourceVersion":"preparticipation-inputs.v1-unvalidated",
        "submittedAt":"2026-09-07T20:01:00Z",
        "origin":{"kind":"athlete_self_report"},
        "adultScope":"confirmed_18_plus",
        "pregnancyPostpartumContext":"none_reported"
      }'::jsonb
    )
  $$,
  '22023',
  NULL,
  'the persistence boundary rejects an incomplete eligibility answer contract'
);

SELECT throws_ok(
  $$
    SELECT * FROM public.append_training_eligibility_response(
      '42000000-0000-4000-8000-000000000001',
      1,
      'answers:owner:2',
      '{
        "schemaVersion":"eligibility-answers.v1",
        "questionnaireSourceVersion":"unknown-questionnaire.v9",
        "submittedAt":"2026-09-07T20:01:00Z",
        "origin":{"kind":"athlete_self_report"},
        "adultScope":"minor",
        "pregnancyPostpartumContext":"unknown"
      }'::jsonb
    )
  $$,
  '22023',
  NULL,
  'unknown questionnaire source versions fail closed'
);

SELECT results_eq(
  $$
    SELECT revision, source_revision_id
    FROM public.append_training_eligibility_response(
      '42000000-0000-4000-8000-000000000001',
      1,
      'answers:owner:2',
      '{
        "schemaVersion":"eligibility-answers.v1",
        "questionnaireSourceVersion":"preparticipation-inputs.v1-unvalidated",
        "submittedAt":"2026-09-07T20:05:00Z",
        "origin":{"kind":"athlete_self_report"},
        "adultScope":"confirmed_18_plus",
        "currentActivity":"regularly_active",
        "knownConditions":{"cardiovascular":"no","metabolic":"no","renal":"no"},
        "relevantSignsOrSymptoms":"no",
        "desiredIntensity":"moderate",
        "answerCertainty":"complete",
        "pregnancyPostpartumContext":"none_reported",
        "requestedProgrammingScope":"strength_or_general_fitness"
      }'::jsonb
    )
  $$,
  $$ VALUES (2::bigint, 'answers:owner:2'::text) $$,
  'a second exact answer revision can be appended for supersession evidence'
);

RESET ROLE;

SELECT ok(
  NOT private.is_valid_training_profile(
    (SELECT profile_json FROM public.training_profile_revisions
      WHERE subject_id = '42000000-0000-4000-8000-000000000001' AND revision = 1)
    || '{"localTimezone":"PST"}'::jsonb
  ),
  'the at-rest validator rejects non-IANA timezone abbreviations'
);

SELECT ok(
  NOT private.is_valid_training_profile(pg_catalog.jsonb_set(
    (SELECT profile_json FROM public.training_profile_revisions
      WHERE subject_id = '42000000-0000-4000-8000-000000000001' AND revision = 1),
    '{strengthDays}', '["monday","monday"]'::jsonb
  )),
  'the at-rest validator rejects duplicate training days'
);

SELECT ok(
  NOT private.is_valid_training_profile(pg_catalog.jsonb_set(
    (SELECT profile_json FROM public.training_profile_revisions
      WHERE subject_id = '42000000-0000-4000-8000-000000000001' AND revision = 1),
    '{cycleLengthWeeks}', '"8"'::jsonb
  )),
  'the at-rest validator distinguishes numeric cycle values from strings'
);

SELECT ok(
  NOT private.is_valid_training_profile(
    (SELECT profile_json FROM public.training_profile_revisions
      WHERE subject_id = '42000000-0000-4000-8000-000000000001' AND revision = 1)
    || '{"scanScore":92}'::jsonb
  ),
  'the at-rest validator rejects unknown profile keys'
);

SELECT ok(
  private.is_valid_training_profile('{
    "schemaVersion":"athlete-training-profile.v1",
    "origin":{"kind":"athlete_input"},
    "goal":"strength",
    "experience":"beginner",
    "recentConsistency":"intermittent",
    "cycleLengthWeeks":8,
    "strengthDays":["monday","thursday"],
    "localTimezone":"UTC",
    "sessionTimeBudgetMinutes":45,
    "preferredLoadUnit":"kg",
    "equipmentInventory":[{
      "kind":"dumbbell","equipmentId":"db-home","unit":"kg",
      "perHandLoads":["10","12.5"]
    }],
    "startingHistory":[{
      "exerciseVersionId":"goblet-squat.v1","performedAt":null,
      "equipmentLoad":{"equipmentId":"db-home","basis":"dumbbell_single_implement","quantity":{"entered":{"value":"10","unit":"kg"},"canonicalKg":"10"}},
      "reps":8,
      "source":{"kind":"recalled","sourceVersion":"athlete-recall.v1","capturedAt":"2026-09-07T18:00:00Z"},
      "progressionEvidenceEligible":false
    }]
  }'::jsonb),
  'the at-rest validator accepts UTC and a labeled single dumbbell load basis'
);

SELECT ok(
  NOT private.is_valid_training_profile(pg_catalog.jsonb_set(
    (SELECT profile_json FROM public.training_profile_revisions
      WHERE subject_id = '42000000-0000-4000-8000-000000000001' AND revision = 1),
    '{equipmentInventory}', '[{"kind":"barbell","equipmentId":"bar","unit":"kg","barWeight":"1000.001","collarsTotalWeight":"0","plates":[]}]'::jsonb
  )),
  'the at-rest validator rejects an over-1000kg bar weight'
);

SELECT ok(
  NOT private.is_valid_training_profile(pg_catalog.jsonb_set(
    (SELECT profile_json FROM public.training_profile_revisions
      WHERE subject_id = '42000000-0000-4000-8000-000000000001' AND revision = 1),
    '{equipmentInventory}', '[{"kind":"barbell","equipmentId":"bar","unit":"kg","barWeight":"20","collarsTotalWeight":"1000.001","plates":[]}]'::jsonb
  )),
  'the at-rest validator rejects an over-1000kg collar weight'
);

SELECT ok(
  NOT private.is_valid_training_profile(pg_catalog.jsonb_set(
    (SELECT profile_json FROM public.training_profile_revisions
      WHERE subject_id = '42000000-0000-4000-8000-000000000001' AND revision = 1),
    '{equipmentInventory}', '[{"kind":"barbell","equipmentId":"bar","unit":"kg","barWeight":"20","collarsTotalWeight":"0","plates":[{"value":"1000.001","count":2}]}]'::jsonb
  )),
  'the at-rest validator rejects an over-1000kg plate denomination'
);

SELECT ok(
  NOT private.is_valid_training_profile(pg_catalog.jsonb_set(
    (SELECT profile_json FROM public.training_profile_revisions
      WHERE subject_id = '42000000-0000-4000-8000-000000000001' AND revision = 1),
    '{equipmentInventory}', '[{"kind":"dumbbell","equipmentId":"db","unit":"kg","perHandLoads":["1000.001"]}]'::jsonb
  )),
  'the at-rest validator rejects an over-1000kg dumbbell denomination'
);

SELECT ok(
  NOT private.is_valid_training_profile(pg_catalog.jsonb_set(
    (SELECT profile_json FROM public.training_profile_revisions
      WHERE subject_id = '42000000-0000-4000-8000-000000000001' AND revision = 1),
    '{equipmentInventory}', '[{"kind":"machine","equipmentId":"machine","unit":"kg","stackLoads":["1000.001"]}]'::jsonb
  )),
  'the at-rest validator rejects an over-1000kg machine denomination'
);

SELECT ok(
  NOT private.is_valid_training_profile(pg_catalog.jsonb_set(
    (SELECT profile_json FROM public.training_profile_revisions
      WHERE subject_id = '42000000-0000-4000-8000-000000000001' AND revision = 1),
    '{equipmentInventory}', '[{"kind":"machine","equipmentId":"machine","unit":"lb","stackLoads":["2204.624"]}]'::jsonb
  )),
  'the at-rest validator rejects an over-1000kg pound denomination after canonical conversion'
);

SELECT ok(
  NOT private.is_valid_training_answers(
    (SELECT answers_json FROM public.training_eligibility_responses
      WHERE subject_id = '42000000-0000-4000-8000-000000000001' AND revision = 1)
    || '{"state":"eligible_general"}'::jsonb
  ),
  'the at-rest answer validator rejects decision-shaped extra keys'
);

SELECT ok(
  (SELECT profile_hash = private.training_evidence_sha256(profile_json)
      AND hash_encoding = 'postgres-jsonb-text-utf8.v1'
   FROM public.training_profile_revisions
   WHERE subject_id = '42000000-0000-4000-8000-000000000001' AND revision = 1),
  'the stored profile hash is computed from the documented database encoding'
);

SELECT set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000001', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"41000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$ SELECT id FROM public.training_subjects ORDER BY id $$,
  $$ VALUES
    ('42000000-0000-4000-8000-000000000001'::uuid),
    ('42000000-0000-4000-8000-000000000002'::uuid)
  $$,
  'an active AAL2 coach reads only explicitly related subjects'
);

SELECT results_eq(
  $$ SELECT revision FROM public.training_profile_revisions ORDER BY revision $$,
  $$ VALUES (1::bigint) $$,
  'an active coach with profile read permission sees profile evidence'
);

SELECT is_empty(
  $$ SELECT source_revision_id FROM public.training_eligibility_responses $$,
  'ordinary coach permissions do not reveal athlete answer evidence'
);

SELECT results_eq(
  $$
    SELECT revision, profile_hash ~ '^[0-9a-f]{64}$', hash_encoding
    FROM public.append_training_profile_revision(
      '42000000-0000-4000-8000-000000000001',
      1,
      '{
        "schemaVersion":"athlete-training-profile.v1",
        "origin":{"kind":"athlete_input"},
        "goal":"strength",
        "experience":"beginner",
        "recentConsistency":"intermittent",
        "cycleLengthWeeks":8,
        "strengthDays":["monday","wednesday","friday"],
        "localTimezone":"America/Los_Angeles",
        "sessionTimeBudgetMinutes":45,
        "preferredLoadUnit":"kg",
        "equipmentInventory":[],
        "startingHistory":[]
      }'::jsonb
    )
  $$,
  $$ VALUES (2::bigint, true, 'postgres-jsonb-text-utf8.v1'::text) $$,
  'a permissioned coach may append a profile revision'
);

SELECT throws_ok(
  $$ SELECT * FROM public.revoke_training_coaching_relationship(
    '44000000-0000-4000-8000-000000000002', 1
  ) $$,
  'P0001',
  'relationship revocation is not authorized',
  'a permissioned coach cannot revoke a different coach on the same subject'
);

SELECT results_eq(
  $$
    SELECT status::text, revision
    FROM public.revoke_training_coaching_relationship(
      '44000000-0000-4000-8000-000000000003', 1
    )
  $$,
  $$ VALUES ('revoked'::text, 2::bigint) $$,
  'a coach with relationship:revoke may end that exact relationship'
);

SELECT throws_ok(
  $$
    SELECT * FROM public.append_training_eligibility_response(
      '42000000-0000-4000-8000-000000000001',
      1,
      'answers:coach:1',
      '{"schemaVersion":"eligibility-answers.v1","questionnaireSourceVersion":"preparticipation-inputs.v1-unvalidated","submittedAt":"2026-09-07T20:02:00Z","adultScope":"confirmed_18_plus","pregnancyPostpartumContext":"none_reported"}'::jsonb
    )
  $$,
  'P0001',
  NULL,
  'a coach cannot submit athlete eligibility answers'
);

SELECT throws_ok(
  $$
    SELECT * FROM public.record_training_eligibility_decision(
      '42000000-0000-4000-8000-000000000001',
      NULL,
      '{}'::jsonb
    )
  $$,
  '42501',
  NULL,
  'authenticated clients cannot submit authoritative eligibility decisions'
);

RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000002', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"41000000-0000-4000-8000-000000000002","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$
    SELECT * FROM public.append_training_profile_revision(
      '42000000-0000-4000-8000-000000000001',
      2,
      '{"schemaVersion":"athlete-training-profile.v1"}'::jsonb
    )
  $$,
  'P0001',
  NULL,
  'a coach without profile write permission cannot append'
);

SELECT throws_ok(
  $$
    SELECT * FROM public.revoke_training_coaching_relationship(
      '44000000-0000-4000-8000-000000000002', 1
    )
  $$,
  'P0001',
  'relationship revocation is not authorized',
  'a read-only coach cannot revoke their relationship'
);

RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;

SELECT results_eq(
  $$
    SELECT source_revision_id, state::text
    FROM public.record_training_eligibility_decision(
      '42000000-0000-4000-8000-000000000001',
      NULL,
      '{
        "schemaVersion":"eligibility-decision.v1",
        "sourceRevisionId":"decision:synthetic:1",
        "answersRevisionId":"answers:owner:1",
        "answersSchemaVersion":"eligibility-answers.v1",
        "questionnaireSourceVersion":"preparticipation-inputs.v1-unvalidated",
        "policyVersion":"synthetic-policy.v1",
        "state":"unanswered",
        "scope":"supported",
        "source":{"kind":"synthetic_fixture","sourceVersion":"synthetic-eligibility-fixture.v1","fixtureId":"fixture:eligibility:1","label":"Synthetic eligibility persistence fixture"},
        "effectiveFrom":"2026-09-07T20:00:00Z",
        "effectiveUntil":null,
        "supersededAt":null,
        "constraintSet":null
      }'::jsonb
    )
  $$,
  $$ VALUES ('decision:synthetic:1'::text, 'unanswered'::text) $$,
  'service authority records a labeled synthetic decision without clinical inference'
);

SELECT is(
  (
    SELECT current_eligibility_decision_source_revision_id
    FROM public.training_subjects
    WHERE id = '42000000-0000-4000-8000-000000000001'
  ),
  'decision:synthetic:1'::text,
  'decision append advances the exact source revision pointer'
);

SELECT throws_ok(
  $$
    SELECT * FROM public.record_training_eligibility_decision(
      '42000000-0000-4000-8000-000000000001',
      'decision:synthetic:1',
      '{
        "schemaVersion":"eligibility-decision.v1",
        "sourceRevisionId":"decision:policy:invalid",
        "answersRevisionId":"answers:owner:2",
        "answersSchemaVersion":"eligibility-answers.v1",
        "questionnaireSourceVersion":"preparticipation-inputs.v1-unvalidated",
        "policyVersion":"policy.v1",
        "state":"eligible_general",
        "scope":"supported",
        "source":{"kind":"policy_service","sourceVersion":"eligibility-policy-service.v1"},
        "effectiveFrom":"2026-09-07T20:05:00Z",
        "effectiveUntil":null,
        "supersededAt":null,
        "constraintSet":null
      }'::jsonb
    )
  $$,
  '22023',
  'decision does not match eligibility-decision.v1',
  'policy decisions require their exact evaluated-at provenance'
);

SELECT results_eq(
  $$
    SELECT source_revision_id, state::text, decision_hash ~ '^[0-9a-f]{64}$', hash_encoding
    FROM public.record_training_eligibility_decision(
      '42000000-0000-4000-8000-000000000001',
      'decision:synthetic:1',
      '{
        "schemaVersion":"eligibility-decision.v1",
        "sourceRevisionId":"decision:policy:2",
        "answersRevisionId":"answers:owner:2",
        "answersSchemaVersion":"eligibility-answers.v1",
        "questionnaireSourceVersion":"preparticipation-inputs.v1-unvalidated",
        "policyVersion":"policy.v1",
        "state":"eligible_general",
        "scope":"supported",
        "source":{"kind":"policy_service","sourceVersion":"eligibility-policy-service.v1","evaluatedAt":"2026-09-07T20:06:00Z"},
        "effectiveFrom":"2026-09-07T20:06:00Z",
        "effectiveUntil":null,
        "supersededAt":null,
        "constraintSet":null
      }'::jsonb
    )
  $$,
  $$ VALUES ('decision:policy:2'::text, 'eligible_general'::text, true, 'postgres-jsonb-text-utf8.v1'::text) $$,
  'a validated decision advances the exact supersession chain with a computed hash'
);

SELECT is(
  (
    SELECT current_eligibility_decision_source_revision_id
    FROM public.training_subjects
    WHERE id = '42000000-0000-4000-8000-000000000001'
  ),
  'decision:policy:2'::text,
  'the second decision becomes current only through the supersession chain'
);

SELECT throws_ok(
  $$
    SELECT * FROM public.record_training_eligibility_decision(
      '42000000-0000-4000-8000-000000000001',
      'decision:policy:2',
      jsonb_build_object(
        'schemaVersion', 'eligibility-decision.v1',
        'sourceRevisionId', 'decision:synthetic:2',
        'answersRevisionId', 'answers:missing',
        'answersSchemaVersion', 'eligibility-answers.v1',
        'questionnaireSourceVersion', 'preparticipation-inputs.v1-unvalidated',
        'policyVersion', 'synthetic-policy.v1',
        'state', 'unanswered',
        'scope', 'supported',
        'source', jsonb_build_object(
          'kind', 'synthetic_fixture',
          'sourceVersion', 'synthetic-eligibility-fixture.v1',
          'fixtureId', 'fixture:eligibility:2',
          'label', 'Synthetic missing answer fixture'
        ),
        'effectiveFrom', '2026-09-07T20:03:00Z',
        'effectiveUntil', NULL,
        'supersededAt', NULL,
        'constraintSet', NULL
      )
    )
  $$,
  '23503',
  NULL,
  'a decision must reference an exact response revision for the same subject'
);

RESET ROLE;

SELECT throws_ok(
  $$ UPDATE public.training_profile_revisions SET profile_hash = repeat('9', 64) $$,
  '55000',
  'training evidence is append-only',
  'profile revisions reject update even for the migration owner'
);

SELECT throws_ok(
  $$ DELETE FROM public.training_eligibility_responses $$,
  '55000',
  'training evidence is append-only',
  'eligibility answers reject deletion even for the migration owner'
);

SELECT throws_ok(
  $$ UPDATE public.training_eligibility_decisions SET decision_hash = repeat('8', 64) $$,
  '55000',
  'training evidence is append-only',
  'eligibility decisions reject update even for the migration owner'
);

SELECT throws_ok(
  $$
    UPDATE public.training_subjects
    SET current_profile_revision = 1
    WHERE id = '42000000-0000-4000-8000-000000000001'
  $$,
  'PT409',
  'current profile pointer must advance exactly once',
  'the mutable profile pointer cannot rewind immutable evidence'
);

SELECT throws_ok(
  $$
    UPDATE public.training_subjects
    SET current_profile_revision = 4
    WHERE id = '42000000-0000-4000-8000-000000000001'
  $$,
  'PT409',
  'current profile pointer must advance exactly once',
  'the mutable profile pointer cannot skip an immutable revision'
);

SELECT throws_ok(
  $$
    UPDATE public.training_subjects
    SET current_eligibility_decision_source_revision_id = NULL
    WHERE id = '42000000-0000-4000-8000-000000000001'
  $$,
  'PT409',
  'current eligibility pointer must follow the supersession chain',
  'the mutable decision pointer cannot discard authoritative provenance'
);

SELECT throws_ok(
  $$
    UPDATE public.coaching_relationships
    SET permissions = ARRAY['subject:read']::public.training_coach_permission[]
    WHERE id = '44000000-0000-4000-8000-000000000001'
  $$,
  'PT409',
  'coaching relationship revision must advance exactly once',
  'permission edits require an optimistic revision advance'
);

SELECT set_config('request.jwt.claim.sub', '43000000-0000-4000-8000-000000000001', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"43000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$
    SELECT status::text, revision
    FROM public.revoke_training_coaching_relationship(
      '44000000-0000-4000-8000-000000000001', 1
    )
  $$,
  $$ VALUES ('revoked'::text, 2::bigint) $$,
  'the athlete owner revokes coaching authority with an optimistic revision'
);

SELECT throws_ok(
  $$
    SELECT * FROM public.revoke_training_coaching_relationship(
      '44000000-0000-4000-8000-000000000001', 1
    )
  $$,
  'P0001',
  NULL,
  'a stale or repeated relationship revocation fails closed'
);

RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000001', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"41000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is_empty(
  $$ SELECT id FROM public.training_subjects $$,
  'relationship revocation immediately removes coach subject access'
);

SELECT is_empty(
  $$ SELECT revision FROM public.training_profile_revisions $$,
  'relationship revocation immediately removes coach profile access'
);

SELECT throws_ok(
  $$
    SELECT * FROM public.append_training_profile_revision(
      '42000000-0000-4000-8000-000000000001',
      2,
      '{"schemaVersion":"athlete-training-profile.v1"}'::jsonb
    )
  $$,
  'P0001',
  NULL,
  'a revoked coach cannot perform future writes'
);

RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000002', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"41000000-0000-4000-8000-000000000002","aal":"aal1","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;

SELECT is_empty(
  $$ SELECT id FROM public.training_subjects $$,
  'AAL1 denies coach access even with an active relationship'
);

RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000002', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"41000000-0000-4000-8000-000000000002","aal":"aal2","iat":0}',
  true
);
UPDATE public.practitioners
SET session_valid_after = '2026-09-07T00:00:00Z'
WHERE id = '41000000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;

SELECT is_empty(
  $$ SELECT id FROM public.training_subjects $$,
  'a stale AAL2 practitioner token fails the existing session cutoff'
);

RESET ROLE;

SELECT throws_ok(
  $$
    UPDATE public.coaching_relationships
    SET status = 'active', ended_at = NULL, revision = 3
    WHERE id = '44000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'revoked coaching relationships cannot be restored',
  'relationship revocation is irreversible'
);

SELECT throws_ok(
  $$
    INSERT INTO public.coaching_relationships (
      subject_id, practitioner_id, status, permissions, started_at, revision
    ) VALUES (
      '42000000-0000-4000-8000-000000000002',
      '41000000-0000-4000-8000-000000000001',
      'active',
      ARRAY['eligibility:clear']::public.training_coach_permission[],
      pg_catalog.clock_timestamp(),
      1
    )
  $$,
  '22P02',
  NULL,
  'coach permissions cannot encode eligibility clearance authority'
);

SELECT * FROM finish();
ROLLBACK;

BEGIN;

SELECT plan(5);

SELECT ok(
  pg_catalog.pg_get_functiondef(
    'public.append_training_eligibility_response(uuid,bigint,text,jsonb)'::regprocedure
  ) LIKE '%private.is_training_subject_owner(p_subject_id)%',
  'eligibility answer append uses the final current-session owner predicate'
);

WITH definition AS (
  SELECT pg_catalog.pg_get_functiondef(
    'public.accept_training_progression_proposal(uuid,uuid)'::regprocedure
  ) AS body
)
SELECT ok(
  pg_catalog.strpos(body, 'FROM public.training_sessions locked_session') > 0
    AND pg_catalog.strpos(body, 'FROM public.training_sessions locked_session')
      < pg_catalog.strpos(body, 'SELECT * INTO v_assignment FROM public.training_program_assignments'),
  'proposal acceptance locks referenced sessions before the assignment'
)
FROM definition;

SELECT ok(
  pg_catalog.pg_get_functiondef(
    'public.accept_training_progression_proposal(uuid,uuid)'::regprocedure
  ) LIKE '%ORDER BY locked_session.id%FOR UPDATE OF locked_session%',
  'proposal session locks use one deterministic ID order'
);

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email, created_at, updated_at)
VALUES (
  '51000000-0000-4000-8000-000000000001',
  'revision-locking-athlete@example.invalid',
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp()
);
INSERT INTO public.training_subjects (
  id, owner_user_id, status, activated_at, session_valid_after
) VALUES (
  '51000000-0000-4000-8000-000000000002',
  '51000000-0000-4000-8000-000000000001',
  'active',
  pg_catalog.clock_timestamp(),
  '2030-01-01T00:00:00Z'
);
SET LOCAL session_replication_role = origin;

SELECT set_config(
  'request.jwt.claim.sub',
  '51000000-0000-4000-8000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51000000-0000-4000-8000-000000000001","aal":"aal2","iat":1893455999}',
  true
);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$
    SELECT *
    FROM public.append_training_eligibility_response(
      '51000000-0000-4000-8000-000000000002',
      0,
      'answers:revision-locking:1',
      '{
        "schemaVersion":"eligibility-answers.v1",
        "questionnaireSourceVersion":"preparticipation-inputs.v1-unvalidated",
        "submittedAt":"2029-12-31T23:59:59Z",
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
  'P0001',
  'eligibility answer write is not authorized',
  'an AAL2 athlete JWT older than session_valid_after cannot append answers'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"51000000-0000-4000-8000-000000000001","aal":"aal2","iat":1893456000}',
  true
);
SET LOCAL ROLE authenticated;

SELECT results_eq(
  $$
    SELECT revision, source_revision_id
    FROM public.append_training_eligibility_response(
      '51000000-0000-4000-8000-000000000002',
      0,
      'answers:revision-locking:1',
      '{
        "schemaVersion":"eligibility-answers.v1",
        "questionnaireSourceVersion":"preparticipation-inputs.v1-unvalidated",
        "submittedAt":"2030-01-01T00:00:00Z",
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
  $$ VALUES (1::bigint, 'answers:revision-locking:1'::text) $$,
  'a current AAL2 athlete session retains the authorized append behavior'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

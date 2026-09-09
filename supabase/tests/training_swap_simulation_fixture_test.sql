BEGIN;

SELECT plan(13);

SELECT ok(
  pg_catalog.to_regprocedure('private.reserve_training_simulation_identity_for_fixture(text,text,text)') IS NOT NULL
  AND pg_catalog.to_regprocedure('public.reserve_training_simulation_identity()') IS NOT NULL
  AND pg_catalog.to_regprocedure('public.reserve_training_exercise_swap_simulation_identity()') IS NOT NULL,
  'two fixed reservation wrappers share one private implementation'
);
SELECT ok(
  pg_catalog.has_function_privilege('authenticated', 'public.reserve_training_simulation_identity()', 'EXECUTE')
  AND pg_catalog.has_function_privilege('authenticated', 'public.reserve_training_exercise_swap_simulation_identity()', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('authenticated', 'private.reserve_training_simulation_identity_for_fixture(text,text,text)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('service_role', 'private.reserve_training_simulation_identity_for_fixture(text,text,text)', 'EXECUTE'),
  'authenticated callers can use only fixed public fixture choices'
);

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at)
VALUES('63000000-0000-4000-8000-000000000001','swap-practice-coach@example.invalid',clock_timestamp(),clock_timestamp());
INSERT INTO public.practitioners(id,display_name,access_status,role,session_valid_after)
VALUES('63000000-0000-4000-8000-000000000001','Swap practice coach','active','practitioner','-infinity');
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.sub','63000000-0000-4000-8000-000000000001',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"63000000-0000-4000-8000-000000000001","email":"swap-practice-coach@example.invalid","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE starter_reservation AS
SELECT public.reserve_training_simulation_identity() AS payload;
CREATE TEMP TABLE swap_reservation AS
SELECT public.reserve_training_exercise_swap_simulation_identity() AS payload;
SELECT is(
  (SELECT payload->>'fixtureId' FROM starter_reservation),
  'synthetic-starter-catalog.v1',
  'the established wrapper preserves the starter fixture ID'
);
SELECT is(
  (SELECT payload->>'fixtureHash' FROM starter_reservation),
  'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
  'the established wrapper preserves the starter fixture hash'
);
SELECT is(
  (SELECT payload->>'fixtureId' FROM swap_reservation),
  'synthetic-swap-journey-catalog.v1',
  'the swap wrapper reserves only the exercise-swap fixture ID'
);
SELECT is(
  (SELECT payload->>'fixtureHash' FROM swap_reservation),
  '2279f354548647f1b351f032de2b5babf40bd20c2b208071586b1c68645c7078',
  'the swap wrapper reserves only the exercise-swap fixture hash'
);
SELECT isnt(
  (SELECT payload->>'reservationId' FROM starter_reservation),
  (SELECT payload->>'reservationId' FROM swap_reservation),
  'the two fixed fixtures use distinct private identities'
);
SELECT is(
  public.reserve_training_simulation_identity()->>'reservationId',
  (SELECT payload->>'reservationId' FROM starter_reservation),
  'an exact starter retry reuses the open starter identity'
);
SELECT is(
  public.reserve_training_exercise_swap_simulation_identity()->>'reservationId',
  (SELECT payload->>'reservationId' FROM swap_reservation),
  'an exact swap retry reuses the open swap identity'
);
RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"63000000-0000-4000-8000-000000000001","aal":"aal1","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.reserve_training_exercise_swap_simulation_identity() $$,
  '42501',NULL,
  'AAL1 cannot reserve the exercise-swap fixture'
);
RESET ROLE;

INSERT INTO auth.users(id,email,created_at,updated_at)
SELECT
  '63000000-0000-4000-8000-000000000002',
  payload->>'internalEmail',
  clock_timestamp(),clock_timestamp()
FROM swap_reservation;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
GRANT SELECT ON swap_reservation TO service_role;
SET LOCAL ROLE service_role;
CREATE TEMP TABLE swap_activation AS
SELECT public.activate_training_simulation_identity(
  (SELECT (payload->>'reservationId')::uuid FROM swap_reservation),
  '63000000-0000-4000-8000-000000000002',
  '{"schemaVersion":"athlete-training-profile.v1","origin":{"kind":"synthetic_fixture","fixtureId":"practice-strength-profile.v1","label":"Synthetic practice profile"},"goal":"strength","experience":"beginner","recentConsistency":"consistent","cycleLengthWeeks":8,"strengthDays":["monday","thursday"],"localTimezone":"UTC","sessionTimeBudgetMinutes":45,"preferredLoadUnit":"kg","equipmentInventory":[],"startingHistory":[]}'::jsonb
) AS payload;
GRANT SELECT ON swap_activation TO authenticated;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','63000000-0000-4000-8000-000000000001',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"63000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT is(
  public.resolve_training_program_build_source(
    (SELECT (payload->>'subjectId')::uuid FROM swap_activation),1
  )->>'fixtureHash',
  '2279f354548647f1b351f032de2b5babf40bd20c2b208071586b1c68645c7078',
  'the build-source resolver returns the exact controlled swap fixture'
);
RESET ROLE;

UPDATE public.training_simulation_runs
SET fixture_hash=pg_catalog.repeat('f',64)
WHERE id=(SELECT (payload->>'simulationRunId')::uuid FROM swap_activation);
SET LOCAL ROLE authenticated;
SELECT is(
  public.resolve_training_program_build_source(
    (SELECT (payload->>'subjectId')::uuid FROM swap_activation),1
  ),
  NULL::jsonb,
  'a mutated swap fixture hash fails closed at build-source resolution'
);
RESET ROLE;

UPDATE private.training_simulation_identities
SET created_at=pg_catalog.clock_timestamp()-interval '2 hours',
    expires_at=pg_catalog.clock_timestamp()-interval '1 hour'
WHERE practitioner_id='63000000-0000-4000-8000-000000000001';
UPDATE public.training_simulation_runs
SET fixture_hash='2279f354548647f1b351f032de2b5babf40bd20c2b208071586b1c68645c7078',
    created_at=pg_catalog.clock_timestamp()-interval '2 hours',
    expires_at=pg_catalog.clock_timestamp()-interval '1 hour'
WHERE id=(SELECT (payload->>'simulationRunId')::uuid FROM swap_activation);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE second_starter_reservation AS
SELECT public.reserve_training_simulation_identity() AS payload;
CREATE TEMP TABLE second_swap_reservation AS
SELECT public.reserve_training_exercise_swap_simulation_identity() AS payload;
RESET ROLE;
UPDATE private.training_simulation_identities
SET created_at=pg_catalog.clock_timestamp()-interval '2 hours',
    expires_at=pg_catalog.clock_timestamp()-interval '1 hour'
WHERE id=(SELECT (payload->>'reservationId')::uuid FROM second_starter_reservation);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.reserve_training_simulation_identity() $$,
  'PT429',NULL,
  'both fixed wrappers consume the same four-per-hour creation quota'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

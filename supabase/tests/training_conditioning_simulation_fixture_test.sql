BEGIN;

SELECT plan(17);

SELECT ok(
  pg_catalog.to_regprocedure('private.reserve_training_simulation_identity_for_fixture(text,text,text)') IS NOT NULL
  AND pg_catalog.to_regprocedure('public.reserve_training_simulation_identity()') IS NOT NULL
  AND pg_catalog.to_regprocedure('public.reserve_training_exercise_swap_simulation_identity()') IS NOT NULL
  AND pg_catalog.to_regprocedure('public.reserve_training_conditioning_simulation_identity()') IS NOT NULL,
  'three fixed reservation wrappers share one private implementation'
);
SELECT ok(
  pg_catalog.has_function_privilege('authenticated', 'public.reserve_training_conditioning_simulation_identity()', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon', 'public.reserve_training_conditioning_simulation_identity()', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('service_role', 'public.reserve_training_conditioning_simulation_identity()', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('authenticated', 'private.reserve_training_simulation_identity_for_fixture(text,text,text)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('service_role', 'private.reserve_training_simulation_identity_for_fixture(text,text,text)', 'EXECUTE'),
  'only authenticated callers can select the fixed conditioning wrapper'
);

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at)
VALUES('63200000-0000-4000-8000-000000000001','conditioning-practice-coach@example.invalid',clock_timestamp(),clock_timestamp());
INSERT INTO public.practitioners(id,display_name,access_status,role,session_valid_after)
VALUES('63200000-0000-4000-8000-000000000001','Conditioning practice coach','active','practitioner','-infinity');
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.sub','63200000-0000-4000-8000-000000000001',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"63200000-0000-4000-8000-000000000001","email":"conditioning-practice-coach@example.invalid","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE starter_reservation AS
SELECT public.reserve_training_simulation_identity() AS payload;
CREATE TEMP TABLE swap_reservation AS
SELECT public.reserve_training_exercise_swap_simulation_identity() AS payload;
CREATE TEMP TABLE conditioning_reservation AS
SELECT public.reserve_training_conditioning_simulation_identity() AS payload;
SELECT is((SELECT payload->>'fixtureId' FROM starter_reservation),
  'synthetic-starter-catalog.v1','the starter wrapper preserves its established fixture ID');
SELECT is((SELECT payload->>'fixtureHash' FROM starter_reservation),
  'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
  'the starter wrapper preserves its established fixture hash');
SELECT is((SELECT payload->>'fixtureId' FROM swap_reservation),
  'synthetic-swap-journey-catalog.v1','the swap wrapper preserves its established fixture ID');
SELECT is((SELECT payload->>'fixtureHash' FROM swap_reservation),
  '2279f354548647f1b351f032de2b5babf40bd20c2b208071586b1c68645c7078',
  'the swap wrapper preserves its established fixture hash');
SELECT is((SELECT payload->>'fixtureId' FROM conditioning_reservation),
  'synthetic-conditioning-journey-catalog.v1','the conditioning wrapper selects only its fixed fixture ID');
SELECT is((SELECT payload->>'fixtureHash' FROM conditioning_reservation),
  'e304f19092b458ae87c2f05f5decd36a09b64f8503a3784a250c9b4293e8c73e',
  'the conditioning wrapper selects only its fixed fixture hash');
SELECT is((SELECT payload->>'label' FROM conditioning_reservation),
  'Practice data','the conditioning wrapper preserves the visible synthetic label');
SELECT is((
  SELECT pg_catalog.count(DISTINCT reservation_id)
  FROM (VALUES
    ((SELECT payload->>'reservationId' FROM starter_reservation)),
    ((SELECT payload->>'reservationId' FROM swap_reservation)),
    ((SELECT payload->>'reservationId' FROM conditioning_reservation))
  ) reservation(reservation_id)
),3::bigint,'each fixed fixture has a distinct private identity');
SELECT is(
  public.reserve_training_conditioning_simulation_identity()->>'reservationId',
  (SELECT payload->>'reservationId' FROM conditioning_reservation),
  'an exact conditioning retry reuses the open identity'
);
RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"63200000-0000-4000-8000-000000000001","aal":"aal1","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.reserve_training_conditioning_simulation_identity() $$,
  '42501',NULL,'AAL1 cannot reserve the conditioning fixture'
);
RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"63200000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',
  true
);
SELECT throws_ok(
  $$ SELECT private.reserve_training_simulation_identity_for_fixture(
    'synthetic-conditioning-journey-catalog.v1',repeat('f',64),'Practice data'
  ) $$,
  '22023','unsupported training simulation fixture',
  'the private implementation rejects a non-allowlisted provenance tuple'
);

INSERT INTO auth.users(id,email,created_at,updated_at)
SELECT '63200000-0000-4000-8000-000000000002',payload->>'internalEmail',clock_timestamp(),clock_timestamp()
FROM conditioning_reservation;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
GRANT SELECT ON conditioning_reservation TO service_role;
SET LOCAL ROLE service_role;
CREATE TEMP TABLE conditioning_activation AS
SELECT public.activate_training_simulation_identity(
  (SELECT (payload->>'reservationId')::uuid FROM conditioning_reservation),
  '63200000-0000-4000-8000-000000000002',
  '{"schemaVersion":"athlete-training-profile.v1","origin":{"kind":"synthetic_fixture","fixtureId":"practice-strength-profile.v1","label":"Synthetic practice profile"},"goal":"strength","experience":"beginner","recentConsistency":"consistent","cycleLengthWeeks":8,"strengthDays":["monday","thursday"],"localTimezone":"UTC","sessionTimeBudgetMinutes":45,"preferredLoadUnit":"kg","equipmentInventory":[],"startingHistory":[]}'::jsonb
) AS payload;
GRANT SELECT ON conditioning_activation TO authenticated;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','63200000-0000-4000-8000-000000000001',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"63200000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT is(
  public.resolve_training_program_build_source(
    (SELECT (payload->>'subjectId')::uuid FROM conditioning_activation),1
  )->>'fixtureHash',
  'e304f19092b458ae87c2f05f5decd36a09b64f8503a3784a250c9b4293e8c73e',
  'the build-source resolver returns the exact controlled conditioning fixture'
);
RESET ROLE;

UPDATE public.training_simulation_runs
SET fixture_hash=pg_catalog.repeat('f',64)
WHERE id=(SELECT (payload->>'simulationRunId')::uuid FROM conditioning_activation);
SET LOCAL ROLE authenticated;
SELECT is(
  public.resolve_training_program_build_source(
    (SELECT (payload->>'subjectId')::uuid FROM conditioning_activation),1
  ),
  NULL::jsonb,'a mutated conditioning fixture hash fails closed at build-source resolution'
);
RESET ROLE;

UPDATE public.training_simulation_runs
SET fixture_hash='e304f19092b458ae87c2f05f5decd36a09b64f8503a3784a250c9b4293e8c73e',
    created_at=pg_catalog.clock_timestamp()-interval '2 hours',
    expires_at=pg_catalog.clock_timestamp()-interval '1 hour'
WHERE id=(SELECT (payload->>'simulationRunId')::uuid FROM conditioning_activation);
UPDATE private.training_simulation_identities
SET created_at=pg_catalog.clock_timestamp()-interval '2 hours',
    expires_at=pg_catalog.clock_timestamp()-interval '1 hour'
WHERE id=(SELECT (payload->>'reservationId')::uuid FROM conditioning_reservation);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE second_conditioning_reservation AS
SELECT public.reserve_training_conditioning_simulation_identity() AS payload;
RESET ROLE;
SELECT isnt(
  (SELECT payload->>'reservationId' FROM second_conditioning_reservation),
  (SELECT payload->>'reservationId' FROM conditioning_reservation),
  'an expired conditioning identity is replaced inside the shared fourth creation slot'
);
UPDATE private.training_simulation_identities
SET created_at=pg_catalog.clock_timestamp()-interval '2 hours',
    expires_at=pg_catalog.clock_timestamp()-interval '1 hour'
WHERE id=(SELECT (payload->>'reservationId')::uuid FROM second_conditioning_reservation);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.reserve_training_conditioning_simulation_identity() $$,
  'PT429',NULL,'all three fixed wrappers share the established four-per-hour creation quota'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

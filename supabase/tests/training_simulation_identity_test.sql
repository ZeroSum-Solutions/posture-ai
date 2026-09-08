BEGIN;

SELECT plan(39);

SELECT has_table('private', 'training_simulation_identities', 'practice identities are private');
SELECT ok(
  pg_catalog.to_regprocedure('public.reserve_training_simulation_identity()') IS NOT NULL
  AND pg_catalog.to_regprocedure('public.activate_training_simulation_identity(uuid,uuid,jsonb)') IS NOT NULL
  AND pg_catalog.to_regprocedure('public.cancel_training_simulation_identity(uuid,text)') IS NOT NULL
  AND pg_catalog.to_regprocedure('public.resolve_training_program_build_source(uuid,bigint)') IS NOT NULL
  AND pg_catalog.to_regprocedure('private.has_training_simulation_control(uuid)') IS NOT NULL,
  'reservation, activation, cleanup, and control predicates exist'
);
SELECT ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'private.training_simulation_identities', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('service_role', 'private.training_simulation_identities', 'SELECT'),
  'application roles cannot read private fixture identity rows'
);
SELECT ok(
  pg_catalog.has_function_privilege('authenticated', 'public.reserve_training_simulation_identity()', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('service_role', 'public.reserve_training_simulation_identity()', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('authenticated', 'public.check_rate_limit(text,integer,integer)', 'EXECUTE')
  AND pg_catalog.has_function_privilege('authenticated', 'public.resolve_training_program_build_source(uuid,bigint)', 'EXECUTE')
  AND pg_catalog.has_function_privilege('service_role', 'public.activate_training_simulation_identity(uuid,uuid,jsonb)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('authenticated', 'public.activate_training_simulation_identity(uuid,uuid,jsonb)', 'EXECUTE'),
  'coach reservation and service activation authorities are separated'
);

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('61000000-0000-4000-8000-000000000001','practice-coach@example.invalid',clock_timestamp(),clock_timestamp()),
  ('61000000-0000-4000-8000-000000000002','other-coach@example.invalid',clock_timestamp(),clock_timestamp());
INSERT INTO public.practitioners(id,display_name,access_status,role,session_valid_after) VALUES
  ('61000000-0000-4000-8000-000000000001','Practice coach','active','practitioner','-infinity'),
  ('61000000-0000-4000-8000-000000000002','Other coach','active','practitioner','-infinity');
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"61000000-0000-4000-8000-000000000001","email":"practice-coach@example.invalid","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE simulation_reservation AS
SELECT public.reserve_training_simulation_identity() AS payload;
SELECT ok(
  payload->>'reservationId' IS NOT NULL
  AND payload->>'simulationRunId' IS NOT NULL
  AND payload->>'internalEmail' ~ '^simulation\+[a-f0-9]+@fixtures\.invalid$'
  AND payload->>'status' = 'reserved',
  'AAL2 coach receives server-owned reservation, run, and internal email IDs'
) FROM simulation_reservation;
SELECT is(public.read_my_training_simulation_client_ids(),
  jsonb_build_array(payload->>'clientId'),
  'reserved identity is classified before activation creates a run or account') FROM simulation_reservation;
SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims',
  '{"sub":"61000000-0000-4000-8000-000000000002","aal":"aal2","iat":2000000000}',true);
SELECT is(public.read_my_training_simulation_client_ids(), '[]'::jsonb,
  'another coach cannot see the reserved client identity');
SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims',
  '{"sub":"61000000-0000-4000-8000-000000000001","email":"practice-coach@example.invalid","aal":"aal2","iat":2000000000}',true);
SELECT is(payload->>'fixtureId','synthetic-starter-catalog.v1',
  'reservation uses the frozen starter catalog fixture ID') FROM simulation_reservation;
SELECT is(payload->>'fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
  'reservation uses the frozen starter catalog fixture hash') FROM simulation_reservation;
SELECT is(
  public.reserve_training_simulation_identity()->>'reservationId',
  (SELECT payload->>'reservationId' FROM simulation_reservation),
  'retry reuses the open fixture reservation for this coach'
);
RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"61000000-0000-4000-8000-000000000001","email":"practice-coach@example.invalid","aal":"aal1","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT public.read_my_training_simulation_client_ids() $$,
  '42501', NULL, 'AAL1 cannot classify private sample clients');
SELECT throws_ok(
  $$ SELECT public.reserve_training_simulation_identity() $$,
  '42501',NULL,
  'AAL1 practitioner cannot reserve a practice identity'
);
RESET ROLE;
GRANT SELECT ON simulation_reservation TO service_role;

INSERT INTO auth.users(id,email,created_at,updated_at)
SELECT
  '62000000-0000-4000-8000-000000000001',
  payload->>'internalEmail',
  clock_timestamp(),clock_timestamp()
FROM simulation_reservation;
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.training_subjects subject
    JOIN private.athlete_invitations invitation ON invitation.subject_id = subject.id
    WHERE invitation.id = (SELECT (payload->>'invitationId')::uuid FROM simulation_reservation)
      AND subject.owner_user_id = '62000000-0000-4000-8000-000000000001'
      AND subject.status = 'invited'
      AND invitation.state = 'provisioned'
  ),
  'normal Auth provisioning creates a distinct invited athlete identity'
);

SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$ SELECT public.activate_training_simulation_identity(
       (SELECT (payload->>'reservationId')::uuid FROM simulation_reservation),
       '62000000-0000-4000-8000-000000000099',
       '{}'::jsonb) $$,
  '42501',NULL,
  'activation rejects an auth user not bound by the invitation trigger'
);
SELECT throws_ok(
  $$ SELECT public.activate_training_simulation_identity(
       (SELECT (payload->>'reservationId')::uuid FROM simulation_reservation),
       '62000000-0000-4000-8000-000000000001',
       '{"schemaVersion":"athlete-training-profile.v1","origin":{"kind":"synthetic_fixture","fixtureId":"wrong.v1","label":"Synthetic practice profile"},"goal":"strength","experience":"beginner","recentConsistency":"consistent","cycleLengthWeeks":8,"strengthDays":["monday","thursday"],"localTimezone":"UTC","sessionTimeBudgetMinutes":45,"preferredLoadUnit":"kg","equipmentInventory":[],"startingHistory":[]}'::jsonb) $$,
  '22023',NULL,
  'activation rejects profile provenance that does not match the reservation'
);
CREATE TEMP TABLE simulation_activation AS
SELECT public.activate_training_simulation_identity(
  (SELECT (payload->>'reservationId')::uuid FROM simulation_reservation),
  '62000000-0000-4000-8000-000000000001',
  '{"schemaVersion":"athlete-training-profile.v1","origin":{"kind":"synthetic_fixture","fixtureId":"practice-strength-profile.v1","label":"Synthetic practice profile"},"goal":"strength","experience":"beginner","recentConsistency":"consistent","cycleLengthWeeks":8,"strengthDays":["monday","thursday"],"localTimezone":"UTC","sessionTimeBudgetMinutes":45,"preferredLoadUnit":"kg","equipmentInventory":[],"startingHistory":[]}'::jsonb
) AS payload;
GRANT SELECT ON simulation_activation TO authenticated;
SELECT is(payload->>'profileRevision','1','activation returns the current profile revision')
FROM simulation_activation;
SELECT is(
  (SELECT subject.status::text FROM public.training_subjects subject
    WHERE subject.id=(SELECT (payload->>'subjectId')::uuid FROM simulation_activation)),
  'active','the synthetic owner subject is activated without becoming a practitioner'
);
SELECT is(
  (SELECT subject.current_eligibility_decision_source_revision_id FROM public.training_subjects subject
    WHERE subject.id=(SELECT (payload->>'subjectId')::uuid FROM simulation_activation)),
  NULL::text,'practice activation never creates or points at live eligibility'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.training_simulation_runs run
    JOIN simulation_activation activation
      ON run.id=(activation.payload->>'simulationRunId')::uuid
    WHERE run.subject_id=(activation.payload->>'subjectId')::uuid
      AND run.created_by_user_id='61000000-0000-4000-8000-000000000001'
      AND run.fixture_id=activation.payload->>'fixtureId'
      AND run.fixture_hash=activation.payload->>'fixtureHash'
      AND run.status='active'
  ),
  'activation binds the run to exact subject, coach, fixture hash, and expiry'
);
SELECT is(
  public.activate_training_simulation_identity(
    (SELECT (payload->>'reservationId')::uuid FROM simulation_reservation),
    '62000000-0000-4000-8000-000000000001',
    '{}'::jsonb
  )->>'subjectId',
  (SELECT payload->>'subjectId' FROM simulation_activation),
  'activation retry is idempotent for the same provisioned identity'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  private.has_training_simulation_control(
    (SELECT (payload->>'simulationRunId')::uuid FROM simulation_activation)
  ),true,'creating coach has explicit unexpired simulation control'
);
RESET ROLE;
UPDATE public.training_simulation_runs
SET fixture_hash=repeat('b',64)
WHERE id=(SELECT (payload->>'simulationRunId')::uuid FROM simulation_activation);
SELECT is(
  private.has_training_simulation_control(
    (SELECT (payload->>'simulationRunId')::uuid FROM simulation_activation)
  ),false,'a run provenance mismatch revokes simulation control'
);
UPDATE public.training_simulation_runs
SET fixture_hash='ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717'
WHERE id=(SELECT (payload->>'simulationRunId')::uuid FROM simulation_activation);
INSERT INTO public.api_rate_limits(bucket_key,window_start,request_count)
VALUES(
  'training_simulation_reservation:61000000-0000-4000-8000-000000000001',
  pg_catalog.clock_timestamp(),
  4
)
ON CONFLICT (bucket_key) DO UPDATE
SET window_start=EXCLUDED.window_start, request_count=EXCLUDED.request_count;
SET LOCAL ROLE authenticated;
SELECT is(
  public.resolve_training_program_build_source(
    (SELECT (payload->>'subjectId')::uuid FROM simulation_activation),1
  )->>'fixtureHash',
  'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
  'server build source resolves the exact controlled catalog fixture'
);
SELECT throws_ok(
  $$ SELECT public.resolve_training_program_build_source(
       (SELECT (payload->>'subjectId')::uuid FROM simulation_activation),2) $$,
  'PT409',NULL,
  'server build source rejects a stale profile revision'
);
SELECT is(
  public.reserve_training_simulation_identity()->>'subjectId',
  (SELECT payload->>'subjectId' FROM simulation_activation),
  'an open current identity is reused before the creation rate limit is charged'
);
RESET ROLE;

SELECT lives_ok(
  $$ SELECT private.assert_training_program_eligibility(
    (SELECT (payload->>'subjectId')::uuid FROM simulation_activation),
    pg_catalog.jsonb_build_object(
      'profileRevisionId','1',
      'executionContext',pg_catalog.jsonb_build_object(
        'kind','synthetic_simulation',
        'simulationRunId',(SELECT payload->>'simulationRunId' FROM simulation_activation),
        'fixtureId','synthetic-starter-catalog.v1',
        'fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
        'label','Practice data'
      )
    ),
    (SELECT (payload->>'simulationRunId')::uuid FROM simulation_activation)
  ) $$,
  'controlled practice coach passes the simulation eligibility boundary'
);

INSERT INTO public.coaching_relationships(subject_id,practitioner_id,permissions,status)
SELECT (payload->>'subjectId')::uuid,'61000000-0000-4000-8000-000000000002',
  ARRAY['subject:read','program:coach_publish','session:read','set_log:write']::public.training_coach_permission[],
  'active'
FROM simulation_activation;

SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000002","aal":"aal2","iat":2000000000}',true);
INSERT INTO public.api_rate_limits(bucket_key,window_start,request_count)
VALUES(
  'training_simulation_reservation:61000000-0000-4000-8000-000000000002',
  pg_catalog.clock_timestamp(),
  4
)
ON CONFLICT (bucket_key) DO UPDATE
SET window_start=EXCLUDED.window_start, request_count=EXCLUDED.request_count;
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.reserve_training_simulation_identity() $$,
  'PT429',NULL,
  'a direct authenticated reservation call cannot bypass the per-coach creation cap'
);
SELECT is(
  (SELECT count(*) FROM public.clients
    WHERE practitioner_id='61000000-0000-4000-8000-000000000002'),
  0::bigint,
  'a capped direct reservation creates no client row'
);
SELECT is(
  private.has_training_simulation_control(
    (SELECT (payload->>'simulationRunId')::uuid FROM simulation_activation)
  ),false,'another practitioner has no simulation control'
);
SELECT is(
  public.resolve_training_program_build_source(
    (SELECT (payload->>'subjectId')::uuid FROM simulation_activation),1
  ),NULL::jsonb,
  'generic coach permissions cannot resolve private simulation build context'
);
SELECT is(
  public.resolve_training_program_build_source(
    (SELECT (payload->>'subjectId')::uuid FROM simulation_activation),2
  ),NULL::jsonb,
  'unrelated caller cannot infer the current profile revision from a stale request'
);
RESET ROLE;

SELECT throws_ok(
  $$ SELECT private.assert_training_program_eligibility(
    (SELECT (payload->>'subjectId')::uuid FROM simulation_activation),
    pg_catalog.jsonb_build_object(
      'profileRevisionId','1',
      'executionContext',pg_catalog.jsonb_build_object(
        'kind','synthetic_simulation',
        'simulationRunId',(SELECT payload->>'simulationRunId' FROM simulation_activation),
        'fixtureId','synthetic-starter-catalog.v1',
        'fixtureHash','ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
        'label','Practice data'
      )
    ),
    (SELECT (payload->>'simulationRunId')::uuid FROM simulation_activation)
  ) $$,
  'P0001',NULL,
  'generic coach permissions do not satisfy simulation eligibility control'
);

UPDATE private.training_simulation_identities
SET created_at=pg_catalog.clock_timestamp()-interval '2 hours',
    expires_at=pg_catalog.clock_timestamp()-interval '1 hour'
WHERE id=(SELECT (payload->>'reservationId')::uuid FROM simulation_reservation);
UPDATE public.training_simulation_runs
SET created_at=pg_catalog.clock_timestamp()-interval '2 hours',
    expires_at=pg_catalog.clock_timestamp()-interval '1 hour'
WHERE id=(SELECT (payload->>'simulationRunId')::uuid FROM simulation_activation);
SELECT is(
  private.has_training_simulation_control(
    (SELECT (payload->>'simulationRunId')::uuid FROM simulation_activation)
  ),false,'expired identity and run cannot retain simulation control'
);

SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT is(
  public.cancel_training_simulation_identity(
    (SELECT (payload->>'reservationId')::uuid FROM simulation_reservation),'route cleanup test'
  ),'cancelled','service cleanup cancels an active practice identity'
);
RESET ROLE;
SELECT ok(
  EXISTS (
    SELECT 1 FROM private.training_simulation_identities identity_record
    JOIN public.training_subjects subject ON subject.id=identity_record.subject_id
    JOIN public.training_simulation_runs run ON run.id=identity_record.simulation_run_id
    WHERE identity_record.id=(SELECT (payload->>'reservationId')::uuid FROM simulation_reservation)
      AND identity_record.state='cancelled' AND identity_record.ended_at IS NOT NULL
      AND subject.status='revoked' AND run.status='ended'
  ),
  'cleanup revokes subject access and ends the simulation run'
);
UPDATE private.training_simulation_identities
SET state='expired'
WHERE id=(SELECT (payload->>'reservationId')::uuid FROM simulation_reservation);
SET LOCAL ROLE service_role;
SELECT is(
  public.cancel_training_simulation_identity(
    (SELECT (payload->>'reservationId')::uuid FROM simulation_reservation),'retry'
  ),'already_ended','cleanup retry is idempotent'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  private.has_training_simulation_control(
    (SELECT (payload->>'simulationRunId')::uuid FROM simulation_activation)
  ),false,'cancelled identity cannot control the run'
);
SELECT is(
  public.resolve_training_program_build_source(
    (SELECT (payload->>'subjectId')::uuid FROM simulation_activation),1
  ),NULL::jsonb,
  'cleanup removes the server build source projection'
);
SELECT throws_ok(
  $$ SELECT public.issue_coach_athlete_invitation(
       'historical-sample-invite@example.invalid',
       (SELECT (payload->>'clientId')::uuid FROM simulation_reservation),
       ARRAY['subject:read','profile:read']::public.training_coach_permission[],
       pg_catalog.clock_timestamp() + interval '1 day') $$,
  'P0001',NULL,
  'an expired historical simulation client can never enter live invitation admission'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

BEGIN;

SELECT plan(22);

SELECT has_table('private','training_coach_invitation_prepare_requests','prepare requests are durable and private');
SELECT ok(
  pg_catalog.to_regprocedure('public.prepare_coach_athlete_invitation(uuid,uuid,text,public.training_coach_permission[])') IS NOT NULL,
  'request-bound coach invitation preparation exists'
);
SELECT ok(
  pg_catalog.has_function_privilege('authenticated','public.prepare_coach_athlete_invitation(uuid,uuid,text,public.training_coach_permission[])','EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon','public.prepare_coach_athlete_invitation(uuid,uuid,text,public.training_coach_permission[])','EXECUTE')
  AND NOT pg_catalog.has_function_privilege('service_role','public.prepare_coach_athlete_invitation(uuid,uuid,text,public.training_coach_permission[])','EXECUTE'),
  'only an authenticated actor can prepare a coach invitation'
);
SELECT ok(
  pg_catalog.has_function_privilege('authenticated','public.issue_coach_athlete_invitation(text,uuid,public.training_coach_permission[],timestamptz)','EXECUTE'),
  'the compatible direct issuance RPC remains available'
);
SELECT ok(
  NOT pg_catalog.has_table_privilege('authenticated','private.training_coach_invitation_prepare_requests','SELECT')
  AND NOT pg_catalog.has_table_privilege('service_role','private.training_coach_invitation_prepare_requests','SELECT'),
  'browser and service roles cannot read request receipts'
);

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('a1000000-0000-4000-8000-000000000001','prepare-coach@example.invalid',clock_timestamp(),clock_timestamp()),
  ('a1000000-0000-4000-8000-000000000002','other-coach@example.invalid',clock_timestamp(),clock_timestamp());
INSERT INTO public.practitioners(id,display_name,access_status,role,session_valid_after) VALUES
  ('a1000000-0000-4000-8000-000000000001','Prepare coach','active','practitioner','-infinity'),
  ('a1000000-0000-4000-8000-000000000002','Other coach','active','practitioner','-infinity');
INSERT INTO public.clients(id,practitioner_id,first_name,last_name) VALUES
  ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Invitation','Target'),
  ('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','Second','Target'),
  ('a2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000002','Other','Target');
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","email":"prepare-coach@example.invalid","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE prepared_result AS
SELECT public.prepare_coach_athlete_invitation(
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  '  Athlete@Example.Invalid ',
  ARRAY['program:coach_publish','profile:read']::public.training_coach_permission[]
) AS value;

SELECT is((SELECT value->>'status' FROM prepared_result),'pending','first preparation creates a pending invitation');
SELECT is((SELECT value->>'clientId' FROM prepared_result),'a2000000-0000-4000-8000-000000000001','projection binds the exact owned client');
SELECT is((SELECT value->>'emailNormalized' FROM prepared_result),'athlete@example.invalid','projection returns normalized email');
SELECT is((SELECT value->'permissions' FROM prepared_result),'["profile:read", "program:coach_publish"]'::jsonb,'projection canonicalizes permission order');
SELECT ok(
  (SELECT value->>'invitationId' FROM prepared_result) IS NOT NULL
  AND (SELECT value->>'expiresAt' FROM prepared_result) IS NOT NULL
  AND NOT ((SELECT value FROM prepared_result) ? 'invitationUrl'),
  'database projection contains stable receipt fields and no secret link'
);
SELECT is(
  public.prepare_coach_athlete_invitation(
    'a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
    'athlete@example.invalid',ARRAY['profile:read','program:coach_publish']::public.training_coach_permission[]
  )->>'invitationId',
  (SELECT value->>'invitationId' FROM prepared_result),
  'an exact retry returns the same invitation receipt'
);
SELECT throws_ok(
  $$ SELECT public.prepare_coach_athlete_invitation(
    'a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
    'changed@example.invalid',ARRAY['profile:read','program:coach_publish']::public.training_coach_permission[]
  ) $$,
  'PT409',NULL,'request ID reuse with changed content conflicts'
);
SELECT throws_ok(
  $$ SELECT public.prepare_coach_athlete_invitation(
    'a3000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001',
    'other@example.invalid',ARRAY['profile:read']::public.training_coach_permission[]
  ) $$,
  'PT409',NULL,'a second open preparation cannot replace the client invitation'
);
SELECT throws_ok(
  $$ SELECT public.prepare_coach_athlete_invitation(
    'a3000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000002',
    'duplicate@example.invalid',ARRAY['profile:read','profile:read']::public.training_coach_permission[]
  ) $$,
  '22023',NULL,'duplicate permission entries fail closed'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000002","email":"other-coach@example.invalid","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.prepare_coach_athlete_invitation(
    'a3000000-0000-4000-8000-000000000004','a2000000-0000-4000-8000-000000000002',
    'unauthorized@example.invalid',ARRAY['profile:read']::public.training_coach_permission[]
  ) $$,
  'P0001',NULL,'a practitioner cannot prepare an invitation for another practitioner client'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","email":"prepare-coach@example.invalid","aal":"aal1","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.prepare_coach_athlete_invitation(
    'a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
    'athlete@example.invalid',ARRAY['profile:read','program:coach_publish']::public.training_coach_permission[]
  ) $$,
  '42501',NULL,'exact retry rechecks current AAL2 practitioner authority'
);
RESET ROLE;

INSERT INTO auth.users(id,email,created_at,updated_at)
VALUES ('a4000000-0000-4000-8000-000000000001','athlete@example.invalid',clock_timestamp(),clock_timestamp());

SELECT is(
  (SELECT state::text FROM private.athlete_invitations WHERE id::text = (SELECT value->>'invitationId' FROM prepared_result)),
  'provisioned','auth provisioning advances the same invitation'
);
SELECT is(
  (SELECT count(*) FROM public.client_accounts WHERE client_id = 'a2000000-0000-4000-8000-000000000001' AND status = 'active'),
  1::bigint,'provisioning creates one explicit active client bridge'
);

SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","email":"prepare-coach@example.invalid","aal":"aal2","iat":2000000000}',true);
SET LOCAL ROLE authenticated;
SELECT is(
  public.prepare_coach_athlete_invitation(
    'a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
    'athlete@example.invalid',ARRAY['profile:read','program:coach_publish']::public.training_coach_permission[]
  )->>'status',
  'provisioned','lost-response retry recovers the exact provisioned invitation'
);
SELECT is(
  public.prepare_coach_athlete_invitation(
    'a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
    'athlete@example.invalid',ARRAY['profile:read','program:coach_publish']::public.training_coach_permission[]
  )->>'provisionedUserId',
  'a4000000-0000-4000-8000-000000000001','retry binds the exact provisioned auth user'
);
RESET ROLE;

SELECT throws_ok(
  $$ UPDATE private.training_coach_invitation_prepare_requests SET email_normalized = 'mutated@example.invalid' $$,
  '55000',NULL,'prepare request evidence is immutable'
);
SELECT is(
  (SELECT count(*) FROM private.training_coach_invitation_prepare_requests),
  1::bigint,'exact retries do not duplicate durable request evidence'
);

SELECT * FROM finish();
ROLLBACK;

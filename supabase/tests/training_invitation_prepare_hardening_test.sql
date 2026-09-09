BEGIN;

SELECT plan(10);

SELECT ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.issue_coach_athlete_invitation(text,uuid,public.training_coach_permission[],timestamptz)',
    'EXECUTE'
  ),
  'the compatible authenticated direct issuance RPC remains available'
);

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at) VALUES
  ('b1000000-0000-4000-8000-000000000001','hardening-owner@example.invalid',clock_timestamp(),clock_timestamp()),
  ('b1000000-0000-4000-8000-000000000002','hardening-other@example.invalid',clock_timestamp(),clock_timestamp());
INSERT INTO public.practitioners(id,display_name,access_status,role,session_valid_after) VALUES
  ('b1000000-0000-4000-8000-000000000001','Hardening owner','active','practitioner','-infinity'),
  ('b1000000-0000-4000-8000-000000000002','Hardening other','active','practitioner','-infinity');
INSERT INTO public.clients(id,practitioner_id,first_name,last_name) VALUES
  ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Open','Invitation'),
  ('b2000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000001','Prepared','Invitation'),
  ('b2000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000001','No','Invitation');
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000001","email":"hardening-owner@example.invalid","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE direct_invitation AS
SELECT public.issue_coach_athlete_invitation(
  'first-direct@example.invalid',
  'b2000000-0000-4000-8000-000000000001',
  ARRAY['profile:read']::public.training_coach_permission[],
  pg_catalog.clock_timestamp() + interval '7 days'
) AS invitation_id;

SELECT ok((SELECT invitation_id IS NOT NULL FROM direct_invitation),'direct issue still creates the first owned-client invitation');
SELECT throws_ok(
  $$ SELECT public.issue_coach_athlete_invitation(
    'second-direct@example.invalid','b2000000-0000-4000-8000-000000000001',
    ARRAY['profile:read']::public.training_coach_permission[],
    pg_catalog.clock_timestamp() + interval '7 days'
  ) $$,
  'PT409',NULL,'direct issue cannot create a second open invitation for one client'
);
RESET ROLE;
SELECT is(
  (SELECT pg_catalog.count(*) FROM private.athlete_invitations
   WHERE target_client_id = 'b2000000-0000-4000-8000-000000000001'
     AND state IN ('pending','provisioned') AND expires_at > pg_catalog.clock_timestamp()),
  1::bigint,'direct issue leaves exactly one open invitation'
);

SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000001","email":"hardening-owner@example.invalid","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE prepared_invitation AS
SELECT public.prepare_coach_athlete_invitation(
  'b3000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000002',
  'prepared-drift@example.invalid',
  ARRAY['profile:read']::public.training_coach_permission[]
) AS value;
SELECT is((SELECT value->>'status' FROM prepared_invitation),'pending','prepare still creates a pending invitation');
RESET ROLE;

-- The normal auth trigger provisions the pending invitation atomically. Insert
-- with triggers disabled to prove the explicit replay defense against privileged
-- bypass or database drift without misrepresenting this as an ordinary signup.
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users(id,email,created_at,updated_at)
VALUES ('b4000000-0000-4000-8000-000000000001','prepared-drift@example.invalid',clock_timestamp(),clock_timestamp());
SET LOCAL session_replication_role = origin;

SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000001","email":"hardening-owner@example.invalid","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.prepare_coach_athlete_invitation(
    'b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002',
    'prepared-drift@example.invalid',ARRAY['profile:read']::public.training_coach_permission[]
  ) $$,
  'PT409',NULL,'pending exact replay fails closed when privileged drift creates the auth user'
);
RESET ROLE;
SELECT is(
  (SELECT state::text FROM private.athlete_invitations
   WHERE id::text = (SELECT value->>'invitationId' FROM prepared_invitation)),
  'pending','the drift defense does not mutate immutable invitation evidence'
);

SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"b1000000-0000-4000-8000-000000000002","email":"hardening-other@example.invalid","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.prepare_coach_athlete_invitation(
    'b3000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001',
    'oracle-open@example.invalid',ARRAY['profile:read']::public.training_coach_permission[]
  ) $$,
  'P0001',NULL,'an unrelated practitioner cannot observe that another client has an open invitation'
);
SELECT throws_ok(
  $$ SELECT public.prepare_coach_athlete_invitation(
    'b3000000-0000-4000-8000-000000000003','b2000000-0000-4000-8000-000000000003',
    'oracle-empty@example.invalid',ARRAY['profile:read']::public.training_coach_permission[]
  ) $$,
  'P0001',NULL,'an unrelated practitioner gets the same denial when the client has no invitation'
);
RESET ROLE;

SELECT ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.issue_coach_athlete_invitation(text,uuid,public.training_coach_permission[],timestamptz)'::regprocedure
    ),
    'pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 0))'
  ) > 0
  AND pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'public.issue_coach_athlete_invitation(text,uuid,public.training_coach_permission[],timestamptz)'::regprocedure
    ),
    '''coach-invitation-client:'' || p_target_client_id::text'
  ) > 0,
  'direct issue serializes normalized email and target client before issuance'
);

SELECT * FROM finish();
ROLLBACK;

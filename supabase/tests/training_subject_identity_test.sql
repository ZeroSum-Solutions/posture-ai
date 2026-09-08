BEGIN;

SELECT plan(26);

SELECT has_table('public', 'training_subjects', 'training subjects are persisted');
SELECT has_table('public', 'client_accounts', 'optional legacy client bridges are persisted');

SELECT is(
  (
    SELECT pg_catalog.count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'training_subjects'
      AND column_name IN (
        'id', 'owner_user_id', 'status', 'created_at',
        'activated_at', 'revoked_at', 'deleted_at'
      )
  ),
  7::bigint,
  'training subjects expose the auth-owned lifecycle columns'
);

SELECT is(
  (
    SELECT pg_catalog.count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_accounts'
      AND column_name IN (
        'subject_id', 'client_id', 'status', 'claimed_at', 'revoked_at', 'created_at'
      )
  ),
  6::bigint,
  'client accounts expose only bridge lifecycle columns'
);

SELECT ok(
  (
    SELECT c.relrowsecurity
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'training_subjects'
  )
  AND (
    SELECT c.relrowsecurity
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'client_accounts'
  ),
  'both identity tables have RLS enabled'
);

SELECT ok(
  pg_catalog.to_regprocedure('private.is_training_subject_owner(uuid)') IS NOT NULL
  AND pg_catalog.to_regprocedure('private.is_training_subject_coach(uuid,text)') IS NOT NULL,
  'subject owner and future coach predicates exist'
);

SELECT ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'private.is_training_subject_owner(uuid)', 'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'authenticated', 'private.is_training_subject_coach(uuid,text)', 'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'anon', 'private.is_training_subject_owner(uuid)', 'EXECUTE'
  ),
  'only authenticated callers can invoke the RLS predicates'
);

SELECT ok(
  pg_catalog.has_table_privilege('authenticated', 'public.training_subjects', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.training_subjects', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.training_subjects', 'UPDATE')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.training_subjects', 'DELETE')
  AND pg_catalog.has_table_privilege('authenticated', 'public.client_accounts', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.client_accounts', 'INSERT'),
  'authenticated users can read through RLS but cannot write identity rows'
);

SELECT ok(
  NOT pg_catalog.has_table_privilege('anon', 'public.training_subjects', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('anon', 'public.client_accounts', 'SELECT'),
  'anonymous and share-token callers have no table privileges'
);

SELECT ok(
  pg_catalog.has_table_privilege('service_role', 'public.training_subjects', 'INSERT')
  AND pg_catalog.has_table_privilege('service_role', 'public.training_subjects', 'UPDATE')
  AND pg_catalog.has_table_privilege('service_role', 'public.training_subjects', 'DELETE')
  AND pg_catalog.has_table_privilege('service_role', 'public.client_accounts', 'INSERT')
  AND pg_catalog.has_table_privilege('service_role', 'public.client_accounts', 'DELETE'),
  'service authority owns identity writes'
);

-- The identity foundation deliberately does not provision Auth users. These
-- transaction-local rows bypass only fixture foreign keys/triggers.
SET LOCAL session_replication_role = replica;
INSERT INTO public.practitioners (id, display_name, access_status, role)
VALUES (
  '10000000-0000-4000-8000-000000000004',
  'Unrelated identity test practitioner',
  'active',
  'practitioner'
);

INSERT INTO public.training_subjects (
  id, owner_user_id, status, activated_at, revoked_at
) VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'active',
    clock_timestamp(),
    NULL
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'active',
    clock_timestamp(),
    NULL
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000003',
    'revoked',
    clock_timestamp(),
    clock_timestamp()
  );
SET LOCAL session_replication_role = origin;

SELECT is(
  (
    SELECT pg_catalog.count(*)
    FROM public.client_accounts
    WHERE subject_id = '20000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'a self-directed subject exists without a legacy client'
);

SELECT throws_ok(
  $$
    INSERT INTO public.training_subjects (
      owner_user_id, status, activated_at
    ) VALUES (
      '10000000-0000-4000-8000-000000000001', 'active', clock_timestamp()
    )
  $$,
  '23505',
  NULL,
  'one Auth user cannot own two training subjects'
);

SET LOCAL session_replication_role = replica;
INSERT INTO public.clients (id, practitioner_id, first_name, last_name)
VALUES
  (
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    'Linked',
    'Athlete'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000004',
    'Other',
    'Athlete'
  );
INSERT INTO public.client_accounts (subject_id, client_id)
VALUES (
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
);
SET LOCAL session_replication_role = origin;

SELECT throws_ok(
  $$
    INSERT INTO public.client_accounts (subject_id, client_id)
    VALUES (
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002'
    )
  $$,
  '23505',
  NULL,
  'a subject can have at most one legacy client bridge'
);

SELECT throws_ok(
  $$
    INSERT INTO public.client_accounts (subject_id, client_id)
    VALUES (
      '20000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000001'
    )
  $$,
  '23505',
  NULL,
  'a legacy client can bridge to at most one training subject'
);

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT results_eq(
  $$ SELECT id FROM public.training_subjects ORDER BY id $$,
  $$ VALUES ('20000000-0000-4000-8000-000000000001'::uuid) $$,
  'an AAL2 owner reads only their active subject'
);
SELECT results_eq(
  $$ SELECT client_id FROM public.client_accounts $$,
  $$ VALUES ('30000000-0000-4000-8000-000000000001'::uuid) $$,
  'an AAL2 owner reads their optional client bridge'
);
RESET ROLE;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","aal":"aal1","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $$ SELECT id FROM public.training_subjects $$,
  'an AAL1 owner cannot read their subject'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT results_eq(
  $$ SELECT id FROM public.training_subjects $$,
  $$ VALUES ('20000000-0000-4000-8000-000000000002'::uuid) $$,
  'another athlete cannot read the owner subject'
);
SELECT is_empty(
  $$ SELECT client_id FROM public.client_accounts $$,
  'another athlete cannot read the owner bridge'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000004","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $$ SELECT id FROM public.training_subjects $$,
  'an active but unrelated practitioner cannot read a training subject'
);
SELECT is(
  private.is_training_subject_coach(
    '20000000-0000-4000-8000-000000000001', 'history:read'
  ),
  false,
  'the future coach predicate fails closed before relationships exist'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000003","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT is_empty(
  $$ SELECT id FROM public.training_subjects $$,
  'the owner of a revoked subject cannot read it'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config(
  'request.jwt.claims',
  '{"aal":"aal2","workout_token":"opaque-token-shaped-value"}',
  true
);
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT id FROM public.training_subjects $$,
  '42501',
  NULL,
  'a share-token-shaped anonymous session has no identity-table access'
);
RESET ROLE;

SELECT is(
  (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('training_subjects', 'client_accounts')
      AND p.polcmd <> 'r'
  ),
  0::bigint,
  'identity tables expose no authenticated write policy'
);

DELETE FROM public.clients
WHERE id = '30000000-0000-4000-8000-000000000001';

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.training_subjects
    WHERE id = '20000000-0000-4000-8000-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.client_accounts
    WHERE subject_id = '20000000-0000-4000-8000-000000000001'
  ),
  'physical legacy client deletion removes its bridge while preserving athlete ownership'
);

SELECT is(
  (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth'
      AND c.relname = 'users'
      AND t.tgname = 'on_auth_user_created'
      AND t.tgfoid = 'public.handle_new_user()'::regprocedure
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  ),
  1::bigint,
  'the existing practitioner provisioning trigger remains installed and enabled'
);

SELECT * FROM finish();
ROLLBACK;

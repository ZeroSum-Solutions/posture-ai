BEGIN;

SELECT plan(15);

SELECT ok(
  to_regclass('public.clients_active_practitioner_created_id_idx') IS NOT NULL,
  'active-client keyset index exists'
);

SELECT ok(
  to_regclass('public.assessments_complete_client_practitioner_assessed_id_idx') IS NOT NULL,
  'completed-assessment keyset index exists'
);

SELECT ok(
  (SELECT indexdef FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'clients_active_practitioner_created_id_idx')
    LIKE '%(practitioner_id, created_at DESC, id DESC)%'
  AND
  (SELECT indexdef FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'clients_active_practitioner_created_id_idx')
    LIKE '%WHERE ((archived_at IS NULL) AND (deleted_at IS NULL))%',
  'client index matches the active-directory filter and stable order'
);

SELECT ok(
  (SELECT indexdef FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'assessments_complete_client_practitioner_assessed_id_idx')
    LIKE '%(client_id, practitioner_id, assessed_at DESC, id DESC)%'
  AND
  (SELECT indexdef FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'assessments_complete_client_practitioner_assessed_id_idx')
    LIKE '%WHERE (status =%complete%',
  'assessment index matches the completed-history filter and stable order'
);

SELECT is(
  (SELECT count(*)
   FROM pg_index
   WHERE indexrelid IN (
     'public.clients_active_practitioner_created_id_idx'::regclass,
     'public.assessments_complete_client_practitioner_assessed_id_idx'::regclass
   )
   AND indisvalid
   AND indisready),
  2::bigint,
  'both keyset indexes are valid and ready'
);

SELECT is(
  (SELECT count(*) FROM pg_indexes
   WHERE schemaname = 'public'
     AND indexname IN (
       'clients_active_practitioner_created_id_idx',
       'assessments_complete_client_practitioner_assessed_id_idx'
     )),
  2::bigint,
  'the migration creates exactly the two query-supported indexes'
);

SELECT ok(
  to_regprocedure('public.current_keyset_snapshot()') IS NOT NULL,
  'database-precision keyset snapshot function exists'
);

SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc
       WHERE oid = 'public.current_keyset_snapshot()'::regprocedure)
  AND (SELECT provolatile = 'v' FROM pg_proc
       WHERE oid = 'public.current_keyset_snapshot()'::regprocedure),
  'keyset snapshot is a volatile security-invoker database clock read'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.current_keyset_snapshot()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.current_keyset_snapshot()',
    'EXECUTE'
  ),
  'only authenticated callers can read a keyset snapshot'
);

-- 20260803000000_client_directory_trend drops the five-argument function and
-- recreates it with the trailing p_filter text. These assertions name the
-- signature exactly, so they have to follow it -- and the old five-arg form
-- must stay gone rather than linger as an ungoverned overload, which is what
-- the second assertion below now pins.
SELECT ok(
  to_regprocedure('public.list_owned_clients_page(text,timestamptz,timestamptz,uuid,integer,text)') IS NOT NULL,
  'typed bounded client-search function exists'
);

SELECT ok(
  to_regprocedure('public.list_owned_clients_page(text,timestamptz,timestamptz,uuid,integer)') IS NULL,
  'the superseded five-argument client-search overload is gone'
);

SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc
       WHERE oid = 'public.list_owned_clients_page(text,timestamptz,timestamptz,uuid,integer,text)'::regprocedure),
  'client-search function is security invoker so caller RLS remains active'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.list_owned_clients_page(text,timestamptz,timestamptz,uuid,integer,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.list_owned_clients_page(text,timestamptz,timestamptz,uuid,integer,text)',
    'EXECUTE'
  ),
  'only authenticated callers can execute client search'
);

-- Exercise the invoker path as two authenticated practitioners. Structural
-- assertions alone cannot prove that a future function edit preserves tenant
-- isolation.
SET LOCAL session_replication_role = replica;
INSERT INTO public.practitioners (id, display_name, access_status, role)
VALUES
  ('12000000-0000-4000-8000-000000000001', 'Bounded search practitioner A', 'active', 'practitioner'),
  ('12000000-0000-4000-8000-000000000002', 'Bounded search practitioner B', 'active', 'practitioner');
SET LOCAL session_replication_role = origin;

INSERT INTO public.clients (id, practitioner_id, first_name, last_name, created_at)
VALUES
  ('22000000-0000-4000-8000-000000000001', '12000000-0000-4000-8000-000000000001', 'Owned', 'Alpha', '2026-07-20T00:00:00Z'),
  ('22000000-0000-4000-8000-000000000003', '12000000-0000-4000-8000-000000000001', 'Archived', 'Alpha', '2026-07-20T00:00:00Z'),
  ('22000000-0000-4000-8000-000000000004', '12000000-0000-4000-8000-000000000001', 'Deleted', 'Alpha', '2026-07-20T00:00:00Z'),
  ('22000000-0000-4000-8000-000000000002', '12000000-0000-4000-8000-000000000002', 'Owned', 'Beta', '2026-07-20T00:00:00Z');

UPDATE public.clients
SET archived_at = '2026-07-20T01:00:00Z'
WHERE id = '22000000-0000-4000-8000-000000000003';

UPDATE public.clients
SET deleted_at = '2026-07-20T01:00:00Z'
WHERE id = '22000000-0000-4000-8000-000000000004';

SELECT set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000001', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"12000000-0000-4000-8000-000000000001","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT results_eq(
  $$
    SELECT id
    FROM public.list_owned_clients_page('', '2026-07-21T00:00:00Z', NULL, NULL, 51)
  $$,
  $$ VALUES ('22000000-0000-4000-8000-000000000001'::uuid) $$,
  'practitioner A client search cannot return practitioner B records'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000002', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"12000000-0000-4000-8000-000000000002","aal":"aal2","iat":2000000000}',
  true
);
SET LOCAL ROLE authenticated;
SELECT results_eq(
  $$
    SELECT id
    FROM public.list_owned_clients_page('', '2026-07-21T00:00:00Z', NULL, NULL, 51)
  $$,
  $$ VALUES ('22000000-0000-4000-8000-000000000002'::uuid) $$,
  'practitioner B client search cannot return practitioner A records'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

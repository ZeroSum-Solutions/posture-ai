BEGIN;

SELECT plan(9);

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
  to_regprocedure('public.list_owned_clients_page(text,timestamptz,timestamptz,uuid,integer)') IS NOT NULL,
  'typed bounded client-search function exists'
);

SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc
       WHERE oid = 'public.list_owned_clients_page(text,timestamptz,timestamptz,uuid,integer)'::regprocedure),
  'client-search function is security invoker so caller RLS remains active'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.list_owned_clients_page(text,timestamptz,timestamptz,uuid,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.list_owned_clients_page(text,timestamptz,timestamptz,uuid,integer)',
    'EXECUTE'
  ),
  'only authenticated callers can execute client search'
);

SELECT * FROM finish();
ROLLBACK;

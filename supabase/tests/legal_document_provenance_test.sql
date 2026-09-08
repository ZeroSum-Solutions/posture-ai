BEGIN;

SELECT plan(44);

-- Transaction-local fixtures for the two governed RPC seams. The practitioner
-- FK points at auth.users; bypass only that fixture FK trigger, then immediately
-- restore normal trigger behavior before exercising application tables/RPCs.
SET LOCAL session_replication_role = replica;
INSERT INTO public.practitioners (id, display_name, access_status, role)
VALUES (
  '10000000-0000-0000-0000-000000000001'::uuid,
  'Legal provenance test practitioner',
  'active',
  'practitioner'
);
SET LOCAL session_replication_role = origin;

INSERT INTO public.clients (id, practitioner_id, first_name, last_name)
VALUES
  (
    '20000000-0000-0000-0000-000000000001'::uuid,
    '10000000-0000-0000-0000-000000000001'::uuid,
    'Remote',
    'Fixture'
  ),
  (
    '20000000-0000-0000-0000-000000000002'::uuid,
    '10000000-0000-0000-0000-000000000001'::uuid,
    'InPerson',
    'Fixture'
  );

INSERT INTO public.consent_tokens (
  client_id,
  practitioner_id,
  consent_version,
  expires_at,
  token_hash,
  legal_document_id,
  legal_document_version,
  legal_document_body_sha256,
  legal_document_effective_at,
  legal_jurisdiction,
  legal_product_scope,
  legal_provenance_state
) VALUES (
  '20000000-0000-0000-0000-000000000001'::uuid,
  '10000000-0000-0000-0000-000000000001'::uuid,
  'test-fixture-v1',
  clock_timestamp() + interval '1 hour',
  repeat('a', 64),
  'subject-consent-test-fixture-v1',
  'test-fixture-v1',
  repeat('b', 64),
  clock_timestamp() - interval '1 day',
  'US',
  'us_fitness_wellness_assessment_beta_v1',
  'governed'
);

SELECT has_table(
  'public',
  'practitioner_legal_acceptances',
  'practitioner legal acceptances are persisted'
);

SELECT ok(
  (
    SELECT c.relrowsecurity
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'practitioner_legal_acceptances'
  ),
  'practitioner legal acceptances have RLS enabled'
);

SELECT ok(
  pg_catalog.has_table_privilege('authenticated', 'public.practitioner_legal_acceptances', 'SELECT'),
  'authenticated practitioners may read acceptance rows through RLS'
);

SELECT ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.practitioner_legal_acceptances', 'INSERT'),
  'authenticated practitioners cannot insert acceptance rows directly'
);

SELECT ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.practitioner_legal_acceptances', 'UPDATE'),
  'authenticated practitioners cannot update acceptance rows'
);

SELECT ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.practitioner_legal_acceptances', 'DELETE'),
  'authenticated practitioners cannot delete acceptance rows'
);

SELECT ok(
  NOT pg_catalog.has_table_privilege('anon', 'public.practitioner_legal_acceptances', 'SELECT'),
  'anonymous users cannot read practitioner acceptance rows'
);

SELECT ok(
  pg_catalog.has_table_privilege('service_role', 'public.practitioner_legal_acceptances', 'INSERT'),
  'service role may insert practitioner acceptance rows'
);

SELECT ok(
  NOT pg_catalog.has_table_privilege('service_role', 'public.practitioner_legal_acceptances', 'UPDATE')
  AND NOT pg_catalog.has_table_privilege('service_role', 'public.practitioner_legal_acceptances', 'DELETE'),
  'service role cannot mutate or delete practitioner acceptance rows'
);

SELECT is(
  (
    SELECT pg_catalog.count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('consent_tokens', 'consent_records', 'assessments', 'reports', 'workout_sessions')
      AND column_name IN (
        'legal_document_id',
        'legal_document_version',
        'legal_document_body_sha256',
        'legal_document_effective_at',
        'legal_jurisdiction',
        'legal_product_scope',
        'legal_provenance_state'
      )
  ),
  35::bigint,
  'all five regulated tables expose the seven legal provenance columns'
);

SELECT is(
  (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('consent_tokens', 'consent_records', 'assessments', 'reports', 'workout_sessions')
      AND t.tgname LIKE '%legal_provenance_immutable'
      AND NOT t.tgisinternal
  ),
  5::bigint,
  'legal provenance is immutable on every regulated table'
);

SELECT ok(
  pg_catalog.to_regprocedure(
    'public.record_inperson_consent_governed(uuid,uuid,text,text,text,timestamp with time zone,text,text,text,text,text,timestamp with time zone)'
  ) IS NOT NULL,
  'governed in-person consent RPC exists'
);

SELECT ok(
  pg_catalog.to_regprocedure(
    'public.record_remote_consent_governed(text,text,text,text,text,text,text,timestamp with time zone)'
  ) IS NOT NULL,
  'governed remote consent RPC exists'
);

SELECT ok(
  pg_catalog.to_regprocedure(
    'public.create_client_with_inperson_consent_governed(uuid,text,text,date,text,numeric,numeric,text,text,text,text,timestamp with time zone,text,text,text,text,text,timestamp with time zone)'
  ) IS NOT NULL,
  'atomic governed client enrollment RPC exists'
);

SELECT ok(
  pg_catalog.to_regprocedure('public.activate_legal_governance()') IS NOT NULL,
  'one-way legal governance activation RPC exists'
);

SELECT ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.record_inperson_consent_governed(uuid,uuid,text,text,text,timestamp with time zone,text,text,text,text,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'service role may execute governed in-person consent'
);

SELECT ok(
  NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.record_inperson_consent_governed(uuid,uuid,text,text,text,timestamp with time zone,text,text,text,text,text,timestamp with time zone)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'anon',
    'public.record_inperson_consent_governed(uuid,uuid,text,text,text,timestamp with time zone,text,text,text,text,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'browser roles cannot execute governed in-person consent'
);

SELECT ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.record_remote_consent_governed(text,text,text,text,text,text,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'service role may execute governed remote consent'
);

SELECT ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.create_client_with_inperson_consent_governed(uuid,text,text,date,text,numeric,numeric,text,text,text,text,timestamp with time zone,text,text,text,text,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'service role may execute atomic governed client enrollment'
);

SELECT ok(
  NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.create_client_with_inperson_consent_governed(uuid,text,text,date,text,numeric,numeric,text,text,text,text,timestamp with time zone,text,text,text,text,text,timestamp with time zone)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'anon',
    'public.create_client_with_inperson_consent_governed(uuid,text,text,date,text,numeric,numeric,text,text,text,text,timestamp with time zone,text,text,text,text,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'browser roles cannot execute atomic governed client enrollment'
);

SELECT ok(
  pg_catalog.has_function_privilege('service_role', 'public.activate_legal_governance()', 'EXECUTE'),
  'service role may activate the legal governance latch'
);

SELECT ok(
  NOT pg_catalog.has_function_privilege('authenticated', 'public.activate_legal_governance()', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon', 'public.activate_legal_governance()', 'EXECUTE'),
  'browser roles cannot activate the legal governance latch'
);

SELECT ok(
  NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.record_remote_consent_governed(text,text,text,text,text,text,text,timestamp with time zone)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'anon',
    'public.record_remote_consent_governed(text,text,text,text,text,text,text,timestamp with time zone)',
    'EXECUTE'
  ),
  'browser roles cannot execute governed remote consent'
);

SELECT ok(
  (
    SELECT p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'record_inperson_consent_governed'
  ),
  'governed in-person consent is SECURITY DEFINER with an empty search path'
);

SELECT ok(
  (
    SELECT p.prosecdef
      AND p.proconfig @> ARRAY['search_path=""']::text[]
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'record_remote_consent_governed'
  ),
  'governed remote consent is SECURITY DEFINER with an empty search path'
);

SELECT is(
  public.record_inperson_consent_governed(
    NULL::uuid,
    NULL::uuid,
    NULL::text,
    NULL::text,
    NULL::text,
    NULL::timestamptz,
    NULL::text,
    NULL::text,
    NULL::text,
    NULL::text,
    NULL::text,
    NULL::timestamptz
  ),
  'invalid_input'::text,
  'governed in-person consent rejects incomplete provenance'
);

SELECT is(
  public.record_remote_consent_governed(
    NULL::text,
    NULL::text,
    NULL::text,
    NULL::text,
    NULL::text,
    NULL::text,
    NULL::text,
    NULL::timestamptz
  ),
  'invalid_input'::text,
  'governed remote consent rejects incomplete provenance'
);

SELECT is(
  public.record_remote_consent_governed(
    repeat('a', 64),
    'subject-consent-test-fixture-v1',
    'test-fixture-v1',
    repeat('b', 64),
    'Remote Fixture',
    'self',
    repeat('c', 64),
    clock_timestamp()
  ),
  'ok'::text,
  'governed remote consent accepts the exact token-bound document'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.consent_records cr
    WHERE cr.client_id = '20000000-0000-0000-0000-000000000001'::uuid
      AND cr.legal_document_id = 'subject-consent-test-fixture-v1'
      AND cr.legal_document_version = 'test-fixture-v1'
      AND cr.legal_document_body_sha256 = repeat('b', 64)
      AND cr.legal_jurisdiction = 'US'
      AND cr.legal_product_scope = 'us_fitness_wellness_assessment_beta_v1'
      AND cr.legal_provenance_state = 'governed'
      AND cr.consent_version = cr.legal_document_version
  )
  AND EXISTS (
    SELECT 1
    FROM public.consent_tokens ct
    WHERE ct.token_hash = repeat('a', 64)
      AND ct.consumed_at IS NOT NULL
  ),
  'remote consent atomically copies exact provenance and consumes the token'
);

SELECT is(
  public.record_inperson_consent_governed(
    '20000000-0000-0000-0000-000000000002'::uuid,
    '10000000-0000-0000-0000-000000000001'::uuid,
    'subject-consent-test-fixture-v2',
    'test-fixture-v2',
    repeat('d', 64),
    clock_timestamp() - interval '1 day',
    'US',
    'us_fitness_wellness_assessment_beta_v1',
    'InPerson Fixture',
    'self',
    repeat('e', 64),
    clock_timestamp()
  ),
  'ok'::text,
  'governed in-person consent accepts complete reviewed-source provenance'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.consent_records cr
    WHERE cr.client_id = '20000000-0000-0000-0000-000000000002'::uuid
      AND cr.legal_document_id = 'subject-consent-test-fixture-v2'
      AND cr.legal_document_version = 'test-fixture-v2'
      AND cr.legal_document_body_sha256 = repeat('d', 64)
      AND cr.legal_jurisdiction = 'US'
      AND cr.legal_product_scope = 'us_fitness_wellness_assessment_beta_v1'
      AND cr.legal_provenance_state = 'governed'
      AND cr.consent_version = cr.legal_document_version
  ),
  'in-person consent atomically copies exact reviewed-source provenance'
);

CREATE TEMP TABLE atomic_client_result (id uuid NOT NULL);
INSERT INTO atomic_client_result (id)
SELECT (public.create_client_with_inperson_consent_governed(
  '10000000-0000-0000-0000-000000000001'::uuid,
  'Atomic',
  'Enrollment',
  '1990-01-01'::date,
  'female',
  170,
  65,
  'transactional fixture',
  'subject-consent-test-fixture-v2',
  'test-fixture-v2',
  repeat('f', 64),
  clock_timestamp() - interval '1 day',
  'US',
  'us_fitness_wellness_assessment_beta_v1',
  'Atomic Enrollment',
  'self',
  repeat('9', 64),
  clock_timestamp()
)->>'id')::uuid;

SELECT ok(
  EXISTS (
    SELECT 1
    FROM atomic_client_result result
    JOIN public.clients c ON c.id = result.id
    JOIN public.consent_records cr ON cr.client_id = c.id
    WHERE c.first_name = 'Atomic'
      AND c.consent_recorded_at IS NOT NULL
      AND cr.legal_document_id = 'subject-consent-test-fixture-v2'
      AND cr.legal_provenance_state = 'governed'
  ),
  'atomic enrollment commits the client and exact governed consent together'
);

-- A historical legacy row must remain lifecycle-updatable after cutover (approval,
-- erasure redaction, and other non-provenance maintenance), while every NEW legacy
-- regulated row is rejected.
INSERT INTO public.assessments (
  id, client_id, practitioner_id, status
) VALUES (
  '30000000-0000-0000-0000-000000000001'::uuid,
  '20000000-0000-0000-0000-000000000002'::uuid,
  '10000000-0000-0000-0000-000000000001'::uuid,
  'processing'
);

SELECT ok(
  public.activate_legal_governance() IS NOT NULL,
  'legal governance activation records an irreversible activation time'
);

SELECT throws_ok(
  $$
    INSERT INTO public.assessments (client_id, practitioner_id, status)
    VALUES (
      '20000000-0000-0000-0000-000000000002'::uuid,
      '10000000-0000-0000-0000-000000000001'::uuid,
      'processing'
    )
  $$,
  '55000',
  'legal governance is active: legacy_unverified writes are disabled',
  'activation rejects new legacy regulated rows'
);

SELECT lives_ok(
  $$
    UPDATE public.assessments
      SET status = 'failed'
      WHERE id = '30000000-0000-0000-0000-000000000001'::uuid
  $$,
  'activation preserves non-provenance lifecycle updates to historical legacy rows'
);

SELECT lives_ok(
  $$
    INSERT INTO public.reports (
      assessment_id,
      practitioner_id,
      legal_document_id,
      legal_document_version,
      legal_document_body_sha256,
      legal_document_effective_at,
      legal_jurisdiction,
      legal_product_scope,
      legal_provenance_state,
      report_scope
    ) VALUES (
      '30000000-0000-0000-0000-000000000001'::uuid,
      '10000000-0000-0000-0000-000000000001'::uuid,
      'screening-notice-test-fixture-v1',
      'test-fixture-v1',
      repeat('8', 64),
      clock_timestamp() - interval '1 day',
      'US',
      'us_fitness_wellness_assessment_beta_v1',
      'governed',
      'assessment_only'
    )
  $$,
  'activation continues to allow new governed regulated rows'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'workout_sessions'
      AND t.tgname = 'workout_sessions_program_snapshot_provenance'
      AND NOT t.tgisinternal
  ),
  'workout snapshots have a dedicated notice-binding trigger'
);

SELECT throws_ok(
  $$
    INSERT INTO public.workout_sessions (
      assessment_id, client_id, practitioner_id, week, capability,
      program_snapshot, session_token_hash, expires_at,
      legal_document_id, legal_document_version, legal_document_body_sha256,
      legal_document_effective_at, legal_jurisdiction, legal_product_scope,
      legal_provenance_state, clinical_content_version,
      clinical_inventory_sha256, clinical_review_receipt_sha256
    ) VALUES (
      '30000000-0000-0000-0000-000000000001'::uuid,
      '20000000-0000-0000-0000-000000000002'::uuid,
      '10000000-0000-0000-0000-000000000001'::uuid,
      1,
      'standard',
      '{"version":3,"week":1,"capability":"standard","priorities":[],"items":[],"estimatedDurationSec":60,"legalNotice":{"schemaVersion":1,"documentId":"wrong-id","kind":"screening_notice","version":"test-fixture-v1","effectiveAt":"2026-07-20T00:00:00Z","jurisdiction":"US","productScope":"us_fitness_wellness_assessment_beta_v1","bodySha256":"7777777777777777777777777777777777777777777777777777777777777777"},"clinicalContent":{"version":"clinical-content-test-fixture-v1","inventorySha256":"2265d8cfadd904a9d888617c3876b714dc65e01aec354c2efd84e264d78fe563"}}'::jsonb,
      repeat('5', 64),
      clock_timestamp() + interval '1 day',
      'screening-notice-test-fixture-v1',
      'test-fixture-v1',
      repeat('7', 64),
      '2026-07-20T00:00:00Z'::timestamptz,
      'US',
      'us_fitness_wellness_assessment_beta_v1',
      'governed',
      'clinical-content-test-fixture-v1',
      '2265d8cfadd904a9d888617c3876b714dc65e01aec354c2efd84e264d78fe563',
      repeat('f', 64)
    )
  $$,
  '55000',
  'workout snapshot legal notice does not match stored provenance',
  'governed workout insert rejects mismatched embedded notice provenance'
);

SELECT lives_ok(
  $$
    INSERT INTO public.workout_sessions (
      id, assessment_id, client_id, practitioner_id, week, capability,
      program_snapshot, session_token_hash, expires_at,
      legal_document_id, legal_document_version, legal_document_body_sha256,
      legal_document_effective_at, legal_jurisdiction, legal_product_scope,
      legal_provenance_state, clinical_content_version,
      clinical_inventory_sha256, clinical_review_receipt_sha256
    ) VALUES (
      '40000000-0000-0000-0000-000000000001'::uuid,
      '30000000-0000-0000-0000-000000000001'::uuid,
      '20000000-0000-0000-0000-000000000002'::uuid,
      '10000000-0000-0000-0000-000000000001'::uuid,
      1,
      'standard',
      '{"version":3,"week":1,"capability":"standard","priorities":[],"items":[],"estimatedDurationSec":60,"legalNotice":{"schemaVersion":1,"documentId":"screening-notice-test-fixture-v1","kind":"screening_notice","version":"test-fixture-v1","effectiveAt":"2026-07-20T00:00:00Z","jurisdiction":"US","productScope":"us_fitness_wellness_assessment_beta_v1","bodySha256":"7777777777777777777777777777777777777777777777777777777777777777"},"clinicalContent":{"version":"clinical-content-test-fixture-v1","inventorySha256":"2265d8cfadd904a9d888617c3876b714dc65e01aec354c2efd84e264d78fe563"}}'::jsonb,
      repeat('6', 64),
      clock_timestamp() + interval '1 day',
      'screening-notice-test-fixture-v1',
      'test-fixture-v1',
      repeat('7', 64),
      '2026-07-20T00:00:00Z'::timestamptz,
      'US',
      'us_fitness_wellness_assessment_beta_v1',
      'governed',
      'clinical-content-test-fixture-v1',
      '2265d8cfadd904a9d888617c3876b714dc65e01aec354c2efd84e264d78fe563',
      repeat('f', 64)
    )
  $$,
  'governed workout insert accepts an exactly bound embedded notice'
);

UPDATE public.assessments
  SET practitioner_approved = true
  WHERE id = '30000000-0000-0000-0000-000000000001'::uuid;

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.resolve_workout_token(repeat('6', 64)) resolved
    WHERE resolved.legal_document_id = 'screening-notice-test-fixture-v1'
      AND resolved.legal_document_version = 'test-fixture-v1'
      AND resolved.legal_document_body_sha256 = repeat('7', 64)
      AND resolved.legal_document_effective_at = '2026-07-20T00:00:00Z'::timestamptz
      AND resolved.legal_jurisdiction = 'US'
      AND resolved.legal_product_scope = 'us_fitness_wellness_assessment_beta_v1'
      AND resolved.legal_provenance_state = 'governed'
  ),
  'public workout resolver returns protected legal provenance for projection validation'
);

SELECT throws_ok(
  $$
    UPDATE public.workout_sessions
      SET program_snapshot = pg_catalog.jsonb_set(program_snapshot, '{week}', '2'::jsonb)
      WHERE id = '40000000-0000-0000-0000-000000000001'::uuid
  $$,
  '55000',
  'workout program snapshot is immutable',
  'a workout program snapshot cannot change after minting'
);

SELECT lives_ok(
  $$
    UPDATE public.workout_sessions
      SET status = 'archived'
      WHERE id = '40000000-0000-0000-0000-000000000001'::uuid
  $$,
  'ordinary workout lifecycle updates remain available'
);

SELECT ok(
  (SELECT status = 'archived'
   FROM public.workout_sessions
   WHERE id = '40000000-0000-0000-0000-000000000001'::uuid),
  'the permitted workout lifecycle update persisted'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'practitioner_legal_acceptances'
      AND t.tgname = 'practitioner_legal_acceptances_append_only'
      AND NOT t.tgisinternal
  ),
  'practitioner acceptance rows have an append-only trigger'
);

SELECT * FROM finish();
ROLLBACK;

BEGIN;

SELECT plan(47);

SELECT has_table('public', 'clinical_content_review_receipts', 'clinical review receipt ledger exists');
SELECT has_table('public', 'clinical_content_releases', 'clinical release ledger exists');
SELECT has_table('public', 'clinical_content_release_items', 'itemized clinical review ledger exists');

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'report_scope'
  )
  AND (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('reports', 'workout_sessions')
      AND column_name IN (
        'clinical_content_version',
        'clinical_inventory_sha256',
        'clinical_review_receipt_sha256'
      )
  ) = 6,
  'reports and workouts expose complete clinical provenance columns'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_trigger trigger_row
    JOIN pg_catalog.pg_class relation ON relation.oid = trigger_row.tgrelid
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'clinical_content_review_receipts',
        'clinical_content_releases',
        'clinical_content_release_items'
      )
      AND trigger_row.tgname LIKE '%append_only'
      AND NOT trigger_row.tgisinternal
  ),
  3::bigint,
  'receipt, release, and reviewed-item records are append-only'
);

SELECT ok(
  NOT pg_catalog.has_table_privilege('anon', 'public.imbalance_definitions', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.imbalance_definitions', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('anon', 'public.exercises', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.exercises', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('anon', 'public.muscles', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.muscles', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('anon', 'public.muscle_imbalance_links', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.muscle_imbalance_links', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('anon', 'public.exercise_muscles', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.exercise_muscles', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('anon', 'public.exercise_recommendations', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.exercise_recommendations', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('anon', 'public.clinical_content_releases', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('authenticated', 'public.clinical_content_releases', 'SELECT'),
  'browser roles cannot read authored or reviewed clinical tables directly'
);

SELECT ok(
  NOT pg_catalog.has_table_privilege('service_role', 'public.imbalance_definitions', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('service_role', 'public.exercises', 'UPDATE')
  AND NOT pg_catalog.has_table_privilege('service_role', 'public.muscles', 'DELETE')
  AND NOT pg_catalog.has_table_privilege('service_role', 'public.muscle_imbalance_links', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('service_role', 'public.exercise_muscles', 'UPDATE')
  AND NOT pg_catalog.has_table_privilege('service_role', 'public.exercise_recommendations', 'DELETE')
  AND NOT pg_catalog.has_table_privilege('service_role', 'public.clinical_content_review_receipts', 'INSERT')
  AND NOT pg_catalog.has_table_privilege('service_role', 'public.clinical_content_releases', 'UPDATE')
  AND NOT pg_catalog.has_table_privilege('service_role', 'public.clinical_content_release_items', 'DELETE'),
  'the server application role cannot mutate clinical source or governance records'
);

SELECT ok(
  pg_catalog.has_table_privilege('service_role', 'public.imbalance_definitions', 'SELECT')
  AND pg_catalog.has_table_privilege('service_role', 'public.exercises', 'SELECT')
  AND pg_catalog.has_table_privilege('service_role', 'public.muscles', 'SELECT')
  AND pg_catalog.has_table_privilege('service_role', 'public.muscle_imbalance_links', 'SELECT')
  AND pg_catalog.has_table_privilege('service_role', 'public.exercise_muscles', 'SELECT')
  AND pg_catalog.has_table_privilege('service_role', 'public.exercise_recommendations', 'SELECT')
  AND pg_catalog.has_table_privilege('service_role', 'public.clinical_content_review_receipts', 'SELECT')
  AND pg_catalog.has_table_privilege('service_role', 'public.clinical_content_releases', 'SELECT')
  AND pg_catalog.has_table_privilege('service_role', 'public.clinical_content_release_items', 'SELECT'),
  'the server may read clinical records only after its server-side release gate passes'
);

SELECT is(
  (SELECT public FROM storage.buckets WHERE id = 'exercise-media'),
  false,
  'exercise media cannot bypass the clinical gate through a public provider URL'
);

SELECT ok(
  pg_catalog.has_function_privilege(
    'anon',
    'public.verify_clinical_content_activation(text,text,text,boolean,boolean,boolean,boolean)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'authenticated',
    'public.verify_clinical_content_activation(text,text,text,boolean,boolean,boolean,boolean)',
    'EXECUTE'
  ),
  'application roles may ask only whether an exact clinical activation tuple matches'
);

SELECT is(
  public.verify_clinical_content_activation(
    'clinical-content-test-fixture-v1',
    '2265d8cfadd904a9d888617c3876b714dc65e01aec354c2efd84e264d78fe563',
    repeat('f', 64),
    true, true, true, true
  ),
  true,
  'the exact local fixture activation tuple is independently attestable'
);

SELECT ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.finalize_report_upload_v2(uuid,uuid,text,uuid,text,text,text,timestamp with time zone,text,text,text,text,text)',
    'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'service_role',
    'public.create_workout_session_clinical_governed(uuid,uuid,uuid,integer,text,jsonb,integer,text,timestamp with time zone,uuid,text,text,text,text,timestamp with time zone,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.finalize_report_upload_v2(uuid,uuid,text,uuid,text,text,text,timestamp with time zone,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'anon',
    'public.create_workout_session_clinical_governed(uuid,uuid,uuid,integer,text,jsonb,integer,text,timestamp with time zone,uuid,text,text,text,text,timestamp with time zone,text,text,text,text)',
    'EXECUTE'
  ),
  'only service role can execute versioned clinical artifact boundaries'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM private.clinical_content_activation activation
    JOIN public.clinical_content_releases release ON release.id = activation.release_id
    JOIN public.clinical_content_review_receipts receipt
      ON receipt.receipt_sha256 = release.hg03_receipt_sha256
    WHERE activation.singleton = true
      AND release.id = 'clinical-content-test-fixture-v1'
      AND release.inventory_sha256 = '2265d8cfadd904a9d888617c3876b714dc65e01aec354c2efd84e264d78fe563'
      AND release.release_kind = 'local_test_fixture'
      AND receipt.receipt_kind = 'local_test_fixture'
      AND receipt.attestation = 'local_test_fixture_not_clinical_approval'
  ),
  'local reset activates only the explicitly labelled fixture at the exact inventory hash'
);

SELECT is(
  (SELECT count(*) FROM public.clinical_content_releases WHERE release_kind = 'hg03_approved'),
  0::bigint,
  'the local seed fabricates no HG-03-approved release'
);

SELECT throws_ok(
  $$ UPDATE public.clinical_content_review_receipts SET signed_at = clock_timestamp() $$,
  '55000',
  'clinical governance records are append-only',
  'clinical review receipts cannot be changed'
);
SELECT throws_ok(
  $$ UPDATE public.clinical_content_releases SET workouts_enabled = false $$,
  '55000',
  'clinical governance records are append-only',
  'clinical releases cannot be changed'
);
SELECT throws_ok(
  $$ DELETE FROM public.clinical_content_release_items $$,
  '55000',
  'clinical governance records are append-only',
  'reviewed item decisions cannot be deleted'
);

-- Regulated artifact fixture.
SET LOCAL session_replication_role = replica;
INSERT INTO public.practitioners (id, display_name, access_status, role)
VALUES ('12000000-0000-4000-8000-000000000001', 'Clinical fixture practitioner', 'active', 'practitioner');
SET LOCAL session_replication_role = origin;

INSERT INTO public.clients (id, practitioner_id, first_name, last_name)
VALUES (
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  'Clinical',
  'Fixture'
);

SELECT is(
  public.record_inperson_consent_governed(
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    'subject-consent-test-fixture-v1', 'test-1', repeat('a', 64),
    '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
    'Clinical Fixture', 'self', repeat('b', 64), clock_timestamp()
  ),
  'ok'::text,
  'clinical artifact fixture has active governed consent'
);

INSERT INTO public.assessments (
  id, client_id, practitioner_id, status, practitioner_approved
) VALUES (
  '32000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  'complete', true
);

INSERT INTO public.privacy_storage_deletion_outbox (
  deletion_receipt_id, source_code, bucket, object_path, next_attempt_at
) VALUES (
  NULL, 'report_insert_compensation', 'posture-reports',
  '12000000-0000-4000-8000-000000000001/32000000-0000-4000-8000-000000000001/practitioner/assessment-only.pdf',
  clock_timestamp() + interval '15 minutes'
);
CREATE TEMP TABLE assessment_report_result AS
SELECT public.finalize_report_upload_v2(
  '32000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001/32000000-0000-4000-8000-000000000001/practitioner/assessment-only.pdf',
  NULL, 'screening-notice-test-fixture-v1', 'test-1', repeat('c', 64),
  '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
  'assessment_only', NULL, NULL
) AS value;
SELECT is(
  (SELECT value->>'status' FROM assessment_report_result),
  'created',
  'assessment-only report finalization remains available'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.reports
    WHERE id = (SELECT (value->>'report_id')::uuid FROM assessment_report_result)
      AND report_scope = 'assessment_only'
      AND clinical_content_version IS NULL
      AND clinical_inventory_sha256 IS NULL
      AND clinical_review_receipt_sha256 IS NULL
  ),
  'assessment-only report stores no fabricated clinical provenance'
);

INSERT INTO public.privacy_storage_deletion_outbox (
  deletion_receipt_id, source_code, bucket, object_path, next_attempt_at
) VALUES (
  NULL, 'report_insert_compensation', 'posture-reports',
  '12000000-0000-4000-8000-000000000001/32000000-0000-4000-8000-000000000001/practitioner/wrong-release.pdf',
  clock_timestamp() + interval '15 minutes'
);
SELECT ok(
  public.finalize_report_upload_v2(
    '32000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001/32000000-0000-4000-8000-000000000001/practitioner/wrong-release.pdf',
    NULL, 'screening-notice-test-fixture-v1', 'test-1', repeat('c', 64),
    '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
    'clinical_practitioner', 'wrong-release', repeat('0', 64)
  )->>'status' = 'clinical_content_unavailable'
  AND EXISTS (
    SELECT 1 FROM public.privacy_storage_deletion_outbox
    WHERE object_path LIKE '%/wrong-release.pdf'
  ),
  'clinical report mismatch fails closed without consuming cleanup intent'
);

INSERT INTO public.privacy_storage_deletion_outbox (
  deletion_receipt_id, source_code, bucket, object_path, next_attempt_at
) VALUES (
  NULL, 'report_insert_compensation', 'posture-reports',
  '12000000-0000-4000-8000-000000000001/32000000-0000-4000-8000-000000000001/practitioner/clinical.pdf',
  clock_timestamp() + interval '15 minutes'
);
CREATE TEMP TABLE clinical_report_result AS
SELECT public.finalize_report_upload_v2(
  '32000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001/32000000-0000-4000-8000-000000000001/practitioner/clinical.pdf',
  NULL, 'screening-notice-test-fixture-v1', 'test-1', repeat('c', 64),
  '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
  'clinical_practitioner', 'clinical-content-test-fixture-v1',
  '2265d8cfadd904a9d888617c3876b714dc65e01aec354c2efd84e264d78fe563'
) AS value;
SELECT is(
  (SELECT value->>'status' FROM clinical_report_result),
  'created',
  'clinical report finalizes against the exact active release'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.reports
    WHERE id = (SELECT (value->>'report_id')::uuid FROM clinical_report_result)
      AND report_scope = 'clinical_practitioner'
      AND clinical_content_version = 'clinical-content-test-fixture-v1'
      AND clinical_inventory_sha256 = '2265d8cfadd904a9d888617c3876b714dc65e01aec354c2efd84e264d78fe563'
      AND clinical_review_receipt_sha256 = repeat('f', 64)
  ),
  'clinical report persists exact immutable release and receipt provenance'
);

INSERT INTO public.privacy_storage_deletion_outbox (
  deletion_receipt_id, source_code, bucket, object_path, next_attempt_at
) VALUES (
  NULL, 'report_insert_compensation', 'posture-reports',
  '12000000-0000-4000-8000-000000000001/32000000-0000-4000-8000-000000000001/practitioner/legacy-finalizer.pdf',
  clock_timestamp() + interval '15 minutes'
);
SELECT is(
  public.finalize_report_upload(
    '32000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001/32000000-0000-4000-8000-000000000001/practitioner/legacy-finalizer.pdf',
    NULL, 'screening-notice-test-fixture-v1', 'test-1', repeat('c', 64),
    '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1'
  )->>'status',
  'clinical_provenance_required',
  'legacy unversioned report finalizer is a hard denial'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.privacy_storage_deletion_outbox
    WHERE object_path LIKE '%/legacy-finalizer.pdf'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.reports WHERE storage_path LIKE '%/legacy-finalizer.pdf'
  ),
  'legacy finalizer neither stores a report nor consumes cleanup intent'
);

SELECT is(
  public.create_workout_session_governed(
    '32000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    1, 'standard', '{"version":2}'::jsonb, 60, repeat('1', 64),
    clock_timestamp() + interval '1 day',
    '52000000-0000-4000-8000-000000000001', NULL,
    'screening-notice-test-fixture-v1', 'test-1', repeat('c', 64),
    '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1'
  )->>'status',
  'clinical_content_unavailable',
  'legacy unversioned workout creator is a hard denial'
);

SELECT throws_ok(
  $$
    INSERT INTO public.workout_sessions (
      assessment_id, client_id, practitioner_id, week, capability, program_snapshot
    ) VALUES (
      '32000000-0000-4000-8000-000000000001',
      '22000000-0000-4000-8000-000000000001',
      '12000000-0000-4000-8000-000000000001',
      1, 'standard', '{"version":2}'::jsonb
    )
  $$,
  '55000',
  'workout clinical release is not active',
  'direct legacy workout insertion is denied'
);

SELECT is(
  public.create_workout_session_clinical_governed(
    '32000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    1, 'standard',
    pg_catalog.jsonb_build_object(
      'version', 3, 'week', 1, 'capability', 'standard',
      'priorities', '[]'::jsonb, 'items', '[]'::jsonb,
      'estimatedDurationSec', 60,
      'legalNotice', pg_catalog.jsonb_build_object(
        'schemaVersion', 1, 'documentId', 'screening-notice-test-fixture-v1',
        'kind', 'screening_notice', 'version', 'test-1',
        'effectiveAt', '2026-07-19T00:00:00Z', 'jurisdiction', 'US',
        'productScope', 'us_fitness_wellness_assessment_beta_v1',
        'bodySha256', repeat('c', 64)
      ),
      'clinicalContent', pg_catalog.jsonb_build_object(
        'version', 'clinical-content-test-fixture-v1',
        'inventorySha256', repeat('0', 64)
      )
    ),
    60, repeat('2', 64), clock_timestamp() + interval '1 day',
    '52000000-0000-4000-8000-000000000002', NULL,
    'screening-notice-test-fixture-v1', 'test-1', repeat('c', 64),
    '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
    'clinical-content-test-fixture-v1', repeat('0', 64)
  )->>'status',
  'clinical_content_unavailable',
  'workout creation rejects a non-active inventory hash'
);

CREATE TEMP TABLE clinical_workout_result AS
SELECT public.create_workout_session_clinical_governed(
  '32000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  1, 'standard',
  pg_catalog.jsonb_build_object(
    'version', 3, 'week', 1, 'capability', 'standard',
    'priorities', '[]'::jsonb, 'items', '[]'::jsonb,
    'estimatedDurationSec', 60,
    'legalNotice', pg_catalog.jsonb_build_object(
      'schemaVersion', 1, 'documentId', 'screening-notice-test-fixture-v1',
      'kind', 'screening_notice', 'version', 'test-1',
      'effectiveAt', '2026-07-19T00:00:00Z', 'jurisdiction', 'US',
      'productScope', 'us_fitness_wellness_assessment_beta_v1',
      'bodySha256', repeat('c', 64)
    ),
    'clinicalContent', pg_catalog.jsonb_build_object(
      'version', 'clinical-content-test-fixture-v1',
      'inventorySha256', '2265d8cfadd904a9d888617c3876b714dc65e01aec354c2efd84e264d78fe563'
    )
  ),
  60, repeat('3', 64), clock_timestamp() + interval '1 day',
  '52000000-0000-4000-8000-000000000003', repeat('d', 64),
  'screening-notice-test-fixture-v1', 'test-1', repeat('c', 64),
  '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
  'clinical-content-test-fixture-v1',
  '2265d8cfadd904a9d888617c3876b714dc65e01aec354c2efd84e264d78fe563'
) AS value;
SELECT is(
  (SELECT value->>'status' FROM clinical_workout_result),
  'created',
  'workout creation succeeds against the exact active clinical release'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.workout_sessions
    WHERE id = (SELECT (value->>'session_id')::uuid FROM clinical_workout_result)
      AND clinical_content_version = 'clinical-content-test-fixture-v1'
      AND clinical_inventory_sha256 = '2265d8cfadd904a9d888617c3876b714dc65e01aec354c2efd84e264d78fe563'
      AND clinical_review_receipt_sha256 = repeat('f', 64)
      AND program_snapshot->>'version' = '3'
      AND program_snapshot#>>'{clinicalContent,version}' = clinical_content_version
      AND program_snapshot#>>'{clinicalContent,inventorySha256}' = clinical_inventory_sha256
  ),
  'workout snapshot and protected row carry matching release provenance'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.resolve_workout_token(repeat('3', 64)) resolved
    WHERE resolved.clinical_content_version = 'clinical-content-test-fixture-v1'
      AND resolved.clinical_inventory_sha256 = '2265d8cfadd904a9d888617c3876b714dc65e01aec354c2efd84e264d78fe563'
      AND resolved.clinical_review_receipt_sha256 = repeat('f', 64)
  ),
  'token resolver returns only the active versioned workout and its provenance'
);
SELECT is(
  public.rotate_workout_share(
    (SELECT (value->>'session_id')::uuid FROM clinical_workout_result),
    '12000000-0000-4000-8000-000000000001', repeat('4', 64),
    clock_timestamp() + interval '1 day',
    '52000000-0000-4000-8000-000000000004', clock_timestamp()
  )->>'status',
  'rotated',
  'active versioned workout shares can rotate'
);
SELECT lives_ok(
  $$
    UPDATE public.session_runs
    SET status = 'completed', completed_at = clock_timestamp()
    WHERE workout_session_id = (
      SELECT (value->>'session_id')::uuid FROM clinical_workout_result
    )
  $$,
  'active versioned workout runs can finalize'
);

-- Simulate a pre-PR-07 legacy row.  Replication-role bypass is test setup only;
-- all production-facing operations must fail closed except revocation.
SET LOCAL session_replication_role = replica;
INSERT INTO public.workout_sessions (
  id, assessment_id, client_id, practitioner_id, week, capability,
  program_snapshot, session_token_hash, expires_at
) VALUES (
  '42000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  1, 'standard', '{"version":2}'::jsonb, repeat('5', 64),
  clock_timestamp() + interval '1 day'
);
INSERT INTO public.session_runs (
  id, workout_session_id, practitioner_id, status
) VALUES (
  '62000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  'started'
);
SET LOCAL session_replication_role = origin;

SELECT is_empty(
  $$ SELECT * FROM public.resolve_workout_token(repeat('5', 64)) $$,
  'legacy unversioned workout tokens never resolve'
);
SELECT is(
  public.rotate_workout_share(
    '42000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001', repeat('6', 64),
    clock_timestamp() + interval '1 day',
    '52000000-0000-4000-8000-000000000005', clock_timestamp()
  )->>'status',
  'clinical_content_unavailable',
  'legacy unversioned workout shares cannot rotate'
);
SELECT throws_ok(
  $$
    UPDATE public.workout_sessions
    SET session_token_hash = repeat('9', 64),
        expires_at = clock_timestamp() + interval '1 day',
        share_generation = share_generation + 1
    WHERE id = '42000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'workout clinical release is not active',
  'direct legacy share rotation cannot bypass the governed RPC'
);
SELECT throws_ok(
  $$
    UPDATE public.session_runs
    SET status = 'completed', completed_at = clock_timestamp()
    WHERE id = '62000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'workout clinical release is not active',
  'legacy unversioned workout runs cannot finalize'
);
SELECT is(
  public.revoke_workout_share(
    '42000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001', 'practitioner_action',
    '52000000-0000-4000-8000-000000000006', clock_timestamp()
  )->>'status',
  'revoked',
  'legacy unversioned workout shares remain revocable'
);

-- Deactivating the release blocks every positive clinical operation but leaves
-- monotonic revocation and assessment-only output available.
DELETE FROM private.clinical_content_activation WHERE singleton = true;

SELECT is_empty(
  $$ SELECT * FROM public.resolve_workout_token(repeat('4', 64)) $$,
  'a formerly valid workout stops resolving when its release is inactive'
);
SELECT is(
  public.rotate_workout_share(
    (SELECT (value->>'session_id')::uuid FROM clinical_workout_result),
    '12000000-0000-4000-8000-000000000001', repeat('7', 64),
    clock_timestamp() + interval '1 day',
    '52000000-0000-4000-8000-000000000007', clock_timestamp()
  )->>'status',
  'clinical_content_unavailable',
  'inactive-release workout shares cannot rotate'
);
SELECT throws_ok(
  $$
    UPDATE public.session_runs
    SET revision = revision + 1
    WHERE workout_session_id = (
      SELECT (value->>'session_id')::uuid FROM clinical_workout_result
    )
  $$,
  '55000',
  'workout clinical release is not active',
  'inactive-release workout runs cannot update or finalize'
);
SELECT is(
  public.revoke_workout_share(
    (SELECT (value->>'session_id')::uuid FROM clinical_workout_result),
    '12000000-0000-4000-8000-000000000001', 'practitioner_action',
    '52000000-0000-4000-8000-000000000008', clock_timestamp()
  )->>'status',
  'revoked',
  'inactive-release workout shares remain revocable'
);

INSERT INTO public.privacy_storage_deletion_outbox (
  deletion_receipt_id, source_code, bucket, object_path, next_attempt_at
) VALUES (
  NULL, 'report_insert_compensation', 'posture-reports',
  '12000000-0000-4000-8000-000000000001/32000000-0000-4000-8000-000000000001/practitioner/inactive-clinical.pdf',
  clock_timestamp() + interval '15 minutes'
);
SELECT ok(
  public.finalize_report_upload_v2(
    '32000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001/32000000-0000-4000-8000-000000000001/practitioner/inactive-clinical.pdf',
    NULL, 'screening-notice-test-fixture-v1', 'test-1', repeat('c', 64),
    '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
    'clinical_client', 'clinical-content-test-fixture-v1',
    '2265d8cfadd904a9d888617c3876b714dc65e01aec354c2efd84e264d78fe563'
  )->>'status' = 'clinical_content_unavailable'
  AND EXISTS (
    SELECT 1 FROM public.privacy_storage_deletion_outbox
    WHERE object_path LIKE '%/inactive-clinical.pdf'
  ),
  'inactive clinical release blocks report finalization and preserves cleanup intent'
);

INSERT INTO public.privacy_storage_deletion_outbox (
  deletion_receipt_id, source_code, bucket, object_path, next_attempt_at
) VALUES (
  NULL, 'report_insert_compensation', 'posture-reports',
  '12000000-0000-4000-8000-000000000001/32000000-0000-4000-8000-000000000001/practitioner/inactive-assessment-only.pdf',
  clock_timestamp() + interval '15 minutes'
);
SELECT is(
  public.finalize_report_upload_v2(
    '32000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001',
    '12000000-0000-4000-8000-000000000001/32000000-0000-4000-8000-000000000001/practitioner/inactive-assessment-only.pdf',
    NULL, 'screening-notice-test-fixture-v1', 'test-1', repeat('c', 64),
    '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
    'assessment_only', NULL, NULL
  )->>'status',
  'created',
  'assessment-only report remains available when no clinical release is active'
);

SELECT throws_ok(
  $$
    UPDATE public.reports
    SET clinical_inventory_sha256 = repeat('0', 64)
    WHERE id = (SELECT (value->>'report_id')::uuid FROM clinical_report_result)
  $$,
  '55000',
  'report clinical provenance is immutable',
  'stored report clinical provenance cannot change'
);
SELECT throws_ok(
  $$
    UPDATE public.workout_sessions
    SET clinical_inventory_sha256 = repeat('0', 64)
    WHERE id = (SELECT (value->>'session_id')::uuid FROM clinical_workout_result)
  $$,
  '55000',
  'workout clinical provenance is immutable',
  'stored workout clinical provenance cannot change'
);
SELECT throws_ok(
  $$
    INSERT INTO public.workout_ratings (
      session_run_id, workout_session_id, client_id, practitioner_id, clarity
    ) SELECT run.id, session.id, session.client_id, session.practitioner_id, 5
      FROM public.workout_sessions session
      JOIN public.session_runs run ON run.workout_session_id = session.id
      WHERE session.id = (SELECT (value->>'session_id')::uuid FROM clinical_workout_result)
  $$,
  '55000',
  'workout clinical release is not active',
  'inactive-release workout cannot accept new derived clinical feedback'
);

SELECT * FROM finish();
ROLLBACK;

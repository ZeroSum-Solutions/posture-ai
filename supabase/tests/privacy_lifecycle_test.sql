BEGIN;

SELECT plan(55);

SELECT has_table('public', 'privacy_storage_deletion_outbox', 'external deletion outbox exists');
SELECT has_table('public', 'privacy_retention_policies', 'approval-gated retention policy table exists');

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'withdraw_client_consent', 'finalize_report_upload', 'create_workout_session_governed',
        'rotate_workout_share', 'revoke_workout_share',
        'erase_client_transactional', 'reconcile_legacy_client_erasures',
        'claim_privacy_storage_deletions',
        'complete_privacy_storage_deletion', 'run_approved_privacy_retention'
      )
  ),
  10::bigint,
  'all governed privacy lifecycle functions exist'
);

SELECT ok(
  NOT pg_catalog.has_function_privilege('authenticated', 'public.withdraw_client_consent(uuid,uuid,text,text,text,text,timestamp with time zone)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('authenticated', 'public.erase_client_transactional(uuid,uuid,text,timestamp with time zone)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('authenticated', 'public.create_workout_session_governed(uuid,uuid,uuid,integer,text,jsonb,integer,text,timestamp with time zone,uuid,text,text,text,text,timestamp with time zone,text,text)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon', 'public.rotate_workout_share(uuid,uuid,text,timestamp with time zone,uuid,timestamp with time zone)', 'EXECUTE'),
  'browser roles cannot execute privacy mutations'
);

SELECT ok(
  pg_catalog.has_function_privilege('service_role', 'public.withdraw_client_consent(uuid,uuid,text,text,text,text,timestamp with time zone)', 'EXECUTE')
  AND pg_catalog.has_function_privilege('service_role', 'public.erase_client_transactional(uuid,uuid,text,timestamp with time zone)', 'EXECUTE')
  AND pg_catalog.has_function_privilege('service_role', 'public.run_approved_privacy_retention(timestamp with time zone)', 'EXECUTE'),
  'service role can execute governed privacy lifecycle functions'
);

SELECT ok(
  NOT pg_catalog.has_table_privilege('authenticated', 'public.privacy_storage_deletion_outbox', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('anon', 'public.privacy_retention_policies', 'SELECT')
  AND NOT pg_catalog.has_table_privilege('service_role', 'public.privacy_retention_policies', 'INSERT'),
  'outbox is private and retention activation requires a migration'
);

SELECT is(
  (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_constraint constraint_row
    JOIN pg_catalog.pg_class relation ON relation.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND constraint_row.conname IN (
        'clients_deletion_reason_code_shape',
        'client_deletion_log_privacy_shape',
        'consent_records_reason_code_shape',
        'workout_share_events_privacy_shape'
      )
      AND constraint_row.convalidated
  ),
  4::bigint,
  'privacy-shape constraints are validated across upgraded history'
);

-- Fixture practitioners. Bypass only the auth.users fixture foreign key.
SET LOCAL session_replication_role = replica;
INSERT INTO public.practitioners (id, display_name, access_status, role)
VALUES
  ('11000000-0000-4000-8000-000000000001', 'Privacy practitioner A', 'active', 'practitioner'),
  ('11000000-0000-4000-8000-000000000002', 'Privacy practitioner B', 'active', 'practitioner');
SET LOCAL session_replication_role = origin;

INSERT INTO public.clients (id, practitioner_id, first_name, last_name)
VALUES
  ('21000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'Consent', 'Fixture'),
  ('21000000-0000-4000-8000-000000000002', '11000000-0000-4000-8000-000000000001', 'Share', 'Fixture'),
  ('21000000-0000-4000-8000-000000000003', '11000000-0000-4000-8000-000000000001', 'Erase', 'Fixture'),
  ('21000000-0000-4000-8000-000000000004', '11000000-0000-4000-8000-000000000001', 'Atomic', 'Fixture'),
  ('21000000-0000-4000-8000-000000000005', '11000000-0000-4000-8000-000000000001', 'Legacy', 'Partial');

SELECT throws_ok(
  $$
    UPDATE public.clients
    SET deleted_at = clock_timestamp(), deletion_reason = 'free text with possible PII'
    WHERE id = '21000000-0000-4000-8000-000000000003'
  $$,
  '23514',
  NULL,
  'client tombstones reject free-text reasons'
);

SELECT is(
  public.record_inperson_consent_governed(
    '21000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    'subject-consent-test-fixture-v1', 'test-1', repeat('a', 64),
    '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
    'Consent Fixture', 'self', repeat('b', 64), '2026-07-20T00:00:00Z'
  ),
  'ok'::text,
  'fixture consent grant succeeds'
);

-- Independent clients used below need their own active governed consent. Keep
-- setup out of the test count; the asserted creation/rotation behavior is the
-- lifecycle evidence.
DO $$
BEGIN
  PERFORM public.record_inperson_consent_governed(
    fixture.client_id, '11000000-0000-4000-8000-000000000001',
    'subject-consent-test-fixture-v1', 'test-1', repeat('a', 64),
    '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
    fixture.signer_name, 'self', repeat('b', 64), '2026-07-20T00:00:00Z'
  )
  FROM (VALUES
    ('21000000-0000-4000-8000-000000000002'::uuid, 'Share Fixture'::text),
    ('21000000-0000-4000-8000-000000000004'::uuid, 'Atomic Fixture'::text)
  ) AS fixture(client_id, signer_name);
END;
$$;

INSERT INTO public.assessments (
  id, client_id, practitioner_id, status, practitioner_approved
) VALUES (
  '31000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  'complete', true
);

INSERT INTO public.workout_sessions (
  id, assessment_id, client_id, practitioner_id, week, capability,
  program_snapshot, session_token_hash, expires_at,
  legal_document_id, legal_document_version, legal_document_body_sha256,
  legal_document_effective_at, legal_jurisdiction, legal_product_scope,
  legal_provenance_state, clinical_content_version,
  clinical_inventory_sha256, clinical_review_receipt_sha256
) VALUES (
  '41000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001',
  1, 'standard',
  '{"version":3,"week":1,"capability":"standard","priorities":[],"items":[],"estimatedDurationSec":60,"legalNotice":{"schemaVersion":1,"documentId":"screening-notice-test-fixture-v1","kind":"screening_notice","version":"test-1","effectiveAt":"2026-07-19T00:00:00Z","jurisdiction":"US","productScope":"us_fitness_wellness_assessment_beta_v1","bodySha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},"clinicalContent":{"version":"clinical-content-test-fixture-v1","inventorySha256":"74b1bd594fb5162a7e0a36ef9b04dd63e19ec3838d3b53baa98da527568329f4"}}'::jsonb,
  repeat('d', 64), '2026-07-27T00:00:00Z',
  'screening-notice-test-fixture-v1', 'test-1', repeat('c', 64),
  '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1', 'governed',
  'clinical-content-test-fixture-v1',
  '74b1bd594fb5162a7e0a36ef9b04dd63e19ec3838d3b53baa98da527568329f4',
  repeat('f', 64)
);

SELECT is(
  public.withdraw_client_consent(
    '21000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    'Consent Fixture', 'self', 'subject_request', repeat('e', 64),
    clock_timestamp()
  )->>'status',
  'withdrawn',
  'consent withdrawal commits'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.consent_records
    WHERE client_id = '21000000-0000-4000-8000-000000000001'
      AND kind = 'revocation'
      AND reason_code = 'subject_request'
      AND revoked_at IS NOT NULL
  ),
  'withdrawal appends a controlled revocation event'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.consent_tokens
    WHERE client_id = '21000000-0000-4000-8000-000000000001'
  ),
  'withdrawal invalidates outstanding consent links'
);

SELECT is_empty(
  $$ SELECT * FROM public.resolve_workout_token(repeat('d', 64)) $$,
  'withdrawal immediately invalidates active workout shares'
);

SELECT is(
  public.rotate_workout_share(
    '41000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001', repeat('4', 64),
    clock_timestamp() + interval '7 days',
    '51000000-0000-4000-8000-000000000005', clock_timestamp()
  )->>'status',
  'consent_unavailable',
  'a withdrawn-consent share cannot be resurrected by rotation'
);

SELECT is(
  public.create_workout_session_clinical_governed(
    '31000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    1, 'standard',
    '{"version":3,"week":1,"capability":"standard","priorities":[],"items":[],"estimatedDurationSec":60,"legalNotice":{"schemaVersion":1,"documentId":"screening-notice-test-fixture-v1","kind":"screening_notice","version":"test-1","effectiveAt":"2026-07-19T00:00:00Z","jurisdiction":"US","productScope":"us_fitness_wellness_assessment_beta_v1","bodySha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},"clinicalContent":{"version":"clinical-content-test-fixture-v1","inventorySha256":"74b1bd594fb5162a7e0a36ef9b04dd63e19ec3838d3b53baa98da527568329f4"}}'::jsonb,
    60, repeat('5', 64), clock_timestamp() + interval '7 days',
    '51000000-0000-4000-8000-000000000006', NULL,
    'screening-notice-test-fixture-v1', 'test-1', repeat('c', 64),
    '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
    'clinical-content-test-fixture-v1',
    '74b1bd594fb5162a7e0a36ef9b04dd63e19ec3838d3b53baa98da527568329f4'
  )->>'status',
  'consent_unavailable',
  'an approved historical assessment cannot mint a new share after withdrawal'
);

SELECT throws_ok(
  $$
    INSERT INTO public.workout_sessions (
      assessment_id, client_id, practitioner_id, week, capability,
      program_snapshot, session_token_hash, expires_at
    ) VALUES (
      '31000000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000001',
      '11000000-0000-4000-8000-000000000001', 1, 'standard',
      '{"version":1,"week":1,"capability":"standard","priorities":[],"items":[],"estimatedDurationSec":60,"disclaimer":"fixture"}'::jsonb,
      repeat('6', 64), clock_timestamp() + interval '7 days'
    )
  $$,
  '23514',
  NULL,
  'a rollback-era direct insert cannot mint a share after withdrawal'
);

SELECT is(
  public.withdraw_client_consent(
    '21000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001',
    'Consent Fixture', 'self', 'subject_request', repeat('e', 64),
    clock_timestamp()
  )->>'status',
  'already_withdrawn',
  'replayed withdrawal is idempotent'
);

SELECT is(
  (SELECT count(*) FROM public.consent_records
   WHERE client_id = '21000000-0000-4000-8000-000000000001' AND kind = 'revocation'),
  1::bigint,
  'replayed withdrawal does not duplicate the revocation event'
);

SELECT is(
  public.withdraw_client_consent(
    '21000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000002',
    'Other Practitioner', 'self', 'subject_request', repeat('f', 64),
    clock_timestamp()
  )->>'status',
  'not_found',
  'cross-practitioner withdrawal is denied without disclosure'
);

-- Session, run, and initial share audit must share one database transaction.
INSERT INTO public.assessments (id, client_id, practitioner_id, status, practitioner_approved)
VALUES (
  '31000000-0000-4000-8000-000000000004',
  '21000000-0000-4000-8000-000000000004',
  '11000000-0000-4000-8000-000000000001', 'complete', true
);
CREATE TEMP TABLE workout_create_result AS
SELECT public.create_workout_session_clinical_governed(
  '31000000-0000-4000-8000-000000000004',
  '21000000-0000-4000-8000-000000000004',
  '11000000-0000-4000-8000-000000000001',
  1, 'standard',
  '{"version":3,"week":1,"capability":"standard","priorities":[],"items":[],"estimatedDurationSec":60,"legalNotice":{"schemaVersion":1,"documentId":"screening-notice-test-fixture-v1","kind":"screening_notice","version":"test-1","effectiveAt":"2026-07-19T00:00:00Z","jurisdiction":"US","productScope":"us_fitness_wellness_assessment_beta_v1","bodySha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},"clinicalContent":{"version":"clinical-content-test-fixture-v1","inventorySha256":"74b1bd594fb5162a7e0a36ef9b04dd63e19ec3838d3b53baa98da527568329f4"}}'::jsonb,
  60, repeat('9', 64), clock_timestamp() + interval '7 days',
  '51000000-0000-4000-8000-000000000004', repeat('a', 64),
  'screening-notice-test-fixture-v1', 'test-1', repeat('c', 64),
  '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
  'clinical-content-test-fixture-v1',
  '74b1bd594fb5162a7e0a36ef9b04dd63e19ec3838d3b53baa98da527568329f4'
) AS value;

SELECT is(
  (SELECT value->>'status' FROM workout_create_result),
  'created',
  'governed workout creation commits'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.workout_sessions ws
    JOIN public.session_runs run ON run.workout_session_id = ws.id
    JOIN public.workout_share_events event ON event.workout_session_id = ws.id
    WHERE ws.id = (SELECT (value->>'session_id')::uuid FROM workout_create_result)
      AND run.status = 'started'
      AND event.event = 'minted'
      AND event.operation_id = '51000000-0000-4000-8000-000000000004'
      AND event.actor IS NULL
      AND event.reason_code = 'practitioner_action'
  ),
  'session, run, and privacy-safe mint audit are created together'
);
SELECT isnt_empty(
  $$ SELECT * FROM public.resolve_workout_token(repeat('9', 64)) $$,
  'the atomically minted token resolves immediately'
);

-- Share rotation/revocation fixture.
INSERT INTO public.assessments (id, client_id, practitioner_id, status, practitioner_approved)
VALUES (
  '31000000-0000-4000-8000-000000000002',
  '21000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000001', 'complete', true
);
INSERT INTO public.workout_sessions (
  id, assessment_id, client_id, practitioner_id, week, capability,
  program_snapshot, session_token_hash, expires_at,
  legal_document_id, legal_document_version, legal_document_body_sha256,
  legal_document_effective_at, legal_jurisdiction, legal_product_scope,
  legal_provenance_state, clinical_content_version,
  clinical_inventory_sha256, clinical_review_receipt_sha256
) VALUES (
  '41000000-0000-4000-8000-000000000002',
  '31000000-0000-4000-8000-000000000002',
  '21000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000001', 1, 'standard',
  '{"version":3,"week":1,"capability":"standard","priorities":[],"items":[],"estimatedDurationSec":60,"legalNotice":{"schemaVersion":1,"documentId":"screening-notice-test-fixture-v1","kind":"screening_notice","version":"test-1","effectiveAt":"2026-07-19T00:00:00Z","jurisdiction":"US","productScope":"us_fitness_wellness_assessment_beta_v1","bodySha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},"clinicalContent":{"version":"clinical-content-test-fixture-v1","inventorySha256":"74b1bd594fb5162a7e0a36ef9b04dd63e19ec3838d3b53baa98da527568329f4"}}'::jsonb,
  repeat('1', 64), clock_timestamp() + interval '7 days',
  'screening-notice-test-fixture-v1', 'test-1', repeat('c', 64),
  '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1', 'governed',
  'clinical-content-test-fixture-v1',
  '74b1bd594fb5162a7e0a36ef9b04dd63e19ec3838d3b53baa98da527568329f4',
  repeat('f', 64)
);

INSERT INTO public.privacy_storage_deletion_outbox (
  deletion_receipt_id, source_code, bucket, object_path, next_attempt_at
) VALUES (
  NULL, 'report_insert_compensation', 'posture-reports',
  '11000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000002/practitioner/fixture.pdf',
  clock_timestamp() + interval '15 minutes'
);
CREATE TEMP TABLE report_finalize_result AS
SELECT public.finalize_report_upload_v2(
  '31000000-0000-4000-8000-000000000002',
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000002/practitioner/fixture.pdf',
  NULL, 'screening-notice-test-fixture-v1', 'test-1', repeat('c', 64),
  '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
  'assessment_only', NULL, NULL
) AS value;
SELECT ok(
  (SELECT value->>'status' FROM report_finalize_result) = 'created'
  AND EXISTS (
    SELECT 1 FROM public.reports
    WHERE storage_path LIKE '%/practitioner/fixture.pdf'
      AND legal_provenance_state = 'governed'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.privacy_storage_deletion_outbox
    WHERE object_path LIKE '%/practitioner/fixture.pdf'
  ),
  'report finalization atomically persists provenance and cancels its cleanup intent'
);
SELECT is(
  public.finalize_report_upload_v2(
    '31000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000001',
    '11000000-0000-4000-8000-000000000001/31000000-0000-4000-8000-000000000002/practitioner/missing.pdf',
    NULL, 'screening-notice-test-fixture-v1', 'test-1', repeat('c', 64),
    '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
    'assessment_only', NULL, NULL
  )->>'status',
  'intent_missing',
  'report finalization refuses an upload that lacks a pre-side-effect cleanup intent'
);

SELECT is(
  public.rotate_workout_share(
    '41000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000001', repeat('2', 64),
    clock_timestamp() + interval '7 days', '51000000-0000-4000-8000-000000000001',
    clock_timestamp()
  )->>'status',
  'rotated',
  'share rotation commits atomically'
);
SELECT is_empty(
  $$ SELECT * FROM public.resolve_workout_token(repeat('1', 64)) $$,
  'rotation invalidates the old share token immediately'
);
SELECT isnt_empty(
  $$ SELECT * FROM public.resolve_workout_token(repeat('2', 64)) $$,
  'rotation activates the new share token'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.workout_share_events
    WHERE workout_session_id = '41000000-0000-4000-8000-000000000002'
      AND event = 'rotated' AND actor IS NULL AND actor_code = 'practitioner'
      AND reason_code = 'practitioner_action' AND share_generation = 2
  ),
  'rotation writes a controlled privacy-safe audit event'
);
SELECT is(
  public.revoke_workout_share(
    '41000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000001', 'practitioner_action',
    '51000000-0000-4000-8000-000000000002', clock_timestamp()
  )->>'status',
  'revoked',
  'share revocation commits atomically'
);
SELECT is_empty(
  $$ SELECT * FROM public.resolve_workout_token(repeat('2', 64)) $$,
  'revocation invalidates the current token immediately'
);
SELECT is(
  public.revoke_workout_share(
    '41000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000001', 'practitioner_action',
    '51000000-0000-4000-8000-000000000003', clock_timestamp()
  )->>'status',
  'already_revoked',
  'replayed revocation is safe and idempotent'
);
SELECT throws_ok(
  $$
    UPDATE public.workout_sessions
    SET session_token_hash = repeat('7', 64),
        expires_at = clock_timestamp() + interval '7 days',
        revoked_at = NULL,
        share_generation = share_generation + 1
    WHERE id = '41000000-0000-4000-8000-000000000002'
  $$,
  '23514',
  NULL,
  'a terminally revoked share cannot be restored by a direct table update'
);
SELECT is(
  public.rotate_workout_share(
    '41000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000002', repeat('6', 64),
    clock_timestamp() + interval '7 days',
    '51000000-0000-4000-8000-000000000007', clock_timestamp()
  )->>'status',
  'not_found',
  'cross-practitioner rotation is denied without disclosure'
);
SELECT is(
  public.revoke_workout_share(
    '41000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000002', 'practitioner_action',
    '51000000-0000-4000-8000-000000000008', clock_timestamp()
  )->>'status',
  'not_found',
  'cross-practitioner revocation is denied without disclosure'
);
SELECT is(
  public.erase_client_transactional(
    '21000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000002',
    'subject_request', clock_timestamp()
  )->>'status',
  'not_found',
  'cross-practitioner erasure is denied without disclosure'
);

-- Transactional erasure and external object retry fixture.
INSERT INTO public.assessments (id, client_id, practitioner_id, status)
VALUES (
  '31000000-0000-4000-8000-000000000003',
  '21000000-0000-4000-8000-000000000003',
  '11000000-0000-4000-8000-000000000001', 'complete'
);
INSERT INTO public.captures (assessment_id, practitioner_id, view, storage_path)
VALUES (
  '31000000-0000-4000-8000-000000000003',
  '11000000-0000-4000-8000-000000000001', 'front', NULL
);
INSERT INTO public.reports (assessment_id, practitioner_id, storage_path, report_scope)
VALUES (
  '31000000-0000-4000-8000-000000000003',
  '11000000-0000-4000-8000-000000000001', 'reports/privacy-fixture.pdf', 'assessment_only'
);

CREATE TEMP TABLE erasure_result AS
SELECT public.erase_client_transactional(
  '21000000-0000-4000-8000-000000000003',
  '11000000-0000-4000-8000-000000000001',
  'subject_request', clock_timestamp()
) AS value;

SELECT is((SELECT value->>'status' FROM erasure_result), 'database_erased', 'database erasure commits as one operation');
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.clients
    WHERE id = '21000000-0000-4000-8000-000000000003'
      AND first_name = 'REDACTED' AND last_name = 'REDACTED'
      AND notes IS NULL AND deletion_reason IS NULL
      AND deletion_reason_code = 'subject_request' AND deleted_at IS NOT NULL
  ),
  'erasure leaves only a controlled minimized client tombstone'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.assessments WHERE client_id = '21000000-0000-4000-8000-000000000003')
  AND NOT EXISTS (
    SELECT 1 FROM public.reports WHERE assessment_id = '31000000-0000-4000-8000-000000000003'
  ),
  'erasure removes database children transactionally'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.client_deletion_log receipt
    JOIN public.privacy_storage_deletion_outbox job ON job.deletion_receipt_id = receipt.id
    WHERE receipt.original_client_id = '21000000-0000-4000-8000-000000000003'
      AND receipt.reason IS NULL AND receipt.reason_code = 'subject_request'
      AND receipt.external_deletion_status = 'pending'
      AND job.status = 'pending' AND job.object_path = 'reports/privacy-fixture.pdf'
  ),
  'erasure durably enqueues external objects before database rows disappear'
);
SELECT ok(
  (
    SELECT public.erase_client_transactional(
      '21000000-0000-4000-8000-000000000003',
      '11000000-0000-4000-8000-000000000001',
      'subject_request', clock_timestamp()
    )->>'receipt_id'
  ) = (SELECT value->>'receipt_id' FROM erasure_result)
  AND (
    SELECT count(*) FROM public.client_deletion_log
    WHERE original_client_id = '21000000-0000-4000-8000-000000000003'
  ) = 1,
  'replayed erasure returns the stable receipt without duplicating work'
);
SELECT is(
  (SELECT count(*) FROM public.claim_privacy_storage_deletions(10, (SELECT (value->>'receipt_id')::uuid FROM erasure_result))),
  1::bigint,
  'worker atomically claims the pending external deletion'
);
SELECT public.complete_privacy_storage_deletion(
  (SELECT id FROM public.privacy_storage_deletion_outbox WHERE object_path = 'reports/privacy-fixture.pdf'),
  false, 'storage_delete_failed'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.privacy_storage_deletion_outbox
    WHERE object_path = 'reports/privacy-fixture.pdf'
      AND status = 'retry' AND last_error_code = 'storage_delete_failed'
  ),
  'provider failure records a controlled retry state'
);
UPDATE public.privacy_storage_deletion_outbox
SET next_attempt_at = clock_timestamp() - interval '1 second'
WHERE object_path = 'reports/privacy-fixture.pdf';
SELECT is(
  (SELECT count(*) FROM public.claim_privacy_storage_deletions(10, NULL)),
  1::bigint,
  'a due failed external deletion can be reclaimed'
);
SELECT ok(
  public.complete_privacy_storage_deletion(
    (SELECT id FROM public.privacy_storage_deletion_outbox WHERE object_path = 'reports/privacy-fixture.pdf'),
    true, NULL
  ),
  'successful retry completes the outbox job'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.client_deletion_log
    WHERE original_client_id = '21000000-0000-4000-8000-000000000003'
      AND external_deletion_status = 'complete'
      AND storage_objects_deleted = storage_objects_enqueued
      AND completed_at IS NOT NULL
  ),
  'receipt visibly reaches complete only after all external jobs complete'
);

-- Reconcile a pre-PR06 partial erasure: the tombstone and old receipt exist,
-- but relational children, consent PII, and a report object remain.
INSERT INTO public.assessments (id, client_id, practitioner_id, status)
VALUES (
  '31000000-0000-4000-8000-000000000005',
  '21000000-0000-4000-8000-000000000005',
  '11000000-0000-4000-8000-000000000001', 'complete'
);
INSERT INTO public.reports (assessment_id, practitioner_id, storage_path, report_scope)
VALUES (
  '31000000-0000-4000-8000-000000000005',
  '11000000-0000-4000-8000-000000000001', 'reports/legacy-partial.pdf', 'assessment_only'
);
INSERT INTO public.consent_records (
  client_id, practitioner_id, kind, consent_version, consent_hash,
  signer_name, signer_relationship, method, signed_at
) VALUES (
  '21000000-0000-4000-8000-000000000005',
  '11000000-0000-4000-8000-000000000001', 'enrollment', 'legacy', repeat('b', 64),
  'Legacy Name', 'self', 'e_signature', '2026-07-01T00:00:00Z'
);
UPDATE public.clients
SET deleted_at = '2026-07-10T00:00:00Z', archived_at = '2026-07-10T00:00:00Z',
    deletion_reason_code = 'legacy_unspecified'
WHERE id = '21000000-0000-4000-8000-000000000005';
INSERT INTO public.client_deletion_log (
  original_client_id, practitioner_id, deleted_at, reason, reason_code,
  assessments_purged, captures_purged, storage_objects_enqueued,
  storage_objects_deleted, external_deletion_status, completed_at
) VALUES (
  '21000000-0000-4000-8000-000000000005',
  '11000000-0000-4000-8000-000000000001', '2026-07-10T00:00:00Z',
  NULL, 'legacy_unspecified', 0, 0, 0, 0, 'complete', '2026-07-10T00:00:00Z'
);

SET LOCAL session_replication_role = replica;
UPDATE public.practitioners SET access_status = 'revoked'
WHERE id = '11000000-0000-4000-8000-000000000001';
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE legacy_erasure_result AS
SELECT public.reconcile_legacy_client_erasures(100) AS value;

SELECT is(
  (SELECT value->>'clients_reconciled' FROM legacy_erasure_result),
  '1',
  'scheduled reconciliation finishes a hidden partial erasure after practitioner deactivation'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.assessments WHERE client_id = '21000000-0000-4000-8000-000000000005')
  AND NOT EXISTS (SELECT 1 FROM public.reports WHERE assessment_id = '31000000-0000-4000-8000-000000000005')
  AND EXISTS (
    SELECT 1 FROM public.consent_records
    WHERE client_id = '21000000-0000-4000-8000-000000000005'
      AND signer_name = 'REDACTED' AND notes IS NULL
  ),
  'partial historical erasure replay removes residual rows and redacts consent PII'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.client_deletion_log receipt
    JOIN public.privacy_storage_deletion_outbox job ON job.deletion_receipt_id = receipt.id
    WHERE receipt.original_client_id = '21000000-0000-4000-8000-000000000005'
      AND receipt.external_deletion_status = 'pending'
      AND receipt.completed_at IS NULL
      AND receipt.assessments_purged = 1
      AND job.object_path = 'reports/legacy-partial.pdf'
      AND job.status = 'pending'
  ),
  'partial historical erasure repairs the receipt and durably queues the residual object'
);

SELECT is(
  public.run_approved_privacy_retention('2026-07-30T00:00:00Z'::timestamptz),
  '{"policies_run": 0, "rows_deleted": 0}'::jsonb,
  'retention safely no-ops while no approved policy exists'
);

INSERT INTO public.privacy_retention_policies (store_key, retention_days)
VALUES
  ('client_records', 1),
  ('consent_history', 1),
  ('workout_history', 1),
  ('workout_share_events', 1),
  ('client_deletion_receipts', 1);
SELECT is(
  (SELECT pg_catalog.count(*) FROM public.privacy_retention_policies
   WHERE store_key IN (
     'client_records', 'consent_history', 'workout_history',
     'workout_share_events', 'client_deletion_receipts'
   )),
  5::bigint,
  'all core regulated database lifecycles have typed but inactive policy paths'
);

CREATE TEMP TABLE retention_clock AS SELECT clock_timestamp() AS now;

-- Boundary fixtures for every inactive core-store branch: one second before
-- the cutoff, exactly at the cutoff, and one second inside the retained window.
SET LOCAL session_replication_role = replica;
INSERT INTO public.clients (id, practitioner_id, first_name, last_name, created_at)
VALUES
  ('21000000-0000-4000-8000-000000000006', '11000000-0000-4000-8000-000000000001', 'Before', 'Retention', (SELECT now - interval '7 days 1 second' FROM retention_clock)),
  ('21000000-0000-4000-8000-000000000007', '11000000-0000-4000-8000-000000000001', 'At', 'Retention', (SELECT now - interval '7 days' FROM retention_clock)),
  ('21000000-0000-4000-8000-000000000008', '11000000-0000-4000-8000-000000000001', 'After', 'Retention', (SELECT now - interval '7 days' + interval '1 second' FROM retention_clock));
INSERT INTO public.consent_records (
  client_id, practitioner_id, kind, consent_version, consent_hash,
  signer_name, signer_relationship, method, signed_at, recorded_at
) VALUES
  ('21000000-0000-4000-8000-000000000006', '11000000-0000-4000-8000-000000000001', 'enrollment', 'legacy', repeat('1', 64), 'Before', 'self', 'e_signature', (SELECT now - interval '7 days 1 second' FROM retention_clock), (SELECT now - interval '7 days 1 second' FROM retention_clock)),
  ('21000000-0000-4000-8000-000000000007', '11000000-0000-4000-8000-000000000001', 'enrollment', 'legacy', repeat('2', 64), 'At', 'self', 'e_signature', (SELECT now - interval '7 days' FROM retention_clock), (SELECT now - interval '7 days' FROM retention_clock)),
  ('21000000-0000-4000-8000-000000000008', '11000000-0000-4000-8000-000000000001', 'enrollment', 'legacy', repeat('3', 64), 'After', 'self', 'e_signature', (SELECT now - interval '7 days' + interval '1 second' FROM retention_clock), (SELECT now - interval '7 days' + interval '1 second' FROM retention_clock));
INSERT INTO public.assessments (id, client_id, practitioner_id, status)
VALUES ('31000000-0000-4000-8000-000000000008', '21000000-0000-4000-8000-000000000008', '11000000-0000-4000-8000-000000000001', 'complete');
INSERT INTO public.workout_sessions (
  id, assessment_id, client_id, practitioner_id, week, capability,
  program_snapshot, created_at
) VALUES
  ('41000000-0000-4000-8000-000000000006', '31000000-0000-4000-8000-000000000008', '21000000-0000-4000-8000-000000000008', '11000000-0000-4000-8000-000000000001', 1, 'standard', '{"version":1}'::jsonb, (SELECT now - interval '7 days 1 second' FROM retention_clock)),
  ('41000000-0000-4000-8000-000000000007', '31000000-0000-4000-8000-000000000008', '21000000-0000-4000-8000-000000000008', '11000000-0000-4000-8000-000000000001', 1, 'standard', '{"version":1}'::jsonb, (SELECT now - interval '7 days' FROM retention_clock)),
  ('41000000-0000-4000-8000-000000000008', '31000000-0000-4000-8000-000000000008', '21000000-0000-4000-8000-000000000008', '11000000-0000-4000-8000-000000000001', 1, 'standard', '{"version":1}'::jsonb, (SELECT now - interval '7 days' + interval '1 second' FROM retention_clock));
INSERT INTO public.workout_share_events (
  workout_session_id, practitioner_id, event, actor, actor_code,
  reason_code, operation_id, share_generation, created_at
) VALUES
  ('41000000-0000-4000-8000-000000000006', '11000000-0000-4000-8000-000000000001', 'accessed', NULL, 'system', NULL, '51000000-0000-4000-8000-000000000006', 1, (SELECT now - interval '7 days 1 second' FROM retention_clock)),
  ('41000000-0000-4000-8000-000000000007', '11000000-0000-4000-8000-000000000001', 'accessed', NULL, 'system', NULL, '51000000-0000-4000-8000-000000000007', 1, (SELECT now - interval '7 days' FROM retention_clock)),
  ('41000000-0000-4000-8000-000000000008', '11000000-0000-4000-8000-000000000001', 'accessed', NULL, 'system', NULL, '51000000-0000-4000-8000-000000000008', 1, (SELECT now - interval '7 days' + interval '1 second' FROM retention_clock));
INSERT INTO public.client_deletion_log (
  original_client_id, practitioner_id, deleted_at, reason, reason_code,
  external_deletion_status, completed_at
) VALUES
  ('91000000-0000-4000-8000-000000000006', '11000000-0000-4000-8000-000000000001', (SELECT now - interval '7 days 1 second' FROM retention_clock), NULL, 'retention_policy', 'complete', (SELECT now - interval '7 days 1 second' FROM retention_clock)),
  ('91000000-0000-4000-8000-000000000007', '11000000-0000-4000-8000-000000000001', (SELECT now - interval '7 days' FROM retention_clock), NULL, 'retention_policy', 'complete', (SELECT now - interval '7 days' FROM retention_clock)),
  ('91000000-0000-4000-8000-000000000008', '11000000-0000-4000-8000-000000000001', (SELECT now - interval '7 days' + interval '1 second' FROM retention_clock), NULL, 'retention_policy', 'complete', (SELECT now - interval '7 days' + interval '1 second' FROM retention_clock));
SET LOCAL session_replication_role = origin;

UPDATE public.privacy_retention_policies
SET retention_days = 7,
    approved_at = (SELECT now - interval '1 day' FROM retention_clock),
    approval_reference = 'fixture-HG-02'
WHERE store_key IN (
  'client_records', 'consent_history', 'workout_history',
  'workout_share_events', 'client_deletion_receipts'
);
UPDATE public.privacy_retention_policies SET legal_hold = true
WHERE store_key = 'workout_share_events';

INSERT INTO public.privacy_retention_policies (
  store_key, retention_days, approved_at, approval_reference
) VALUES (
  'consent_tokens', 7, (SELECT now - interval '1 day' FROM retention_clock), 'fixture-HG-02'
), (
  'api_rate_limits', 1, (SELECT now - interval '1 day' FROM retention_clock), 'fixture-HG-02'
);
UPDATE public.privacy_retention_policies SET legal_hold = true WHERE store_key = 'api_rate_limits';

INSERT INTO public.consent_tokens (
  client_id, practitioner_id, consent_version, expires_at, consumed_at, token_hash
) VALUES
  (
    '21000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000001', 'legacy',
    (SELECT now - interval '8 days' FROM retention_clock),
    (SELECT now - interval '7 days' FROM retention_clock), repeat('7', 64)
  ),
  (
    '21000000-0000-4000-8000-000000000002',
    '11000000-0000-4000-8000-000000000001', 'legacy',
    (SELECT now - interval '8 days' FROM retention_clock),
    (SELECT now - interval '7 days' + interval '1 second' FROM retention_clock), repeat('8', 64)
  );
INSERT INTO public.api_rate_limits (bucket_key, window_start, request_count)
VALUES ('privacy-fixture', (SELECT now - interval '30 days' FROM retention_clock), 1);

SELECT is(
  public.run_approved_privacy_retention((SELECT now FROM retention_clock)),
  '{"policies_run": 5, "rows_deleted": 9}'::jsonb,
  'retention executes only the approved policy that is not on legal hold'
);
SELECT ok(
  (SELECT deleted_at IS NOT NULL FROM public.clients WHERE id = '21000000-0000-4000-8000-000000000006')
  AND (SELECT deleted_at IS NOT NULL FROM public.clients WHERE id = '21000000-0000-4000-8000-000000000007')
  AND (SELECT deleted_at IS NULL FROM public.clients WHERE id = '21000000-0000-4000-8000-000000000008')
  AND NOT EXISTS (SELECT 1 FROM public.consent_records WHERE consent_hash IN (repeat('1', 64), repeat('2', 64)))
  AND EXISTS (SELECT 1 FROM public.consent_records WHERE consent_hash = repeat('3', 64))
  AND NOT EXISTS (SELECT 1 FROM public.workout_sessions WHERE id IN ('41000000-0000-4000-8000-000000000006', '41000000-0000-4000-8000-000000000007'))
  AND EXISTS (SELECT 1 FROM public.workout_sessions WHERE id = '41000000-0000-4000-8000-000000000008')
  AND NOT EXISTS (SELECT 1 FROM public.client_deletion_log WHERE original_client_id IN ('91000000-0000-4000-8000-000000000006', '91000000-0000-4000-8000-000000000007'))
  AND EXISTS (SELECT 1 FROM public.client_deletion_log WHERE original_client_id = '91000000-0000-4000-8000-000000000008')
  AND (SELECT count(*) FROM public.workout_share_events WHERE operation_id IN ('51000000-0000-4000-8000-000000000006', '51000000-0000-4000-8000-000000000007', '51000000-0000-4000-8000-000000000008')) = 3,
  'core retention deletes before/at cutoff, keeps one-second-inside rows, and honors share-event legal hold'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.consent_tokens WHERE token_hash = repeat('7', 64))
  AND EXISTS (SELECT 1 FROM public.consent_tokens WHERE token_hash = repeat('8', 64)),
  'retention deletes at the exact cutoff and retains rows one second inside it'
);
SELECT ok(
  EXISTS (SELECT 1 FROM public.api_rate_limits WHERE bucket_key = 'privacy-fixture'),
  'legal hold prevents cleanup even when a row is beyond the boundary'
);
UPDATE public.privacy_retention_policies SET legal_hold = false
WHERE store_key = 'workout_share_events';
CREATE TEMP TABLE retention_second_run AS
SELECT public.run_approved_privacy_retention((SELECT now FROM retention_clock)) AS value;
SELECT ok(
  (SELECT value FROM retention_second_run)
    = '{"policies_run": 6, "rows_deleted": 2}'::jsonb
  AND NOT EXISTS (
    SELECT 1 FROM public.workout_share_events
    WHERE operation_id IN (
      '51000000-0000-4000-8000-000000000006',
      '51000000-0000-4000-8000-000000000007'
    )
  )
  AND EXISTS (
    SELECT 1 FROM public.workout_share_events
    WHERE operation_id = '51000000-0000-4000-8000-000000000008'
  ),
  'removing legal hold activates share-event cutoff without deleting the inside-boundary row'
);

SELECT * FROM finish();
ROLLBACK;

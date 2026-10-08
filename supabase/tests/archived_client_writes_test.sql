BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(32);

SET LOCAL session_replication_role = replica;
INSERT INTO public.practitioners (id, display_name, access_status, role)
VALUES ('a1000000-0000-4000-8000-000000000001', 'Archive guard fixture', 'active', 'practitioner');
SET LOCAL session_replication_role = origin;
INSERT INTO public.clients (id, practitioner_id, first_name, last_name)
VALUES ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'Shared', 'Fixture');
DO $$ BEGIN PERFORM public.record_inperson_consent_governed(
  'a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001',
  'subject-consent-test-fixture-v1', 'test-1', repeat('a', 64),
  '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
  'Shared Fixture', 'self', repeat('b', 64), clock_timestamp()
); END $$;
INSERT INTO public.assessments (id, client_id, practitioner_id, status, practitioner_approved)
VALUES ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000001', 'complete', true);
INSERT INTO public.captures (id, assessment_id, practitioner_id, view, source)
VALUES ('a4000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001', 'front', 'camera');
SET LOCAL session_replication_role = replica;
INSERT INTO public.workout_sessions (
  id, assessment_id, client_id, practitioner_id, week, capability, program_snapshot,
  session_token_hash, expires_at, clinical_content_version,
  clinical_inventory_sha256, clinical_review_receipt_sha256
)
SELECT 'a5000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000001', 1, 'standard', '{"version":3}'::jsonb,
  repeat('e', 64), clock_timestamp() + interval '1 day',
  release.id, release.inventory_sha256, release.hg03_receipt_sha256
FROM public.clinical_content_releases release
WHERE release.id = 'clinical-content-test-fixture-v1';
INSERT INTO public.workout_sessions (
  id, assessment_id, client_id, practitioner_id, week, capability, program_snapshot,
  session_token_hash, expires_at, clinical_content_version,
  clinical_inventory_sha256, clinical_review_receipt_sha256
)
SELECT 'a5000000-0000-4000-8000-000000000002',
  'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000001', 1, 'standard', '{"version":3}'::jsonb,
  repeat('c', 64), clock_timestamp() + interval '1 day',
  release.id, release.inventory_sha256, release.hg03_receipt_sha256
FROM public.clinical_content_releases release
WHERE release.id = 'clinical-content-test-fixture-v1';
SET LOCAL session_replication_role = origin;

SELECT is((SELECT count(*) FROM public.resolve_workout_token(repeat('e', 64))), 1::bigint,
  'active public token resolves');
SELECT lives_ok($$INSERT INTO public.workout_sessions (
  assessment_id, client_id, practitioner_id, week, capability, program_snapshot,
  session_token_hash, expires_at, clinical_content_version,
  clinical_inventory_sha256, clinical_review_receipt_sha256)
  SELECT 'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000001', 1, 'standard', '{"version":3}'::jsonb,
    repeat('9',64), clock_timestamp() + interval '1 day',
    release.id, release.inventory_sha256, release.hg03_receipt_sha256
  FROM public.clinical_content_releases release
  WHERE release.id = 'clinical-content-test-fixture-v1'$$,
  'active client can mint a workout share');
SELECT is(public.prepare_capture_image_upload(
  'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001', 'front',
  'a1000000-0000-4000-8000-000000000001/a3000000-0000-4000-8000-000000000001/a4000000-0000-4000-8000-000000000001/' || repeat('f',64) || '.jpg', repeat('f',64)
)->>'status', 'ready', 'active image slot prepares');
UPDATE public.clients SET archived_at = clock_timestamp()
WHERE id = 'a2000000-0000-4000-8000-000000000002';

SELECT throws_ok($$INSERT INTO public.assessments (client_id, practitioner_id, status)
  VALUES ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'processing')$$,
  '23514', 'cannot create a record for a deleted or unknown client', 'archive denies capture insert');
SELECT throws_ok($$INSERT INTO public.consent_tokens (client_id, practitioner_id, token_hash, consent_version, expires_at)
  VALUES ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', repeat('f',64), 'fixture', clock_timestamp() + interval '1 day')$$,
  '23514', 'cannot create a record for a deleted or unknown client', 'archive denies consent-link mint');
SELECT throws_ok($$INSERT INTO public.workout_sessions (
  assessment_id, client_id, practitioner_id, week, capability, program_snapshot,
  clinical_content_version, clinical_inventory_sha256, clinical_review_receipt_sha256)
  SELECT 'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000001', 1, 'standard', '{"version":3}'::jsonb,
    release.id, release.inventory_sha256, release.hg03_receipt_sha256
  FROM public.clinical_content_releases release
  WHERE release.id = 'clinical-content-test-fixture-v1'$$,
  '23514', 'cannot create a record for a deleted or unknown client', 'archive denies session insert');
SELECT throws_ok($$INSERT INTO public.workout_sessions (
  assessment_id, client_id, practitioner_id, week, capability, program_snapshot,
  session_token_hash, expires_at, clinical_content_version,
  clinical_inventory_sha256, clinical_review_receipt_sha256)
  SELECT 'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000001', 1, 'standard', '{"version":3}'::jsonb,
    repeat('a',64), clock_timestamp() + interval '1 day',
    release.id, release.inventory_sha256, release.hg03_receipt_sha256
  FROM public.clinical_content_releases release
  WHERE release.id = 'clinical-content-test-fixture-v1'$$,
  '23514', 'cannot share for a deleted, unknown, or mismatched client', 'archive denies direct share mint');
SELECT is((SELECT count(*) FROM public.resolve_workout_token(repeat('e', 64))), 1::bigint,
  'already-issued public link still resolves after archive');
SELECT is(public.resolve_capture_image_slot('a3000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001', 'front')->>'status', 'found',
  'capture history remains readable after archive');
SELECT is(public.prepare_capture_image_upload(
  'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001', 'front',
  'a1000000-0000-4000-8000-000000000001/a3000000-0000-4000-8000-000000000001/a4000000-0000-4000-8000-000000000001/' || repeat('f',64) || '.jpg', repeat('f',64)
)->>'status', 'not_found', 'archive denies image upload slot');
SELECT is(public.finalize_capture_image_upload(
  'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001', 'front',
  'a1000000-0000-4000-8000-000000000001/a3000000-0000-4000-8000-000000000001/a4000000-0000-4000-8000-000000000001/' || repeat('f',64) || '.jpg', repeat('f',64), 100, 10, 10
)->>'status', 'not_found', 'archive denies image finalization');
SELECT throws_ok($$UPDATE public.workout_sessions SET session_token_hash = repeat('d',64),
  share_generation = share_generation + 1 WHERE id = 'a5000000-0000-4000-8000-000000000001'$$,
  '23514', 'cannot share for a deleted, unknown, or mismatched client', 'direct share rotation denied');
SELECT is(public.rotate_workout_share('a5000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001', repeat('d',64), clock_timestamp() + interval '1 day',
  gen_random_uuid(), clock_timestamp())->>'status', 'not_found', 'share RPC rotation denied');
SELECT is(public.finalize_report_upload_prototype('a3000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001/a3000000-0000-4000-8000-000000000001/report.pdf',
  NULL, 'assessment_only', NULL, NULL)->>'status', 'not_found', 'archive denies report finalization');
SELECT throws_ok($$INSERT INTO public.reports (assessment_id, practitioner_id, storage_path)
  VALUES ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'fixture/report.pdf')$$,
  '23514', 'cannot create a report for a deleted or unknown client', 'archive denies direct report insert');
SELECT is((SELECT count(*) FROM public.assessments WHERE client_id = 'a2000000-0000-4000-8000-000000000002'), 1::bigint,
  'rejected capture leaves history intact');
UPDATE public.workout_sessions SET session_token_hash = NULL, expires_at = NULL, revoked_at = clock_timestamp()
WHERE id = 'a5000000-0000-4000-8000-000000000002';
SELECT is((SELECT session_token_hash FROM public.workout_sessions WHERE id = 'a5000000-0000-4000-8000-000000000002'),
  NULL::text, 'archive permits direct session scrub');
SELECT is(public.revoke_workout_share('a5000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001', 'practitioner_action', gen_random_uuid(), clock_timestamp())->>'status',
  'revoked', 'archive permits share revocation');
SELECT is((SELECT session_token_hash FROM public.workout_sessions WHERE id = 'a5000000-0000-4000-8000-000000000001'),
  NULL::text, 'revocation clears token hash');
SELECT is(public.withdraw_client_consent('a2000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000001', 'Shared Fixture', 'self', 'subject_request',
  repeat('c',64), clock_timestamp())->>'status', 'withdrawn', 'archive permits consent withdrawal');
SELECT ok((SELECT count(*) > 0 FROM public.consent_records WHERE client_id = 'a2000000-0000-4000-8000-000000000002'
  AND kind = 'revocation'), 'withdrawal writes revocation record');
INSERT INTO public.clients (id, practitioner_id, first_name, last_name)
VALUES ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'Erase', 'Archived');
INSERT INTO public.assessments (id, client_id, practitioner_id, status)
VALUES ('a3000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000003',
  'a1000000-0000-4000-8000-000000000001', 'processing');
INSERT INTO public.captures (assessment_id, practitioner_id, view, source)
VALUES ('a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'front', 'camera');
UPDATE public.clients SET archived_at = clock_timestamp() WHERE id = 'a2000000-0000-4000-8000-000000000003';
SELECT is(public.erase_client_transactional('a2000000-0000-4000-8000-000000000003',
  'a1000000-0000-4000-8000-000000000001', 'subject_request', clock_timestamp())->>'status',
  'database_erased', 'archived client erasure succeeds');
SELECT ok((SELECT deleted_at IS NOT NULL FROM public.clients WHERE id = 'a2000000-0000-4000-8000-000000000003'),
  'archived erasure sets deleted_at');
SELECT is((SELECT count(*) FROM public.assessments WHERE client_id = 'a2000000-0000-4000-8000-000000000003'),
  0::bigint, 'archived erasure cascades assessment and capture removal');
UPDATE public.clients SET archived_at = NULL WHERE id = 'a2000000-0000-4000-8000-000000000002';
SELECT is((SELECT archived_at FROM public.clients WHERE id = 'a2000000-0000-4000-8000-000000000002'),
  NULL::timestamptz, 'unarchive succeeds');
SELECT lives_ok($$INSERT INTO public.assessments (client_id, practitioner_id, status)
  VALUES ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'processing')$$,
  'unarchived client can capture again');
SELECT is(public.erase_client_transactional('a2000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000001', 'subject_request', clock_timestamp())->>'status',
  'database_erased', 'erasure succeeds after unarchive');
SELECT ok((SELECT deleted_at IS NOT NULL FROM public.clients WHERE id = 'a2000000-0000-4000-8000-000000000002'),
  'erasure sets tombstone');
SELECT ok(pg_get_functiondef('public.reject_report_for_deleted_client()'::regprocedure)
  LIKE '%c.deleted_at IS NULL AND c.archived_at IS NULL%', 'report insert guard excludes archive');
SELECT ok(pg_get_functiondef('private.enforce_workout_share_monotonicity()'::regprocedure)
  LIKE '%c.archived_at IS NULL%', 'direct share guard excludes archive');
SELECT ok(pg_get_functiondef('public.withdraw_client_consent(uuid,uuid,text,text,text,text,timestamptz)'::regprocedure)
  NOT LIKE '%c.archived_at IS NULL%', 'withdrawal keeps original archive semantics');
SELECT ok(pg_get_functiondef('public.resolve_workout_token(text)'::regprocedure)
  NOT LIKE '%archived_at%', 'public resolver keeps original archive semantics');
SELECT * FROM finish();
ROLLBACK;

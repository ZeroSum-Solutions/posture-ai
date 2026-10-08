BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(20);

SET LOCAL session_replication_role = replica;
INSERT INTO public.practitioners (id, display_name, access_status, role)
VALUES ('a1000000-0000-4000-8000-000000000001', 'Archive guard fixture', 'active', 'practitioner');
SET LOCAL session_replication_role = origin;
INSERT INTO public.clients (id, practitioner_id, first_name, last_name, archived_at)
VALUES ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Archived', 'Fixture', clock_timestamp());

SELECT throws_ok(
  $$INSERT INTO public.assessments (client_id, practitioner_id, status)
    VALUES ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'processing')$$,
  '23514', 'cannot create a record for a deleted or unknown client',
  'archived client cannot gain an assessment row'
);
SELECT is((SELECT count(*) FROM public.assessments WHERE client_id = 'a2000000-0000-4000-8000-000000000001'), 0::bigint, 'rejected capture leaves no assessment row');
SELECT throws_ok(
  $$INSERT INTO public.consent_tokens (client_id, practitioner_id, token_hash, consent_version, expires_at)
    VALUES ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', repeat('f', 64), 'fixture', clock_timestamp() + interval '1 day')$$,
  '23514', 'cannot create a record for a deleted or unknown client',
  'archived client cannot gain a consent token row'
);
SELECT is((SELECT count(*) FROM public.consent_tokens WHERE client_id = 'a2000000-0000-4000-8000-000000000001'), 0::bigint, 'rejected consent mint leaves no token row');

-- Seed an already-issued token before archive to exercise the public resolver.
INSERT INTO public.clients (id, practitioner_id, first_name, last_name)
VALUES ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'Shared', 'Fixture');
SELECT public.record_inperson_consent_governed(
  'a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001',
  'subject-consent-test-fixture-v1', 'test-1', repeat('a', 64),
  '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
  'Shared Fixture', 'self', repeat('b', 64), clock_timestamp()
);
INSERT INTO public.assessments (id, client_id, practitioner_id, status, practitioner_approved)
VALUES ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000001', 'complete', true);
SET LOCAL session_replication_role = replica;
INSERT INTO public.workout_sessions (
  assessment_id, client_id, practitioner_id, week, capability, program_snapshot,
  session_token_hash, expires_at, clinical_content_version,
  clinical_inventory_sha256, clinical_review_receipt_sha256
)
SELECT 'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000001', 1, 'standard', '{"version":3}'::jsonb,
  repeat('e', 64), clock_timestamp() + interval '1 day',
  release.id, release.inventory_sha256, release.hg03_receipt_sha256
FROM public.clinical_content_releases release
WHERE release.id = 'clinical-content-test-fixture-v1';
SET LOCAL session_replication_role = origin;
SELECT is((SELECT count(*) FROM public.resolve_workout_token(repeat('e', 64))), 1::bigint, 'existing public token resolves while client is active');
UPDATE public.clients SET archived_at = clock_timestamp()
WHERE id = 'a2000000-0000-4000-8000-000000000002';
SELECT is((SELECT count(*) FROM public.resolve_workout_token(repeat('e', 64))), 0::bigint, 'existing public token stops resolving after archive');
SELECT throws_ok(
  $$UPDATE public.workout_sessions
    SET session_token_hash = repeat('d', 64), share_generation = share_generation + 1
    WHERE client_id = 'a2000000-0000-4000-8000-000000000002'$$,
  '23514', 'cannot share for a deleted, unknown, or mismatched client',
  'direct share rotation cannot mint a new token after archive'
);
SELECT is((SELECT count(*) FROM public.workout_sessions WHERE client_id = 'a2000000-0000-4000-8000-000000000002' AND session_token_hash = repeat('e', 64)), 1::bigint, 'rejected direct rotation retains old hash');

-- Each existing erased-client SQL boundary must also exclude archived clients.
SELECT ok(pg_get_functiondef('public.create_assessment_prototype(uuid,uuid,uuid,text,jsonb,jsonb,numeric,text,text,boolean,boolean,numeric)'::regprocedure) LIKE '%client.deleted_at IS NULL AND client.archived_at IS NULL%', 'prototype capture excludes archived clients');
SELECT ok(pg_get_functiondef('public.create_workout_session_prototype(uuid,uuid,uuid,integer,text,jsonb,integer,uuid,text,jsonb,text,text,text)'::regprocedure) LIKE '%client.deleted_at IS NULL AND client.archived_at IS NULL%', 'prototype session mint excludes archived clients');
SELECT ok(pg_get_functiondef('public.create_workout_session_clinical_governed(uuid,uuid,uuid,integer,text,jsonb,integer,text,timestamp with time zone,uuid,text,text,text,text,timestamp with time zone,text,text,text,text)'::regprocedure) LIKE '%client.deleted_at IS NULL AND client.archived_at IS NULL%', 'governed session mint excludes archived clients');
SELECT ok(pg_get_functiondef('public.rotate_workout_share(uuid,uuid,text,timestamp with time zone,uuid,timestamp with time zone)'::regprocedure) LIKE '%client.deleted_at IS NULL AND client.archived_at IS NULL%', 'share rotation excludes archived clients');
SELECT ok(pg_get_functiondef('public.resolve_workout_token(text)'::regprocedure) LIKE '%client.deleted_at IS NULL AND client.archived_at IS NULL%', 'existing public tokens stop resolving after archive');
SELECT ok(pg_get_functiondef('public.finalize_report_upload_v2(uuid,uuid,text,uuid,text,text,text,timestamp with time zone,text,text,text,text,text)'::regprocedure) LIKE '%c.deleted_at IS NULL AND c.archived_at IS NULL%', 'governed report finalization excludes archived clients');
SELECT ok(pg_get_functiondef('public.finalize_report_upload_prototype(uuid,uuid,text,uuid,text,text,text)'::regprocedure) LIKE '%client.deleted_at IS NULL AND client.archived_at IS NULL%', 'prototype report finalization excludes archived clients');
SELECT ok(pg_get_functiondef('public.reject_insert_for_deleted_client()'::regprocedure) LIKE '%c.deleted_at IS NULL AND c.archived_at IS NULL%', 'assessment, consent-token, and workout insert guard excludes archived clients');
SELECT ok(pg_get_functiondef('public.reject_report_for_deleted_client()'::regprocedure) LIKE '%c.deleted_at IS NULL AND c.archived_at IS NULL%', 'report insert guard excludes archived clients');
SELECT ok(pg_get_functiondef('public.record_remote_consent(text,text,text,text,timestamp with time zone)'::regprocedure) LIKE '%c.deleted_at IS NULL AND c.archived_at IS NULL%', 'remote consent cannot write after archive');
SELECT ok(pg_get_functiondef('public.record_remote_consent_governed(text,text,text,text,text,text,text,timestamp with time zone)'::regprocedure) LIKE '%c.deleted_at IS NULL AND c.archived_at IS NULL%', 'governed remote consent cannot write after archive');
SELECT ok((SELECT count(*) = 2 FROM pg_trigger WHERE tgname IN ('assessments_reject_deleted_client', 'consent_tokens_reject_deleted_client') AND NOT tgisinternal), 'assessment and consent-token insert guards remain installed');

SELECT * FROM finish();
ROLLBACK;

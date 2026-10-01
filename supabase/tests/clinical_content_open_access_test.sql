-- The clinical-content review gate is removed (2026-10-01): open content
-- versions work with no HG-03 activation, and their stored provenance says
-- plainly that no clinical review took place.
BEGIN;
SELECT plan(12);

-- Production has no activation; model that here.
SET LOCAL session_replication_role = replica;
DELETE FROM private.clinical_content_activation;
INSERT INTO public.practitioners (id, display_name, access_status, role)
VALUES ('13000000-0000-4000-8000-000000000001', 'Open content practitioner', 'active', 'practitioner');
SET LOCAL session_replication_role = origin;

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.clinical_content_review_receipts
    WHERE receipt_sha256 = private.open_clinical_receipt()
      AND receipt_kind = 'open_ungated'
      AND attestation = 'no_clinical_review'
      AND reviewer_name IS NULL AND license_identifier IS NULL
  ),
  'the open receipt states that no clinical review took place'
);

SELECT is(
  private.active_clinical_receipt('clinical-content-open-' || left(repeat('e', 64), 12), repeat('e', 64), 'workouts'),
  private.open_clinical_receipt(),
  'an open version is active for workouts without any activation'
);
SELECT is(
  private.active_clinical_receipt('clinical-content-open-' || left(repeat('e', 64), 12), repeat('e', 64), 'clinical_client_report'),
  private.open_clinical_receipt(),
  'an open version is active for client reports without any activation'
);
SELECT is(
  private.active_clinical_receipt('clinical-content-open-' || left(repeat('f', 64), 12), repeat('e', 64), 'workouts'),
  NULL,
  'an open version must name the inventory it carries'
);
SELECT is(
  private.active_clinical_receipt('clinical-content-test-fixture-v1', repeat('e', 64), 'workouts'),
  NULL,
  'non-open releases still need an activation'
);

INSERT INTO public.clients (id, practitioner_id, first_name, last_name)
VALUES ('23000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000001', 'Open', 'Fixture');
SELECT is(
  public.record_inperson_consent_governed(
    '23000000-0000-4000-8000-000000000001',
    '13000000-0000-4000-8000-000000000001',
    'subject-consent-test-fixture-v1', 'test-1', repeat('a', 64),
    '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
    'Open Fixture', 'self', repeat('b', 64), clock_timestamp()
  ),
  'ok'::text,
  'open-content fixture has active governed consent'
);
INSERT INTO public.assessments (id, client_id, practitioner_id, status, practitioner_approved)
VALUES ('33000000-0000-4000-8000-000000000001', '23000000-0000-4000-8000-000000000001',
  '13000000-0000-4000-8000-000000000001', 'complete', true);

INSERT INTO public.privacy_storage_deletion_outbox (
  deletion_receipt_id, source_code, bucket, object_path, next_attempt_at
) VALUES (
  NULL, 'report_insert_compensation', 'posture-reports',
  '13000000-0000-4000-8000-000000000001/33000000-0000-4000-8000-000000000001/practitioner/open.pdf',
  clock_timestamp() + interval '15 minutes'
);
CREATE TEMP TABLE open_report_result AS
SELECT public.finalize_report_upload_v2(
  '33000000-0000-4000-8000-000000000001',
  '13000000-0000-4000-8000-000000000001',
  '13000000-0000-4000-8000-000000000001/33000000-0000-4000-8000-000000000001/practitioner/open.pdf',
  NULL, 'screening-notice-test-fixture-v1', 'test-1', repeat('c', 64),
  '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
  'clinical_practitioner', 'clinical-content-open-' || left(repeat('e', 64), 12), repeat('e', 64)
) AS value;
SELECT is(
  (SELECT value->>'status' FROM open_report_result),
  'created',
  'a clinical report finalizes on open content with no activation'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.reports
    WHERE id = (SELECT (value->>'report_id')::uuid FROM open_report_result)
      AND clinical_content_version = 'clinical-content-open-' || left(repeat('e', 64), 12)
      AND clinical_inventory_sha256 = repeat('e', 64)
      AND clinical_review_receipt_sha256 = private.open_clinical_receipt()
  ),
  'the report records the open version, its inventory and the no-review receipt'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.clinical_content_releases
    WHERE id = 'clinical-content-open-' || left(repeat('e', 64), 12)
      AND release_kind = 'open_ungated'
      AND inventory_sha256 = repeat('e', 64)
  ),
  'the open release row is created on first use'
);

CREATE TEMP TABLE open_workout_result AS
SELECT public.create_workout_session_clinical_governed(
  '33000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  '13000000-0000-4000-8000-000000000001',
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
      'version', 'clinical-content-open-' || left(repeat('e', 64), 12),
      'inventorySha256', repeat('e', 64)
    )
  ),
  60, repeat('4', 64), clock_timestamp() + interval '1 day',
  '53000000-0000-4000-8000-000000000001', repeat('d', 64),
  'screening-notice-test-fixture-v1', 'test-1', repeat('c', 64),
  '2026-07-19T00:00:00Z', 'US', 'us_fitness_wellness_assessment_beta_v1',
  'clinical-content-open-' || left(repeat('e', 64), 12), repeat('e', 64)
) AS value;
SELECT is(
  (SELECT value->>'status' FROM open_workout_result),
  'created',
  'a workout is created on open content with no activation'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.resolve_workout_token(repeat('4', 64)) resolved
    WHERE resolved.clinical_content_version = 'clinical-content-open-' || left(repeat('e', 64), 12)
      AND resolved.clinical_review_receipt_sha256 = private.open_clinical_receipt()
  ),
  'an open-content workout share resolves with its provenance'
);
SELECT is(
  (SELECT count(*) FROM public.clinical_content_releases
   WHERE id = 'clinical-content-open-' || left(repeat('e', 64), 12)),
  1::bigint,
  'repeated use of one open version keeps a single release row'
);

SELECT * FROM finish();
ROLLBACK;

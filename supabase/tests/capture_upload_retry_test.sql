BEGIN;

SELECT plan(13);

SELECT ok(
  pg_catalog.to_regprocedure(
    'public.prepare_capture_image_upload(uuid,uuid,uuid,text,text,text)'
  ) IS NOT NULL,
  'capture upload preparation RPC exists'
);

SELECT ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.prepare_capture_image_upload(uuid,uuid,uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.prepare_capture_image_upload(uuid,uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'only the service persistence boundary can prepare capture uploads'
);

SET LOCAL session_replication_role = replica;
INSERT INTO public.practitioners (id, display_name, access_status, role)
VALUES ('12000000-0000-4000-8000-000000000052', 'Retry practitioner', 'active', 'practitioner');
SET LOCAL session_replication_role = origin;

INSERT INTO public.clients (id, practitioner_id, first_name, last_name)
VALUES (
  '22000000-0000-4000-8000-000000000052',
  '12000000-0000-4000-8000-000000000052',
  'Retry',
  'Fixture'
);
INSERT INTO public.assessments (id, client_id, practitioner_id, status)
VALUES (
  '32000000-0000-4000-8000-000000000052',
  '22000000-0000-4000-8000-000000000052',
  '12000000-0000-4000-8000-000000000052',
  'complete'
);
INSERT INTO public.captures (
  id, assessment_id, practitioner_id, view, profile_side, source, pose_frame
) VALUES
  (
    '42000000-0000-4000-8000-000000000052',
    '32000000-0000-4000-8000-000000000052',
    '12000000-0000-4000-8000-000000000052',
    'front', NULL, 'upload', '{}'::jsonb
  ),
  (
    '42000000-0000-4000-8000-000000000053',
    '32000000-0000-4000-8000-000000000052',
    '12000000-0000-4000-8000-000000000052',
    'back', NULL, 'upload', '{}'::jsonb
  );

CREATE FUNCTION pg_temp.retry_path(p_capture_id uuid, p_hash text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT '12000000-0000-4000-8000-000000000052/'
    || '32000000-0000-4000-8000-000000000052/'
    || p_capture_id::text || '/' || p_hash || '.jpg';
$$;

SELECT is(
  public.prepare_capture_image_upload(
    '32000000-0000-4000-8000-000000000052',
    '42000000-0000-4000-8000-000000000052',
    '12000000-0000-4000-8000-000000000052',
    'front',
    pg_temp.retry_path('42000000-0000-4000-8000-000000000052', repeat('a', 64)),
    repeat('a', 64)
  )->>'status',
  'ready',
  'first preparation creates a compensation lease before upload'
);

UPDATE public.privacy_storage_deletion_outbox
SET status = 'retry', next_attempt_at = pg_catalog.clock_timestamp() - interval '1 minute'
WHERE object_path = pg_temp.retry_path(
  '42000000-0000-4000-8000-000000000052', repeat('a', 64)
);
SELECT is(
  public.prepare_capture_image_upload(
    '32000000-0000-4000-8000-000000000052',
    '42000000-0000-4000-8000-000000000052',
    '12000000-0000-4000-8000-000000000052',
    'front',
    pg_temp.retry_path('42000000-0000-4000-8000-000000000052', repeat('a', 64)),
    repeat('a', 64)
  )->>'status',
  'ready',
  'same-path retry refreshes an unclaimed failed-upload intent'
);
SELECT ok(
  (
    SELECT status = 'pending'
      AND next_attempt_at > pg_catalog.clock_timestamp() + interval '14 minutes'
    FROM public.privacy_storage_deletion_outbox
    WHERE object_path = pg_temp.retry_path(
      '42000000-0000-4000-8000-000000000052', repeat('a', 64)
    )
  ),
  'retry refreshes the compensation lease before storage upload'
);

UPDATE public.privacy_storage_deletion_outbox
SET status = 'processing', locked_at = pg_catalog.clock_timestamp()
WHERE object_path = pg_temp.retry_path(
  '42000000-0000-4000-8000-000000000052', repeat('a', 64)
);
SELECT is(
  public.prepare_capture_image_upload(
    '32000000-0000-4000-8000-000000000052',
    '42000000-0000-4000-8000-000000000052',
    '12000000-0000-4000-8000-000000000052',
    'front',
    pg_temp.retry_path('42000000-0000-4000-8000-000000000052', repeat('a', 64)),
    repeat('a', 64)
  )->>'status',
  'in_progress',
  'upload does not race a compensation intent claimed by the deletion worker'
);

UPDATE public.privacy_storage_deletion_outbox
SET status = 'retry', locked_at = NULL
WHERE object_path = pg_temp.retry_path(
  '42000000-0000-4000-8000-000000000052', repeat('a', 64)
);
SELECT is(
  public.finalize_capture_image_upload(
    '32000000-0000-4000-8000-000000000052',
    '42000000-0000-4000-8000-000000000052',
    '12000000-0000-4000-8000-000000000052',
    'front',
    pg_temp.retry_path('42000000-0000-4000-8000-000000000052', repeat('a', 64)),
    repeat('a', 64), 100, 10, 8
  )->>'status',
  'saved',
  'finalization consumes the refreshed intent and stores the live pointer'
);

INSERT INTO public.privacy_storage_deletion_outbox (
  deletion_receipt_id, source_code, bucket, object_path, next_attempt_at
) VALUES (
  NULL, 'capture_upload_compensation', 'posture-captures',
  pg_temp.retry_path('42000000-0000-4000-8000-000000000052', repeat('a', 64)),
  pg_catalog.clock_timestamp() - interval '1 minute'
);
SELECT is(
  public.finalize_capture_image_upload(
    '32000000-0000-4000-8000-000000000052',
    '42000000-0000-4000-8000-000000000052',
    '12000000-0000-4000-8000-000000000052',
    'front',
    pg_temp.retry_path('42000000-0000-4000-8000-000000000052', repeat('a', 64)),
    repeat('a', 64), 100, 10, 8
  )->>'status',
  'already_saved',
  'concurrent exact finalization remains idempotent'
);
SELECT is_empty(
  $$
    SELECT 1 FROM public.privacy_storage_deletion_outbox
    WHERE object_path = pg_temp.retry_path(
      '42000000-0000-4000-8000-000000000052', repeat('a', 64)
    )
  $$,
  'already-saved finalization cancels a late unclaimed compensation row'
);

INSERT INTO public.privacy_storage_deletion_outbox (
  deletion_receipt_id, source_code, bucket, object_path, next_attempt_at
) VALUES (
  NULL, 'capture_upload_compensation', 'posture-captures',
  pg_temp.retry_path('42000000-0000-4000-8000-000000000052', repeat('a', 64)),
  pg_catalog.clock_timestamp() - interval '1 minute'
);
-- Keep this candidate first even when prior browser fixtures left unrelated jobs.
UPDATE public.privacy_storage_deletion_outbox
SET created_at = '-infinity'::timestamptz
WHERE object_path = pg_temp.retry_path(
  '42000000-0000-4000-8000-000000000052', repeat('a', 64)
);
SELECT is_empty(
  $$
    SELECT id FROM public.claim_privacy_storage_deletions(100, NULL)
    WHERE object_path = pg_temp.retry_path(
      '42000000-0000-4000-8000-000000000052', repeat('a', 64)
    )
  $$,
  'deletion worker cannot claim compensation for a live capture pointer'
);
SELECT is(
  public.prepare_capture_image_upload(
    '32000000-0000-4000-8000-000000000052',
    '42000000-0000-4000-8000-000000000052',
    '12000000-0000-4000-8000-000000000052',
    'front',
    pg_temp.retry_path('42000000-0000-4000-8000-000000000052', repeat('a', 64)),
    repeat('a', 64)
  )->>'status',
  'already_saved',
  'exact retry resolves the saved pointer through the preparation boundary'
);
SELECT is_empty(
  $$
    SELECT 1 FROM public.privacy_storage_deletion_outbox
    WHERE object_path = pg_temp.retry_path(
      '42000000-0000-4000-8000-000000000052', repeat('a', 64)
    )
  $$,
  'saved-pointer preparation removes the unclaimed stale compensation row'
);

INSERT INTO public.privacy_storage_deletion_outbox (
  deletion_receipt_id, source_code, bucket, object_path, status,
  next_attempt_at, completed_at
) VALUES (
  NULL, 'capture_upload_compensation', 'posture-captures',
  pg_temp.retry_path('42000000-0000-4000-8000-000000000053', repeat('b', 64)),
  'complete', pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);
SELECT is(
  public.prepare_capture_image_upload(
    '32000000-0000-4000-8000-000000000052',
    '42000000-0000-4000-8000-000000000053',
    '12000000-0000-4000-8000-000000000052',
    'back',
    pg_temp.retry_path('42000000-0000-4000-8000-000000000053', repeat('b', 64)),
    repeat('b', 64)
  )->>'status',
  'ready',
  'retained complete compensation rows are reset for an exact failed-upload retry'
);

SELECT * FROM finish();
ROLLBACK;

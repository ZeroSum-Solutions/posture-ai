BEGIN;

SELECT plan(16);

SELECT is(
  (SELECT public FROM storage.buckets WHERE id = 'posture-captures'),
  false,
  'capture image bucket is private'
);

SELECT is(
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'posture-captures'),
  4194304::bigint,
  'capture image bucket enforces the server upload ceiling'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'public.captures'::regclass
      AND constraint_row.conname = 'captures_image_storage_shape'
      AND constraint_row.convalidated
  ),
  1::bigint,
  'capture storage path and metadata shape are validated at rest'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN ('resolve_capture_image_slot', 'finalize_capture_image_upload')
  ),
  2::bigint,
  'capture resolution and finalization functions exist'
);

SELECT ok(
  NOT pg_catalog.has_function_privilege(
    'authenticated', 'public.resolve_capture_image_slot(uuid,uuid,text)', 'EXECUTE'
  )
  AND NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.finalize_capture_image_upload(uuid,uuid,uuid,text,text,text,integer,integer,integer)',
    'EXECUTE'
  ),
  'browser roles cannot invoke service persistence functions directly'
);

SELECT ok(
  pg_catalog.has_function_privilege(
    'service_role', 'public.resolve_capture_image_slot(uuid,uuid,text)', 'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'service_role',
    'public.finalize_capture_image_upload(uuid,uuid,uuid,text,text,text,integer,integer,integer)',
    'EXECUTE'
  ),
  'service role can resolve and finalize capture images'
);

SET LOCAL session_replication_role = replica;
INSERT INTO public.practitioners (id, display_name, access_status, role)
VALUES ('10000000-0000-4000-8000-000000000050', 'Capture image practitioner', 'active', 'practitioner');
SET LOCAL session_replication_role = origin;

INSERT INTO public.clients (id, practitioner_id, first_name, last_name)
VALUES (
  '20000000-0000-4000-8000-000000000050',
  '10000000-0000-4000-8000-000000000050',
  'Capture',
  'Fixture'
);

INSERT INTO public.assessments (id, client_id, practitioner_id, status)
VALUES (
  '30000000-0000-4000-8000-000000000050',
  '20000000-0000-4000-8000-000000000050',
  '10000000-0000-4000-8000-000000000050',
  'complete'
);

-- A burst creates several same-slot pose rows. UUID ordering is the frozen
-- deterministic representative until a photo-bearing row exists.
INSERT INTO public.captures (
  id, assessment_id, practitioner_id, view, profile_side, source, pose_frame
) VALUES
  (
    '40000000-0000-4000-8000-000000000050',
    '30000000-0000-4000-8000-000000000050',
    '10000000-0000-4000-8000-000000000050',
    'front', NULL, 'upload', '{}'::jsonb
  ),
  (
    '40000000-0000-4000-8000-000000000051',
    '30000000-0000-4000-8000-000000000050',
    '10000000-0000-4000-8000-000000000050',
    'front', NULL, 'upload', '{}'::jsonb
  );

SELECT is(
  public.resolve_capture_image_slot(
    '30000000-0000-4000-8000-000000000050',
    '10000000-0000-4000-8000-000000000050',
    'front'
  )->>'captureId',
  '40000000-0000-4000-8000-000000000050',
  'same-slot burst resolution is deterministic'
);

INSERT INTO public.privacy_storage_deletion_outbox (
  deletion_receipt_id, source_code, bucket, object_path, next_attempt_at
) VALUES (
  NULL,
  'capture_upload_compensation',
  'posture-captures',
  '10000000-0000-4000-8000-000000000050/30000000-0000-4000-8000-000000000050/40000000-0000-4000-8000-000000000050/' || repeat('a', 64) || '.jpg',
  clock_timestamp() + interval '15 minutes'
);

SELECT is(
  public.finalize_capture_image_upload(
    '30000000-0000-4000-8000-000000000050',
    '40000000-0000-4000-8000-000000000050',
    '10000000-0000-4000-8000-000000000050',
    'front',
    '10000000-0000-4000-8000-000000000050/30000000-0000-4000-8000-000000000050/40000000-0000-4000-8000-000000000050/' || repeat('a', 64) || '.jpg',
    repeat('a', 64), 100, 10, 8
  )->>'status',
  'saved',
  'governed finalization attaches the prepared object'
);

SELECT is(
  (
    SELECT image_sha256 || ':' || image_mime_type || ':' || image_byte_size::text
    FROM public.captures
    WHERE id = '40000000-0000-4000-8000-000000000050'
  ),
  repeat('a', 64) || ':image/jpeg:100',
  'finalization records the exact object evidence'
);

SELECT is_empty(
  $$
    SELECT 1 FROM public.privacy_storage_deletion_outbox
    WHERE bucket = 'posture-captures'
      AND object_path LIKE '%/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'
  $$,
  'finalization atomically cancels upload compensation'
);

SELECT is(
  public.finalize_capture_image_upload(
    '30000000-0000-4000-8000-000000000050',
    '40000000-0000-4000-8000-000000000050',
    '10000000-0000-4000-8000-000000000050',
    'front',
    '10000000-0000-4000-8000-000000000050/30000000-0000-4000-8000-000000000050/40000000-0000-4000-8000-000000000050/' || repeat('a', 64) || '.jpg',
    repeat('a', 64), 100, 10, 8
  )->>'status',
  'already_saved',
  'exact finalization retry is idempotent without a new intent'
);

SELECT is(
  public.finalize_capture_image_upload(
    '30000000-0000-4000-8000-000000000050',
    '40000000-0000-4000-8000-000000000050',
    '10000000-0000-4000-8000-000000000050',
    'front',
    '10000000-0000-4000-8000-000000000050/30000000-0000-4000-8000-000000000050/40000000-0000-4000-8000-000000000050/' || repeat('b', 64) || '.jpg',
    repeat('b', 64), 100, 10, 8
  )->>'status',
  'conflict',
  'a different image cannot replace the saved slot'
);

SELECT throws_ok(
  $$
    UPDATE public.captures
    SET image_sha256 = repeat('b', 64),
        storage_path = '10000000-0000-4000-8000-000000000050/30000000-0000-4000-8000-000000000050/40000000-0000-4000-8000-000000000050/' || repeat('b', 64) || '.jpg'
    WHERE id = '40000000-0000-4000-8000-000000000050'
  $$,
  'PT409',
  'capture_image_immutable',
  'a direct database write cannot overwrite a saved image'
);

SELECT throws_ok(
  $$
    UPDATE public.captures
    SET storage_path = '/unowned/path.jpg'
    WHERE id = '40000000-0000-4000-8000-000000000051'
  $$,
  '23514',
  NULL,
  'at-rest shape rejects an ungoverned storage pointer'
);

SELECT throws_ok(
  $$
    UPDATE public.captures
    SET storage_path = '10000000-0000-4000-8000-000000000050/30000000-0000-4000-8000-000000000050/40000000-0000-4000-8000-000000000051/' || repeat('c', 64) || '.jpg',
        image_sha256 = repeat('c', 64),
        image_byte_size = 100,
        image_mime_type = 'image/jpeg',
        image_width_px = 10,
        image_height_px = NULL
    WHERE id = '40000000-0000-4000-8000-000000000051'
  $$,
  '23514',
  NULL,
  'partially-null image metadata cannot bypass the at-rest shape check'
);

DELETE FROM public.captures
WHERE id = '40000000-0000-4000-8000-000000000050';

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.privacy_storage_deletion_outbox
    WHERE source_code = 'capture_delete'
      AND deletion_receipt_id IS NULL
      AND bucket = 'posture-captures'
      AND object_path LIKE '%/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg'
      AND status = 'pending'
  ),
  'deleting a capture durably enqueues its private object'
);

SELECT * FROM finish();
ROLLBACK;

-- Make deterministic capture-image retries reusable without allowing the
-- compensation deletion worker to race a live capture pointer.

CREATE OR REPLACE FUNCTION public.prepare_capture_image_upload(
  p_assessment_id uuid,
  p_capture_id uuid,
  p_practitioner_id uuid,
  p_slot text,
  p_storage_path text,
  p_image_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_capture public.captures%ROWTYPE;
  v_intent public.privacy_storage_deletion_outbox%ROWTYPE;
BEGIN
  IF p_assessment_id IS NULL OR p_capture_id IS NULL OR p_practitioner_id IS NULL
    OR p_slot IS NULL OR p_slot NOT IN ('front', 'side-left', 'side-right', 'back')
    OR p_image_sha256 IS NULL OR p_image_sha256 !~ '^[0-9a-f]{64}$'
    OR p_storage_path IS DISTINCT FROM (
      p_practitioner_id::text || '/' || p_assessment_id::text || '/'
      || p_capture_id::text || '/' || p_image_sha256 || '.jpg'
    )
  THEN
    RETURN pg_catalog.jsonb_build_object('status', 'invalid_input');
  END IF;

  SELECT capture.* INTO v_capture
  FROM public.captures capture
  JOIN public.assessments assessment ON assessment.id = capture.assessment_id
  JOIN public.clients client ON client.id = assessment.client_id
  WHERE capture.id = p_capture_id
    AND capture.assessment_id = p_assessment_id
    AND capture.practitioner_id = p_practitioner_id
    AND assessment.practitioner_id = p_practitioner_id
    AND assessment.status = 'complete'
    AND client.practitioner_id = p_practitioner_id
    AND client.deleted_at IS NULL
    AND private.capture_slot_matches(capture.view, capture.profile_side, p_slot)
  FOR UPDATE OF capture;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_found');
  END IF;

  IF v_capture.storage_path IS NOT NULL THEN
    IF v_capture.storage_path = p_storage_path
      AND v_capture.image_sha256 = p_image_sha256
    THEN
      DELETE FROM public.privacy_storage_deletion_outbox job
      WHERE job.deletion_receipt_id IS NULL
        AND job.source_code = 'capture_upload_compensation'
        AND job.bucket = 'posture-captures'
        AND job.object_path = p_storage_path
        AND job.status IN ('pending', 'retry', 'complete');
      RETURN pg_catalog.jsonb_build_object(
        'status', 'already_saved', 'captureId', v_capture.id
      );
    END IF;
    RETURN pg_catalog.jsonb_build_object('status', 'conflict');
  END IF;

  SELECT job.* INTO v_intent
  FROM public.privacy_storage_deletion_outbox job
  WHERE job.bucket = 'posture-captures'
    AND job.object_path = p_storage_path
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.privacy_storage_deletion_outbox (
      deletion_receipt_id, source_code, bucket, object_path, next_attempt_at
    ) VALUES (
      NULL, 'capture_upload_compensation', 'posture-captures', p_storage_path,
      pg_catalog.clock_timestamp() + interval '15 minutes'
    );
    RETURN pg_catalog.jsonb_build_object('status', 'ready');
  END IF;

  IF v_intent.deletion_receipt_id IS NOT NULL
    OR v_intent.source_code <> 'capture_upload_compensation'
    OR v_intent.status = 'processing'
  THEN
    RETURN pg_catalog.jsonb_build_object('status', 'in_progress');
  END IF;

  UPDATE public.privacy_storage_deletion_outbox job
  SET status = 'pending',
      next_attempt_at = pg_catalog.clock_timestamp() + interval '15 minutes',
      locked_at = NULL,
      completed_at = NULL,
      last_error_code = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE job.id = v_intent.id;

  RETURN pg_catalog.jsonb_build_object('status', 'ready');
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_capture_image_upload(
  p_assessment_id uuid,
  p_capture_id uuid,
  p_practitioner_id uuid,
  p_slot text,
  p_storage_path text,
  p_image_sha256 text,
  p_image_byte_size integer,
  p_image_width_px integer,
  p_image_height_px integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_capture public.captures%ROWTYPE;
  v_intent_id uuid;
BEGIN
  IF p_assessment_id IS NULL OR p_capture_id IS NULL OR p_practitioner_id IS NULL
    OR p_slot IS NULL OR p_slot NOT IN ('front', 'side-left', 'side-right', 'back')
    OR p_storage_path IS NULL
    OR p_image_sha256 IS NULL OR p_image_sha256 !~ '^[0-9a-f]{64}$'
    OR p_storage_path IS DISTINCT FROM (
      p_practitioner_id::text || '/' || p_assessment_id::text || '/'
      || p_capture_id::text || '/' || p_image_sha256 || '.jpg'
    )
    OR p_image_byte_size IS NULL OR p_image_byte_size NOT BETWEEN 1 AND 4194304
    OR p_image_width_px IS NULL OR p_image_width_px NOT BETWEEN 1 AND 16000000
    OR p_image_height_px IS NULL OR p_image_height_px NOT BETWEEN 1 AND 16000000
    OR p_image_width_px::bigint * p_image_height_px::bigint > 16000000
  THEN
    RETURN pg_catalog.jsonb_build_object('status', 'invalid_input');
  END IF;

  SELECT capture.* INTO v_capture
  FROM public.captures capture
  JOIN public.assessments assessment ON assessment.id = capture.assessment_id
  JOIN public.clients client ON client.id = assessment.client_id
  WHERE capture.id = p_capture_id
    AND capture.assessment_id = p_assessment_id
    AND capture.practitioner_id = p_practitioner_id
    AND assessment.practitioner_id = p_practitioner_id
    AND assessment.status = 'complete'
    AND client.practitioner_id = p_practitioner_id
    AND client.deleted_at IS NULL
    AND private.capture_slot_matches(capture.view, capture.profile_side, p_slot)
  FOR UPDATE OF capture;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_found');
  END IF;

  IF v_capture.storage_path IS NOT NULL THEN
    IF v_capture.storage_path = p_storage_path
      AND v_capture.image_sha256 = p_image_sha256
    THEN
      DELETE FROM public.privacy_storage_deletion_outbox job
      WHERE job.deletion_receipt_id IS NULL
        AND job.source_code = 'capture_upload_compensation'
        AND job.bucket = 'posture-captures'
        AND job.object_path = p_storage_path
        AND job.status IN ('pending', 'retry', 'complete');
      RETURN pg_catalog.jsonb_build_object(
        'status', 'already_saved', 'captureId', v_capture.id
      );
    END IF;
    RETURN pg_catalog.jsonb_build_object('status', 'conflict');
  END IF;

  SELECT job.id INTO v_intent_id
  FROM public.privacy_storage_deletion_outbox job
  WHERE job.deletion_receipt_id IS NULL
    AND job.source_code = 'capture_upload_compensation'
    AND job.bucket = 'posture-captures'
    AND job.object_path = p_storage_path
    AND job.status IN ('pending', 'retry')
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'intent_missing');
  END IF;

  UPDATE public.captures
  SET storage_path = p_storage_path,
      image_sha256 = p_image_sha256,
      image_byte_size = p_image_byte_size,
      image_mime_type = 'image/jpeg',
      image_width_px = p_image_width_px,
      image_height_px = p_image_height_px
  WHERE id = v_capture.id;

  DELETE FROM public.privacy_storage_deletion_outbox WHERE id = v_intent_id;
  RETURN pg_catalog.jsonb_build_object('status', 'saved', 'captureId', v_capture.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_privacy_storage_deletions(
  p_limit int DEFAULT 25,
  p_receipt_id uuid DEFAULT NULL
) RETURNS TABLE (id uuid, deletion_receipt_id uuid, bucket text, object_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid claim limit' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT job.id
    FROM public.privacy_storage_deletion_outbox job
    WHERE (p_receipt_id IS NULL OR job.deletion_receipt_id = p_receipt_id)
      AND (
        (job.status IN ('pending', 'retry') AND job.next_attempt_at <= pg_catalog.clock_timestamp())
        OR
        (job.status = 'processing' AND job.locked_at < pg_catalog.clock_timestamp() - interval '5 minutes')
      )
      AND NOT (
        job.source_code = 'capture_upload_compensation'
        AND EXISTS (
          SELECT 1 FROM public.captures capture
          WHERE capture.storage_path = job.object_path
        )
      )
    ORDER BY job.created_at, job.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.privacy_storage_deletion_outbox job
    SET status = 'processing', attempts = job.attempts + 1,
        locked_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
    FROM due
    WHERE job.id = due.id
    RETURNING job.id, job.deletion_receipt_id, job.bucket, job.object_path
  )
  SELECT claimed.id, claimed.deletion_receipt_id, claimed.bucket, claimed.object_path
  FROM claimed;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_capture_image_upload(
  uuid, uuid, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_capture_image_upload(
  uuid, uuid, uuid, text, text, text
) TO service_role;

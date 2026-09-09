-- Governed private persistence for the representative image of each capture
-- slot. Pose landmarks remain the scoring source; these bytes are evidence for
-- the owning practitioner and never receive a public storage capability.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('posture-captures', 'posture-captures', false, 4194304, ARRAY['image/jpeg']::text[])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.captures
  ADD COLUMN IF NOT EXISTS image_sha256 text,
  ADD COLUMN IF NOT EXISTS image_byte_size integer,
  ADD COLUMN IF NOT EXISTS image_mime_type text,
  ADD COLUMN IF NOT EXISTS image_width_px integer,
  ADD COLUMN IF NOT EXISTS image_height_px integer;

ALTER TABLE public.captures DROP CONSTRAINT IF EXISTS captures_no_image_bytes;
ALTER TABLE public.captures DROP CONSTRAINT IF EXISTS captures_image_storage_shape;
ALTER TABLE public.captures ADD CONSTRAINT captures_image_storage_shape CHECK ((
  (
    storage_path IS NULL
    AND image_sha256 IS NULL
    AND image_byte_size IS NULL
    AND image_mime_type IS NULL
    AND image_width_px IS NULL
    AND image_height_px IS NULL
  )
  OR (
    storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{64}\.jpg$'
    AND image_sha256 ~ '^[0-9a-f]{64}$'
    AND storage_path = practitioner_id::text || '/' || assessment_id::text || '/' || id::text || '/' || image_sha256 || '.jpg'
    AND image_byte_size BETWEEN 1 AND 4194304
    AND image_mime_type = 'image/jpeg'
    AND image_width_px BETWEEN 1 AND 16000000
    AND image_height_px BETWEEN 1 AND 16000000
    AND image_width_px::bigint * image_height_px::bigint <= 16000000
  )
) IS TRUE) NOT VALID;
ALTER TABLE public.captures VALIDATE CONSTRAINT captures_image_storage_shape;

ALTER TABLE public.privacy_storage_deletion_outbox
  DROP CONSTRAINT IF EXISTS privacy_storage_deletion_outbox_source_code_check;
ALTER TABLE public.privacy_storage_deletion_outbox
  DROP CONSTRAINT IF EXISTS privacy_storage_deletion_outbox_check;
ALTER TABLE public.privacy_storage_deletion_outbox
  DROP CONSTRAINT IF EXISTS privacy_storage_deletion_outbox_source_shape;

ALTER TABLE public.privacy_storage_deletion_outbox
  ADD CONSTRAINT privacy_storage_deletion_outbox_source_code_check CHECK ((
    source_code IN (
      'client_erasure',
      'report_insert_compensation',
      'capture_upload_compensation',
      'capture_delete'
    )
  ) IS TRUE),
  ADD CONSTRAINT privacy_storage_deletion_outbox_source_shape CHECK ((
    (source_code = 'client_erasure' AND deletion_receipt_id IS NOT NULL)
    OR (
      source_code IN ('report_insert_compensation', 'capture_upload_compensation', 'capture_delete')
      AND deletion_receipt_id IS NULL
    )
  ) IS TRUE);

CREATE OR REPLACE FUNCTION private.capture_slot_matches(
  p_view public.view_enum,
  p_profile_side text,
  p_slot text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_slot
    WHEN 'front' THEN p_view = 'front'::public.view_enum AND p_profile_side IS NULL
    WHEN 'side-left' THEN p_view = 'side'::public.view_enum AND p_profile_side = 'left'
    WHEN 'side-right' THEN p_view = 'side'::public.view_enum AND p_profile_side = 'right'
    WHEN 'back' THEN p_view = 'back'::public.view_enum AND p_profile_side IS NULL
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION private.capture_slot_matches(public.view_enum, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.capture_slot_matches(public.view_enum, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_capture_image_slot(
  p_assessment_id uuid,
  p_practitioner_id uuid,
  p_slot text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_capture public.captures%ROWTYPE;
BEGIN
  IF p_assessment_id IS NULL OR p_practitioner_id IS NULL OR p_slot IS NULL
    OR p_slot NOT IN ('front', 'side-left', 'side-right', 'back')
  THEN
    RETURN pg_catalog.jsonb_build_object('status', 'invalid_input');
  END IF;

  SELECT capture.* INTO v_capture
  FROM public.captures capture
  JOIN public.assessments assessment ON assessment.id = capture.assessment_id
  JOIN public.clients client ON client.id = assessment.client_id
  JOIN public.practitioners practitioner ON practitioner.id = assessment.practitioner_id
  WHERE assessment.id = p_assessment_id
    AND assessment.practitioner_id = p_practitioner_id
    AND assessment.status = 'complete'
    AND capture.practitioner_id = p_practitioner_id
    AND client.practitioner_id = p_practitioner_id
    AND client.deleted_at IS NULL
    AND practitioner.access_status = 'active'
    AND practitioner.role = 'practitioner'
    AND private.capture_slot_matches(capture.view, capture.profile_side, p_slot)
  -- Once a slot has an image, all exact retries resolve that row. Before the
  -- first upload, UUID order is stable even when a burst produced many rows.
  ORDER BY (capture.storage_path IS NULL), capture.id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_found');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'found',
    'captureId', v_capture.id,
    'storagePath', v_capture.storage_path,
    'imageSha256', v_capture.image_sha256
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_capture_image_slot(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_capture_image_slot(uuid, uuid, text)
  TO service_role;

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
      RETURN pg_catalog.jsonb_build_object('status', 'already_saved', 'captureId', v_capture.id);
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

REVOKE ALL ON FUNCTION public.finalize_capture_image_upload(
  uuid, uuid, uuid, text, text, text, integer, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_capture_image_upload(
  uuid, uuid, uuid, text, text, text, integer, integer, integer
) TO service_role;

CREATE OR REPLACE FUNCTION private.prevent_capture_image_overwrite()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.storage_path IS NOT NULL AND (
    NEW.storage_path IS DISTINCT FROM OLD.storage_path
    OR NEW.image_sha256 IS DISTINCT FROM OLD.image_sha256
    OR NEW.image_byte_size IS DISTINCT FROM OLD.image_byte_size
    OR NEW.image_mime_type IS DISTINCT FROM OLD.image_mime_type
    OR NEW.image_width_px IS DISTINCT FROM OLD.image_width_px
    OR NEW.image_height_px IS DISTINCT FROM OLD.image_height_px
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'PT409',
      MESSAGE = 'capture_image_immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS captures_prevent_image_overwrite ON public.captures;
CREATE TRIGGER captures_prevent_image_overwrite
BEFORE UPDATE OF storage_path, image_sha256, image_byte_size, image_mime_type,
  image_width_px, image_height_px ON public.captures
FOR EACH ROW EXECUTE FUNCTION private.prevent_capture_image_overwrite();

CREATE OR REPLACE FUNCTION private.enqueue_capture_image_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.storage_path IS NOT NULL THEN
    INSERT INTO public.privacy_storage_deletion_outbox (
      deletion_receipt_id, source_code, bucket, object_path, next_attempt_at
    ) VALUES (
      NULL, 'capture_delete', 'posture-captures', OLD.storage_path,
      pg_catalog.clock_timestamp()
    )
    ON CONFLICT (bucket, object_path) DO UPDATE
    SET source_code = CASE
          WHEN public.privacy_storage_deletion_outbox.deletion_receipt_id IS NULL
            THEN 'capture_delete'
          ELSE 'client_erasure'
        END,
        status = 'pending',
        next_attempt_at = pg_catalog.clock_timestamp(),
        locked_at = NULL,
        completed_at = NULL,
        last_error_code = NULL,
        updated_at = pg_catalog.clock_timestamp();
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS captures_enqueue_image_deletion ON public.captures;
CREATE TRIGGER captures_enqueue_image_deletion
BEFORE DELETE ON public.captures
FOR EACH ROW EXECUTE FUNCTION private.enqueue_capture_image_deletion();

CREATE OR REPLACE FUNCTION private.enqueue_assessment_capture_image_deletions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt_id uuid;
BEGIN
  SELECT receipt.id INTO v_receipt_id
  FROM public.client_deletion_log receipt
  WHERE receipt.original_client_id = OLD.client_id
    AND receipt.practitioner_id = OLD.practitioner_id
  ORDER BY receipt.deleted_at, receipt.id
  LIMIT 1;

  INSERT INTO public.privacy_storage_deletion_outbox (
    deletion_receipt_id, source_code, bucket, object_path, next_attempt_at
  )
  SELECT
    v_receipt_id,
    CASE WHEN v_receipt_id IS NULL THEN 'capture_delete' ELSE 'client_erasure' END,
    'posture-captures',
    capture.storage_path,
    pg_catalog.clock_timestamp()
  FROM public.captures capture
  WHERE capture.assessment_id = OLD.id
    AND capture.storage_path IS NOT NULL
  ON CONFLICT (bucket, object_path) DO UPDATE
  SET deletion_receipt_id = COALESCE(
        EXCLUDED.deletion_receipt_id,
        public.privacy_storage_deletion_outbox.deletion_receipt_id
      ),
      source_code = CASE
        WHEN COALESCE(
          EXCLUDED.deletion_receipt_id,
          public.privacy_storage_deletion_outbox.deletion_receipt_id
        ) IS NULL THEN 'capture_delete'
        ELSE 'client_erasure'
      END,
      status = 'pending',
      next_attempt_at = pg_catalog.clock_timestamp(),
      locked_at = NULL,
      completed_at = NULL,
      last_error_code = NULL,
      updated_at = pg_catalog.clock_timestamp();

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS assessments_enqueue_capture_image_deletions ON public.assessments;
CREATE TRIGGER assessments_enqueue_capture_image_deletions
BEFORE DELETE ON public.assessments
FOR EACH ROW EXECUTE FUNCTION private.enqueue_assessment_capture_image_deletions();

REVOKE ALL ON FUNCTION private.prevent_capture_image_overwrite() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.enqueue_capture_image_deletion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.enqueue_assessment_capture_image_deletions() FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.captures.storage_path IS
  'Private posture-captures object for the representative acquisition image; immutable after finalization.';

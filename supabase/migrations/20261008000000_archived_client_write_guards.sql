-- Match the established erased-client guard at each capture, consent, workout,
-- share, image, and report boundary. Preserve the existing function signatures,
-- grants, and return contracts; fail the migration if a prior definition drifts.
DO $migration$
DECLARE
  boundary record;
  function_oid oid;
  definition text;
BEGIN
  FOR boundary IN
    SELECT * FROM (VALUES
      ('create_assessment_prototype', 1),
      ('create_workout_session_clinical_governed', 1),
      ('create_workout_session_prototype', 1),
      ('finalize_capture_image_upload', 1),
      ('finalize_report_upload_prototype', 1),
      ('finalize_report_upload_v2', 1),
      ('prepare_capture_image_upload', 1),
      ('record_inperson_consent', 1),
      ('record_inperson_consent_governed', 1),
      ('record_remote_consent', 1),
      ('record_remote_consent_governed', 1),
      ('reject_insert_for_deleted_client', 1),
      ('reject_report_for_deleted_client', 2),
      ('resolve_capture_image_slot', 1),
      ('resolve_workout_token', 1),
      ('rotate_workout_share', 1),
      ('withdraw_client_consent', 1)
    ) AS functions(name, guard_count)
  LOOP
    SELECT p.oid, pg_catalog.pg_get_functiondef(p.oid)
      INTO function_oid, definition
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = boundary.name AND p.prokind = 'f';

    IF function_oid IS NULL
      OR pg_catalog.regexp_count(definition, '([a-z_]+\.)?deleted_at IS NULL') <> boundary.guard_count
    THEN
      RAISE EXCEPTION 'Unexpected erased-client guard in %', boundary.name;
    END IF;

    EXECUTE pg_catalog.regexp_replace(
      definition,
      '([a-z_]+\.)?deleted_at IS NULL',
      '\1deleted_at IS NULL AND \1archived_at IS NULL',
      'g'
    );
  END LOOP;

  -- Older service writers can still UPDATE an existing session directly. The
  -- rotation RPC above locks the client, but this trigger's UPDATE branch did
  -- not. Keep the same lock and denial for token/expiry updates through either
  -- path while leaving token clearing (revocation) available after archive.
  SELECT pg_catalog.pg_get_functiondef(
    'private.enforce_workout_share_monotonicity()'::pg_catalog.regprocedure
  ) INTO definition;
  IF pg_catalog.regexp_count(definition, 'IF TG_OP = ''UPDATE'' THEN') <> 1 THEN
    RAISE EXCEPTION 'Unexpected direct share update guard';
  END IF;
  EXECUTE pg_catalog.replace(
    definition,
    'IF TG_OP = ''UPDATE'' THEN',
    $guard$IF TG_OP = 'UPDATE' THEN
    PERFORM 1
    FROM public.clients c
    WHERE c.id = NEW.client_id
      AND c.practitioner_id = NEW.practitioner_id
      AND c.deleted_at IS NULL
      AND c.archived_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'cannot share for a deleted, unknown, or mismatched client'
        USING ERRCODE = 'check_violation';
    END IF;$guard$
  );
END;
$migration$;

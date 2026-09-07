-- Original-app workout personalization metadata. Existing workout sessions stay
-- valid with NULL metadata; new personalized sessions store a bounded name,
-- preference object, and the selector that produced the immutable snapshot.

CREATE OR REPLACE FUNCTION private.valid_workout_preferences(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_typeof(value) = 'object'
    AND value ?& ARRAY['goal', 'minutes', 'capability', 'equipment']
    AND value - ARRAY['goal', 'minutes', 'capability', 'equipment'] = '{}'::jsonb
    AND value->>'goal' IN ('balanced', 'desk-reset', 'mobility', 'strength')
    AND value->>'minutes' IN ('10', '15', '20')
    AND value->>'capability' IN ('regression', 'standard', 'progression')
    AND pg_catalog.jsonb_typeof(value->'equipment') = 'array'
    AND pg_catalog.jsonb_array_length(value->'equipment') <= 2
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements_text(value->'equipment') AS equipment(item)
      WHERE item NOT IN ('band', 'roller')
    )
    AND (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.jsonb_array_elements_text(value->'equipment') AS equipment(item)
    ) = (
      SELECT pg_catalog.count(DISTINCT item)
      FROM pg_catalog.jsonb_array_elements_text(value->'equipment') AS equipment(item)
    );
$$;

REVOKE ALL ON FUNCTION private.valid_workout_preferences(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.valid_workout_preferences(jsonb) TO service_role;

ALTER TABLE public.workout_sessions
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS preferences jsonb,
  ADD COLUMN IF NOT EXISTS generation_source text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.workout_sessions
    ADD CONSTRAINT workout_sessions_personalization_paired CHECK (
      (name IS NULL AND preferences IS NULL AND generation_source IS NULL)
      OR (
        name IS NOT NULL
        AND preferences IS NOT NULL
        AND generation_source IS NOT NULL
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE public.workout_sessions
    ADD CONSTRAINT workout_sessions_name_shape CHECK (
      name IS NULL OR (
        name = pg_catalog.btrim(name)
        AND pg_catalog.char_length(name) BETWEEN 1 AND 80
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE public.workout_sessions
    ADD CONSTRAINT workout_sessions_preferences_shape CHECK (
      preferences IS NULL OR private.valid_workout_preferences(preferences)
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE public.workout_sessions
    ADD CONSTRAINT workout_sessions_generation_source CHECK (
      generation_source IS NULL OR generation_source IN ('scan', 'ai')
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_workout_sessions_practitioner_library
  ON public.workout_sessions (practitioner_id, created_at DESC, id DESC)
  WHERE archived_at IS NULL;

CREATE FUNCTION public.create_personalized_workout_session_clinical_governed(
  p_assessment_id uuid,
  p_client_id uuid,
  p_practitioner_id uuid,
  p_week int,
  p_capability text,
  p_program_snapshot jsonb,
  p_estimated_duration_sec int,
  p_token_hash text,
  p_expires_at timestamptz,
  p_operation_id uuid,
  p_ip_hash text,
  p_document_id text,
  p_document_version text,
  p_document_body_sha256 text,
  p_document_effective_at timestamptz,
  p_jurisdiction text,
  p_product_scope text,
  p_clinical_content_version text,
  p_clinical_inventory_sha256 text,
  p_name text,
  p_preferences jsonb,
  p_generation_source text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  creation jsonb;
  session_id uuid;
BEGIN
  IF p_name IS NULL
    OR p_name <> pg_catalog.btrim(p_name)
    OR pg_catalog.char_length(p_name) NOT BETWEEN 1 AND 80
    OR NOT private.valid_workout_preferences(p_preferences)
    OR p_preferences->>'capability' <> p_capability
    OR p_generation_source NOT IN ('scan', 'ai')
  THEN
    RETURN pg_catalog.jsonb_build_object('status', 'invalid_input');
  END IF;

  creation := public.create_workout_session_clinical_governed(
    p_assessment_id,
    p_client_id,
    p_practitioner_id,
    p_week,
    p_capability,
    p_program_snapshot,
    p_estimated_duration_sec,
    p_token_hash,
    p_expires_at,
    p_operation_id,
    p_ip_hash,
    p_document_id,
    p_document_version,
    p_document_body_sha256,
    p_document_effective_at,
    p_jurisdiction,
    p_product_scope,
    p_clinical_content_version,
    p_clinical_inventory_sha256
  );

  IF creation->>'status' <> 'created' THEN RETURN creation; END IF;
  session_id := (creation->>'session_id')::uuid;

  UPDATE public.workout_sessions
  SET name = p_name,
      preferences = p_preferences,
      generation_source = p_generation_source
  WHERE id = session_id
    AND practitioner_id = p_practitioner_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'created workout session is unavailable'; END IF;
  RETURN creation;
END;
$$;

REVOKE ALL ON FUNCTION public.create_personalized_workout_session_clinical_governed(
  uuid, uuid, uuid, int, text, jsonb, int, text, timestamptz, uuid, text,
  text, text, text, timestamptz, text, text, text, text, text, jsonb, text
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.create_personalized_workout_session_clinical_governed(
  uuid, uuid, uuid, int, text, jsonb, int, text, timestamptz, uuid, text,
  text, text, text, timestamptz, text, text, text, text, text, jsonb, text
) TO service_role;

CREATE FUNCTION public.archive_workout_session(
  p_session_id uuid,
  p_practitioner_id uuid,
  p_operation_id uuid,
  p_archived_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  session_row public.workout_sessions%ROWTYPE;
  revoke_result jsonb;
BEGIN
  IF p_session_id IS NULL OR p_practitioner_id IS NULL OR p_operation_id IS NULL
    OR p_archived_at IS NULL
    OR p_archived_at > pg_catalog.clock_timestamp() + interval '5 minutes'
  THEN
    RETURN pg_catalog.jsonb_build_object('status', 'invalid_input');
  END IF;

  SELECT session.* INTO session_row
  FROM public.workout_sessions session
  WHERE session.id = p_session_id
    AND session.practitioner_id = p_practitioner_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_found'); END IF;
  IF session_row.archived_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'already_archived');
  END IF;

  IF session_row.session_token_hash IS NOT NULL THEN
    revoke_result := public.revoke_workout_share(
      p_session_id,
      p_practitioner_id,
      'practitioner_action',
      p_operation_id,
      p_archived_at
    );
    IF revoke_result->>'status' NOT IN ('revoked', 'already_revoked') THEN
      RETURN revoke_result;
    END IF;
  END IF;

  UPDATE public.workout_sessions
  SET status = 'archived', archived_at = p_archived_at
  WHERE id = p_session_id AND practitioner_id = p_practitioner_id;

  RETURN pg_catalog.jsonb_build_object('status', 'archived');
END;
$$;

REVOKE ALL ON FUNCTION public.archive_workout_session(uuid, uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.archive_workout_session(uuid, uuid, uuid, timestamptz)
  TO service_role;

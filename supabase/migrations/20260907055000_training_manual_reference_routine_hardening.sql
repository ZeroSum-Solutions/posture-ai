-- Keep pinned exercise displays valid at the database boundary and expose
-- stable, bounded keyset pagination for manual reference routines.

CREATE OR REPLACE FUNCTION private.is_valid_manual_reference_exercise_display(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_entry jsonb;
  v_media jsonb;
  v_source jsonb;
  v_license jsonb;
BEGIN
  IF COALESCE(
    NOT private.jsonb_has_exact_keys(p_value, ARRAY[
      'name','instructions','equipment','media','source'
    ])
    OR pg_catalog.jsonb_typeof(p_value->'name') IS DISTINCT FROM 'string'
    OR pg_catalog.length(pg_catalog.btrim(p_value->>'name')) NOT BETWEEN 1 AND 160
    OR pg_catalog.jsonb_typeof(p_value->'instructions') IS DISTINCT FROM 'string'
    OR pg_catalog.length(pg_catalog.btrim(p_value->>'instructions')) NOT BETWEEN 1 AND 4000
    OR pg_catalog.jsonb_typeof(p_value->'equipment') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(p_value->'equipment') > 20,
    true
  ) THEN
    RETURN false;
  END IF;

  FOR v_entry IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value->'equipment') LOOP
    IF pg_catalog.jsonb_typeof(v_entry) IS DISTINCT FROM 'string'
      OR pg_catalog.length(pg_catalog.btrim(v_entry#>>'{}')) NOT BETWEEN 1 AND 160
    THEN
      RETURN false;
    END IF;
  END LOOP;

  v_source := p_value->'source';
  IF COALESCE(
    NOT private.jsonb_has_exact_keys(v_source, ARRAY['provider','recordUrl','author','license'])
    OR v_source->>'provider' IS DISTINCT FROM 'wger'
    OR pg_catalog.jsonb_typeof(v_source->'recordUrl') IS DISTINCT FROM 'string'
    OR v_source->>'recordUrl' !~ '^https://wger[.]de/[^[:space:]]+$'
    OR pg_catalog.jsonb_typeof(v_source->'author') IS DISTINCT FROM 'string'
    OR pg_catalog.length(pg_catalog.btrim(v_source->>'author')) NOT BETWEEN 1 AND 160,
    true
  ) THEN
    RETURN false;
  END IF;

  v_license := v_source->'license';
  IF COALESCE(
    NOT private.jsonb_has_exact_keys(v_license, ARRAY['shortName','url'])
    OR v_license->>'shortName' NOT IN ('CC-BY-SA 3','CC-BY-SA 4')
    OR pg_catalog.jsonb_typeof(v_license->'url') IS DISTINCT FROM 'string'
    OR v_license->>'url' !~ '^https://creativecommons[.]org/[^[:space:]]+$',
    true
  ) THEN
    RETURN false;
  END IF;

  v_media := p_value->'media';
  IF pg_catalog.jsonb_typeof(v_media) = 'null' THEN
    RETURN true;
  END IF;
  IF COALESCE(
    NOT private.jsonb_has_exact_keys(v_media, ARRAY[
      'kind','posterUrl','alt','width','height','mimeType','sha256','source'
    ])
    OR v_media->>'kind' IS DISTINCT FROM 'image'
    OR pg_catalog.jsonb_typeof(v_media->'posterUrl') IS DISTINCT FROM 'string'
    OR v_media->>'posterUrl' NOT LIKE '/training/reference/%'
    OR pg_catalog.jsonb_typeof(v_media->'alt') IS DISTINCT FROM 'string'
    OR pg_catalog.length(pg_catalog.btrim(v_media->>'alt')) NOT BETWEEN 1 AND 160
    OR pg_catalog.jsonb_typeof(v_media->'width') IS DISTINCT FROM 'number'
    OR (v_media->>'width')::numeric <> pg_catalog.trunc((v_media->>'width')::numeric)
    OR (v_media->>'width')::numeric NOT BETWEEN 1 AND 4096
    OR pg_catalog.jsonb_typeof(v_media->'height') IS DISTINCT FROM 'number'
    OR (v_media->>'height')::numeric <> pg_catalog.trunc((v_media->>'height')::numeric)
    OR (v_media->>'height')::numeric NOT BETWEEN 1 AND 4096
    OR v_media->>'mimeType' IS DISTINCT FROM 'image/webp'
    OR pg_catalog.jsonb_typeof(v_media->'sha256') IS DISTINCT FROM 'string'
    OR v_media->>'sha256' !~ '^[a-f0-9]{64}$',
    true
  ) THEN
    RETURN false;
  END IF;

  v_source := v_media->'source';
  IF COALESCE(
    NOT private.jsonb_has_exact_keys(v_source, ARRAY[
      'provider','exerciseRecordId','assetId','assetUuid','assetUrl','author',
      'authorHistory','license','isAiGenerated','modifications'
    ])
    OR v_source->>'provider' IS DISTINCT FROM 'wger'
    OR pg_catalog.jsonb_typeof(v_source->'exerciseRecordId') IS DISTINCT FROM 'number'
    OR (v_source->>'exerciseRecordId')::numeric <> pg_catalog.trunc((v_source->>'exerciseRecordId')::numeric)
    OR (v_source->>'exerciseRecordId')::numeric <= 0
    OR pg_catalog.jsonb_typeof(v_source->'assetId') IS DISTINCT FROM 'number'
    OR (v_source->>'assetId')::numeric <> pg_catalog.trunc((v_source->>'assetId')::numeric)
    OR (v_source->>'assetId')::numeric <= 0
    OR pg_catalog.jsonb_typeof(v_source->'assetUuid') IS DISTINCT FROM 'string'
    OR v_source->>'assetUuid' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR pg_catalog.jsonb_typeof(v_source->'assetUrl') IS DISTINCT FROM 'string'
    OR v_source->>'assetUrl' !~ '^https://wger[.]de/[^[:space:]]+$'
    OR pg_catalog.jsonb_typeof(v_source->'author') IS DISTINCT FROM 'string'
    OR pg_catalog.length(pg_catalog.btrim(v_source->>'author')) NOT BETWEEN 1 AND 160
    OR pg_catalog.jsonb_typeof(v_source->'authorHistory') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(v_source->'authorHistory') NOT BETWEEN 1 AND 20
    OR v_source->'isAiGenerated' IS DISTINCT FROM 'false'::jsonb
    OR v_source->>'modifications' IS DISTINCT FROM 'none',
    true
  ) THEN
    RETURN false;
  END IF;

  FOR v_entry IN SELECT value FROM pg_catalog.jsonb_array_elements(v_source->'authorHistory') LOOP
    IF pg_catalog.jsonb_typeof(v_entry) IS DISTINCT FROM 'string'
      OR pg_catalog.length(pg_catalog.btrim(v_entry#>>'{}')) NOT BETWEEN 1 AND 160
    THEN
      RETURN false;
    END IF;
  END LOOP;

  v_license := v_source->'license';
  RETURN COALESCE(
    private.jsonb_has_exact_keys(v_license, ARRAY['shortName','url'])
    AND v_license->>'shortName' IN ('CC-BY-SA 3','CC-BY-SA 4')
    AND pg_catalog.jsonb_typeof(v_license->'url') = 'string'
    AND v_license->>'url' ~ '^https://creativecommons[.]org/[^[:space:]]+$',
    false
  );
EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN false;
END;
$$;

ALTER TABLE public.training_reference_library_records
  ADD CONSTRAINT training_reference_library_display_json_v1
  CHECK ((private.is_valid_manual_reference_exercise_display(display_json)) IS TRUE)
  NOT VALID;

ALTER TABLE public.training_reference_library_records
  VALIDATE CONSTRAINT training_reference_library_display_json_v1;

CREATE INDEX training_manual_routines_subject_updated_id
  ON public.training_manual_reference_routines(subject_id, updated_at DESC, id ASC);

CREATE OR REPLACE FUNCTION public.list_training_manual_reference_routines_page(
  p_subject_id uuid,
  p_limit integer,
  p_cursor_updated_at timestamptz,
  p_cursor_routine_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_page jsonb;
  v_routines jsonb;
  v_has_more boolean;
  v_last jsonb;
BEGIN
  IF p_subject_id IS NULL
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR ((p_cursor_updated_at IS NULL) <> (p_cursor_routine_id IS NULL))
  THEN
    RAISE EXCEPTION 'invalid manual reference routine page' USING ERRCODE = '22023';
  END IF;
  IF private.can_write_training_manual_reference_routine(p_subject_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'manual reference routine read is not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'routineId',routine.id,
    'subjectId',routine.subject_id,
    'revision',routine.current_revision,
    'status',routine.status,
    'title',routine.title,
    'itemCount',pg_catalog.jsonb_array_length(revision.routine_json->'items'),
    'updatedAt',routine.updated_at,
    'archivedAt',routine.archived_at
  ) ORDER BY routine.updated_at DESC, routine.id ASC), '[]'::jsonb)
  INTO v_page
  FROM (
    SELECT * FROM public.training_manual_reference_routines
    WHERE subject_id = p_subject_id
      AND (
        p_cursor_updated_at IS NULL
        OR updated_at < p_cursor_updated_at
        OR (updated_at = p_cursor_updated_at AND id > p_cursor_routine_id)
      )
    ORDER BY updated_at DESC, id ASC
    LIMIT (p_limit + 1)
  ) routine
  JOIN public.training_manual_reference_routine_revisions revision
    ON revision.routine_id = routine.id AND revision.revision = routine.current_revision;

  v_has_more := pg_catalog.jsonb_array_length(v_page) > p_limit;
  v_routines := CASE WHEN v_has_more THEN v_page - p_limit ELSE v_page END;
  v_last := CASE WHEN v_has_more
    THEN v_routines->(pg_catalog.jsonb_array_length(v_routines) - 1)
    ELSE NULL
  END;

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion','manual-reference-routine-list.v1',
    'subjectId',p_subject_id,
    'routines',v_routines,
    'hasMore',v_has_more,
    'nextCursor',CASE WHEN v_last IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
      'updatedAt',v_last->>'updatedAt',
      'routineId',v_last->>'routineId'
    ) END
  );
END;
$$;

-- Preserve the original RPC signature for older callers while making its
-- previous 100-row truncation explicit in the returned pagination metadata.
CREATE OR REPLACE FUNCTION public.list_training_manual_reference_routines(p_subject_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.list_training_manual_reference_routines_page(
    p_subject_id,100,NULL,NULL
  );
$$;

REVOKE ALL ON FUNCTION private.is_valid_manual_reference_exercise_display(jsonb),
  public.list_training_manual_reference_routines_page(uuid,integer,timestamptz,uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.list_training_manual_reference_routines_page(uuid,integer,timestamptz,uuid)
  TO authenticated;

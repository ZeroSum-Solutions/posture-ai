-- Close acceptance-time gaps found in the bounded 68100 review without
-- changing the versioned decision or public acceptance interfaces. The guard
-- runs inside the existing acceptance transaction before its receipt insert;
-- any failure rolls back the already-staged program revision.

CREATE OR REPLACE FUNCTION private.is_current_training_bodyweight_assistance_evidence(
  p_proposal public.training_progression_proposals
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_program jsonb;
  v_target jsonb;
  v_target_count bigint;
  v_latest_session_id text;
  v_latest_session_revision bigint;
  v_latest_exercise_instance_id text;
BEGIN
  IF p_proposal.decision_json->>'schemaVersion'
    IS DISTINCT FROM 'bodyweight-assistance-progression-decision.v1' THEN
    RETURN true;
  END IF;

  SELECT revision.program_json INTO v_program
  FROM public.training_program_revisions revision
  WHERE revision.assignment_id = p_proposal.assignment_id
    AND revision.revision_number = p_proposal.base_program_revision_number;
  IF v_program IS NULL OR pg_catalog.jsonb_typeof(v_program->'sessions') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;

  SELECT pg_catalog.count(*), pg_catalog.jsonb_agg(exercise.value)->0
  INTO v_target_count, v_target
  FROM pg_catalog.jsonb_array_elements(v_program->'sessions') session(value)
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(session.value->'exercises') exercise(value)
  WHERE session.value->>'sessionId' = p_proposal.target_session_id
    AND exercise.value->>'exerciseInstanceId' = p_proposal.target_exercise_instance_id;
  IF v_target_count IS DISTINCT FROM 1
    OR pg_catalog.jsonb_typeof(v_target->'setIds') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_typeof(p_proposal.decision_json->'targetReps') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(p_proposal.decision_json->'targetReps')
      IS DISTINCT FROM pg_catalog.jsonb_array_length(v_target->'setIds')
    OR v_target->'targetReps' IS NOT DISTINCT FROM p_proposal.decision_json->'targetReps'
  THEN
    RETURN false;
  END IF;

  -- Metadata exists only for started session prescriptions. Resolve the latest
  -- started member of this exact assignment/subject/series independently of
  -- the proposal-supplied binding list, then require that exact revision.
  SELECT source_session.id, source_session.revision, metadata.exercise_instance_id
  INTO v_latest_session_id, v_latest_session_revision, v_latest_exercise_instance_id
  FROM public.training_session_progression_metadata metadata
  JOIN public.training_sessions source_session
    ON source_session.id = metadata.session_id
    AND source_session.assignment_id = p_proposal.assignment_id
    AND source_session.subject_id = p_proposal.subject_id
  JOIN public.training_session_prescriptions prescription
    ON prescription.session_id = source_session.id
    AND prescription.assignment_id = p_proposal.assignment_id
    AND prescription.subject_id = p_proposal.subject_id
  WHERE metadata.subject_id = p_proposal.subject_id
    AND metadata.progression_series_id = p_proposal.progression_series_id
  ORDER BY prescription.started_at DESC, source_session.id DESC
  LIMIT 1;
  IF v_latest_session_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_proposal.source_session_revisions) source(value)
    WHERE source.value->>'sessionId' = v_latest_session_id
      AND (source.value->>'revision')::bigint = v_latest_session_revision
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.training_current_set_actuals actual
    WHERE actual.session_id = v_latest_session_id
      AND actual.event_json->>'exerciseInstanceId' = v_latest_exercise_instance_id
      AND actual.event_json->>'symptomState' IS DISTINCT FROM 'none'
  ) THEN
    RETURN false;
  END IF;
  RETURN true;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_training_bodyweight_assistance_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_proposal public.training_progression_proposals%ROWTYPE;
  v_expected jsonb;
BEGIN
  SELECT * INTO v_proposal FROM public.training_progression_proposals
  WHERE id = NEW.proposal_id;
  IF NOT FOUND OR v_proposal.decision_json->>'schemaVersion'
    IS DISTINCT FROM 'bodyweight-assistance-progression-decision.v1' THEN
    RETURN NEW;
  END IF;
  IF NOT private.is_current_training_bodyweight_assistance_evidence(v_proposal) THEN
    RAISE EXCEPTION 'bodyweight or assistance progression evidence changed'
      USING ERRCODE = 'PT409';
  END IF;
  v_expected := private.expected_training_bodyweight_assistance_reps(v_proposal);
  IF v_expected IS NULL OR v_expected IS DISTINCT FROM v_proposal.decision_json->'targetReps' THEN
    RAISE EXCEPTION 'bodyweight or assistance progression evidence changed'
      USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.is_current_training_bodyweight_assistance_evidence(
  public.training_progression_proposals
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

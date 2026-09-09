-- Read-only source projection for the most recent comparable strength
-- performance. The browser supplies resource identities only; the immutable
-- prescription and authored progression series determine candidate history.

CREATE OR REPLACE FUNCTION public.read_training_previous_performance_sources(
  p_session_id text,
  p_exercise_instance_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_session public.training_sessions%ROWTYPE;
  v_started_at timestamptz;
  v_series_id text;
  v_current jsonb;
  v_history jsonb;
BEGIN
  IF NOT private.is_stable_training_reference(p_session_id, 128)
    OR NOT private.is_stable_training_reference(p_exercise_instance_id, 128) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_session
  FROM public.training_sessions
  WHERE id = p_session_id
    AND session_kind = 'strength';
  IF NOT FOUND OR NOT private.can_read_training_assignment(v_session.assignment_id) THEN
    RETURN NULL;
  END IF;

  SELECT prescription.started_at,
    exercise.value#>>'{progression,progressionSeriesId}'
  INTO v_started_at, v_series_id
  FROM public.training_session_prescriptions prescription
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
    prescription.prescription_json->'exercises'
  ) exercise(value)
  WHERE prescription.session_id = p_session_id
    AND exercise.value->>'exerciseInstanceId' = p_exercise_instance_id;

  v_current := public.read_training_strength_evidence_projection(
    p_session_id, p_exercise_instance_id
  );

  IF v_started_at IS NULL OR v_series_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'current', v_current,
      'history', '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'scheduledLocalDate', candidate.scheduled_local_date,
      'evidence', candidate.evidence
    ) ORDER BY candidate.completed_at DESC, candidate.started_at DESC, candidate.session_id DESC
  ), '[]'::jsonb)
  INTO v_history
  FROM (
    SELECT prior_session.id AS session_id,
      prior_session.scheduled_local_date::text AS scheduled_local_date,
      prior_session.completed_at,
      prior_prescription.started_at,
      public.read_training_strength_evidence_projection(
        prior_session.id, prior_exercise.value->>'exerciseInstanceId'
      ) AS evidence
    FROM public.training_sessions prior_session
    JOIN public.training_session_prescriptions prior_prescription
      ON prior_prescription.session_id = prior_session.id
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
      prior_prescription.prescription_json->'exercises'
    ) prior_exercise(value)
    WHERE prior_session.assignment_id = v_session.assignment_id
      AND prior_session.subject_id = v_session.subject_id
      AND prior_session.session_kind = 'strength'
      AND prior_session.state IN ('completed', 'completed_with_omissions', 'aborted')
      AND prior_prescription.started_at < v_started_at
      AND prior_exercise.value#>>'{progression,progressionSeriesId}' = v_series_id
    ORDER BY prior_session.completed_at DESC, prior_prescription.started_at DESC, prior_session.id DESC
    LIMIT 64
  ) candidate;

  RETURN pg_catalog.jsonb_build_object(
    'current', v_current,
    'history', v_history
  );
END;
$$;

REVOKE ALL ON FUNCTION public.read_training_previous_performance_sources(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_training_previous_performance_sources(text, text)
  TO authenticated;

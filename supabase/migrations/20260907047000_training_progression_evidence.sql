-- Persist authored progression identity for new strength-session prescriptions.
-- Existing prescriptions are deliberately not backfilled: missing authored
-- comparator data must remain unavailable rather than being reconstructed.

ALTER TABLE public.training_sessions
  ADD COLUMN completed_at timestamptz;

CREATE OR REPLACE FUNCTION private.capture_training_session_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
    RAISE EXCEPTION 'training session completion timestamp is immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD.completed_at IS NULL THEN
    IF OLD.state NOT IN ('completed', 'completed_with_omissions', 'aborted')
      AND NEW.state IN ('completed', 'completed_with_omissions', 'aborted') THEN
      NEW.completed_at := pg_catalog.clock_timestamp();
    ELSIF NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'training session completion timestamp is server managed' USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER training_session_completion_timestamp
  BEFORE UPDATE OF state, completed_at ON public.training_sessions
  FOR EACH ROW EXECUTE FUNCTION private.capture_training_session_completion();

CREATE TABLE public.training_session_progression_metadata (
  session_id text NOT NULL,
  subject_id uuid NOT NULL,
  exercise_instance_id text NOT NULL CHECK (private.is_stable_training_reference(exercise_instance_id, 128)),
  progression_series_id text NOT NULL CHECK (private.is_stable_training_reference(progression_series_id, 128)),
  metadata_json jsonb NOT NULL,
  metadata_hash text GENERATED ALWAYS AS (private.training_evidence_sha256(metadata_json)) STORED,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, exercise_instance_id),
  FOREIGN KEY (session_id, subject_id)
    REFERENCES public.training_sessions(id, subject_id) ON DELETE RESTRICT,
  CHECK ((metadata_json->>'schemaVersion' = 'strength-session-progression-metadata.v1') IS TRUE),
  CHECK ((metadata_json->>'progressionSeriesId' = progression_series_id) IS TRUE),
  CHECK ((metadata_json->>'prescriptionSourceRevisionId'
    ~ '^training-session-prescription[.]v1:sha256:[a-f0-9]{64}$') IS TRUE),
  CHECK ((metadata_json ? 'startedAt') IS FALSE),
  CHECK ((metadata_json ? 'completedAt') IS FALSE)
);

CREATE INDEX training_progression_metadata_subject_series
  ON public.training_session_progression_metadata(subject_id, progression_series_id, session_id);

CREATE TRIGGER training_session_progression_metadata_immutable
  BEFORE UPDATE OR DELETE ON public.training_session_progression_metadata
  FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();

ALTER TABLE public.training_session_progression_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY training_session_progression_metadata_read
  ON public.training_session_progression_metadata
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.training_sessions session
    WHERE session.id = session_id
      AND private.can_read_training_assignment(session.assignment_id)
  ));

REVOKE ALL ON public.training_session_progression_metadata FROM anon, authenticated, service_role;
GRANT SELECT ON public.training_session_progression_metadata TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.persist_training_session_progression_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_exercise jsonb;
  v_progression jsonb;
  v_series_id text;
  v_source_revision_id text;
BEGIN
  IF NEW.prescription_json->>'schemaVersion' <> 'training-session-prescription.v1' THEN
    RETURN NEW;
  END IF;

  v_source_revision_id := 'training-session-prescription.v1:sha256:' || NEW.prescription_hash;
  FOR v_exercise IN
    SELECT value FROM pg_catalog.jsonb_array_elements(NEW.prescription_json->'exercises')
  LOOP
    v_progression := v_exercise->'progression';
    IF v_progression IS NULL THEN
      CONTINUE;
    END IF;
    IF pg_catalog.jsonb_typeof(v_progression) <> 'object'
      OR NOT (v_progression ?& ARRAY[
        'progressionSeriesId', 'side', 'rom', 'tempo', 'exposureType', 'loadEpoch'
      ])
      OR v_progression - ARRAY[
        'progressionSeriesId', 'side', 'rom', 'tempo', 'exposureType', 'loadEpoch'
      ] <> '{}'::jsonb
      OR NOT private.is_stable_training_reference(v_exercise->>'exerciseInstanceId', 128)
      OR NOT private.is_stable_training_reference(v_progression->>'progressionSeriesId', 128)
      OR (v_progression->>'side' IN ('bilateral', 'left', 'right', 'not_applicable')) IS NOT TRUE
      OR NOT private.is_stable_training_reference(v_progression->>'rom', 128)
      OR NOT private.is_stable_training_reference(v_progression->>'tempo', 128)
      OR NOT private.is_stable_training_reference(v_progression->>'exposureType', 128)
      OR (CASE WHEN pg_catalog.jsonb_typeof(v_progression->'loadEpoch') = 'number' THEN
        (v_progression->>'loadEpoch')::numeric < 0
        OR (v_progression->>'loadEpoch')::numeric
          <> pg_catalog.trunc((v_progression->>'loadEpoch')::numeric)
        OR (v_progression->>'loadEpoch')::numeric > 9007199254740991
      ELSE true END) THEN
      RAISE EXCEPTION 'invalid authored progression metadata' USING ERRCODE = '23514';
    END IF;

    v_series_id := v_progression->>'progressionSeriesId';
    INSERT INTO public.training_session_progression_metadata (
      session_id,
      subject_id,
      exercise_instance_id,
      progression_series_id,
      metadata_json,
      created_at
    ) VALUES (
      NEW.session_id,
      NEW.subject_id,
      v_exercise->>'exerciseInstanceId',
      v_series_id,
      pg_catalog.jsonb_build_object(
        'schemaVersion', 'strength-session-progression-metadata.v1',
        'prescriptionSourceRevisionId', v_source_revision_id,
        'progressionSeriesId', v_series_id,
        'comparator', pg_catalog.jsonb_build_object(
          'side', v_progression->>'side',
          'rom', v_progression->>'rom',
          'tempo', v_progression->>'tempo',
          'exposureType', v_progression->>'exposureType',
          'loadEpoch', v_progression->'loadEpoch'
        )
      ),
      NEW.started_at
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER training_session_progression_metadata_on_start
  AFTER INSERT ON public.training_session_prescriptions
  FOR EACH ROW EXECUTE FUNCTION private.persist_training_session_progression_metadata();

CREATE OR REPLACE FUNCTION public.read_training_strength_evidence_projection(
  p_session_id text,
  p_exercise_instance_id text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'session', pg_catalog.jsonb_build_object(
      'sessionId', session.id,
      'revision', session.revision,
      'state', session.state,
      'stoppedForSymptoms', session.stopped_for_symptoms
    ),
    'executionContext', COALESCE(
      prescription.prescription_json->'executionContext',
      program.program_json->'executionContext'
    ),
    'prescription', prescription.prescription_json,
    'exerciseInstanceId', p_exercise_instance_id,
    'currentEvents', COALESCE((
      SELECT pg_catalog.jsonb_agg(actual.event_json ORDER BY actual.set_id)
      FROM public.training_current_set_actuals actual
      WHERE actual.session_id = session.id
    ), '[]'::jsonb),
    'metadata', CASE WHEN metadata.metadata_json IS NULL THEN NULL ELSE
      metadata.metadata_json || pg_catalog.jsonb_build_object(
        'startedAt', pg_catalog.to_char(
          prescription.started_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ),
        'completedAt', CASE WHEN session.completed_at IS NULL THEN NULL ELSE pg_catalog.to_char(
          session.completed_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) END
      )
    END
  )
  FROM public.training_sessions session
  JOIN public.training_program_assignments assignment
    ON assignment.id = session.assignment_id
  JOIN public.training_program_revisions program
    ON program.assignment_id = assignment.id
    AND program.revision_number = assignment.active_revision
  LEFT JOIN public.training_session_prescriptions prescription
    ON prescription.session_id = session.id
  LEFT JOIN public.training_session_progression_metadata metadata
    ON metadata.session_id = session.id
    AND metadata.exercise_instance_id = p_exercise_instance_id
  WHERE session.id = p_session_id
    AND session.session_kind = 'strength'
    AND private.is_stable_training_reference(p_exercise_instance_id, 128)
    AND private.can_read_training_assignment(session.assignment_id);
$$;

REVOKE ALL ON FUNCTION private.capture_training_session_completion(),
  private.persist_training_session_progression_metadata()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_training_strength_evidence_projection(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_training_strength_evidence_projection(text, text)
  TO authenticated;
-- The invoker reader validates caller input without elevating its RLS authority.
GRANT EXECUTE ON FUNCTION private.is_stable_training_reference(text, integer)
  TO authenticated;

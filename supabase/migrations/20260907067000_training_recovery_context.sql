-- Immutable, source-bound recovery reports for strength progression. These
-- records preserve subjective context and explicit user choices; they never
-- derive a dose, diagnosis, clearance, or autonomous decrement.

CREATE OR REPLACE FUNCTION private.is_valid_training_recovery_context(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_report jsonb;
BEGIN
  IF p_value IS NULL
    OR pg_catalog.jsonb_typeof(p_value) <> 'object'
    OR NOT (private.jsonb_has_exact_keys(p_value, ARRAY['report'])
      OR private.jsonb_has_exact_keys(p_value, ARRAY['report','choice']))
  THEN
    RETURN false;
  END IF;

  v_report := p_value->'report';
  RETURN private.jsonb_has_exact_keys(v_report, ARRAY[
      'schemaVersion','capturedAt','sleep','fatigue','schedule','illness'
    ])
    AND v_report->>'schemaVersion' = 'recovery-context.v1'
    AND private.is_iso_datetime(v_report->>'capturedAt')
    AND v_report->>'sleep' IN ('unknown','no_concern_reported','concern_reported')
    AND v_report->>'fatigue' IN ('unknown','no_concern_reported','concern_reported')
    AND v_report->>'schedule' IN ('unknown','no_concern_reported','concern_reported')
    AND v_report->>'illness' IN ('unknown','no_concern_reported','concern_reported')
    AND (NOT (p_value ? 'choice')
      OR (pg_catalog.jsonb_typeof(p_value->'choice') = 'string'
        AND p_value->>'choice' IN ('hold','request_review','new_familiarization')));
END;
$$;

CREATE TABLE public.training_recovery_context_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  subject_id uuid NOT NULL REFERENCES public.training_subjects(id) ON DELETE CASCADE,
  assignment_id text NOT NULL,
  source_program_revision_number bigint NOT NULL CHECK (source_program_revision_number > 0),
  source_program_hash text NOT NULL CHECK (source_program_hash ~ '^[a-f0-9]{64}$'),
  source_session_id text NOT NULL,
  source_session_revision bigint NOT NULL CHECK (source_session_revision > 0),
  exercise_instance_id text NOT NULL
    CHECK (private.is_stable_training_reference(exercise_instance_id, 128)),
  progression_series_id text NOT NULL
    CHECK (private.is_stable_training_reference(progression_series_id, 128)),
  execution_context jsonb NOT NULL,
  context_json jsonb NOT NULL CHECK (private.is_valid_training_recovery_context(context_json) IS TRUE),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (actor_user_id, request_id),
  FOREIGN KEY (assignment_id, subject_id)
    REFERENCES public.training_program_assignments(id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id, source_program_revision_number)
    REFERENCES public.training_program_revisions(assignment_id, revision_number) ON DELETE RESTRICT,
  FOREIGN KEY (source_session_id, subject_id)
    REFERENCES public.training_sessions(id, subject_id) ON DELETE CASCADE,
  CHECK (((execution_context = '{"kind":"live"}'::jsonb)
    OR (private.jsonb_has_exact_keys(execution_context, ARRAY[
      'kind','simulationRunId','fixtureId','fixtureHash','label'
    ])
      AND execution_context->>'kind' = 'synthetic_simulation'
      AND (execution_context->>'simulationRunId')::uuid IS NOT NULL
      AND private.is_stable_training_reference(execution_context->>'fixtureId', 128)
      AND execution_context->>'fixtureHash' ~ '^[a-f0-9]{64}$'
      AND execution_context->>'label' IN ('Practice data','Simulation'))) IS TRUE)
);

CREATE INDEX training_recovery_context_scope_latest
  ON public.training_recovery_context_records(
    assignment_id, progression_series_id, record_sequence DESC
  );

CREATE TRIGGER training_recovery_context_records_immutable
  BEFORE UPDATE OR DELETE ON public.training_recovery_context_records
  FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();

ALTER TABLE public.training_recovery_context_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY training_recovery_context_records_read
  ON public.training_recovery_context_records FOR SELECT TO authenticated
  USING (private.can_read_training_assignment(assignment_id));

REVOKE ALL ON public.training_recovery_context_records FROM anon, authenticated, service_role;
GRANT SELECT ON public.training_recovery_context_records TO authenticated, service_role;

ALTER TABLE public.training_progression_proposals
  ADD COLUMN recovery_context_record_id uuid
    REFERENCES public.training_recovery_context_records(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION private.training_recovery_context_projection(
  p_record public.training_recovery_context_records
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'schemaVersion','training-recovery-context-record.v1',
    'recordId',p_record.id,
    'subjectId',p_record.subject_id,
    'assignmentId',p_record.assignment_id,
    'sourceProgramRevisionNumber',p_record.source_program_revision_number,
    'sourceProgramHash',p_record.source_program_hash,
    'sourceSessionId',p_record.source_session_id,
    'sourceSessionRevision',p_record.source_session_revision,
    'exerciseInstanceId',p_record.exercise_instance_id,
    'progressionSeriesId',p_record.progression_series_id,
    'executionContext',p_record.execution_context,
    'context',p_record.context_json,
    'recordedAt',pg_catalog.to_char(
      p_record.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    )
  );
$$;

CREATE OR REPLACE FUNCTION private.lock_training_recovery_context_scope(
  p_assignment_id text,
  p_program_revision bigint,
  p_progression_series_id text
)
RETURNS void
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
  SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_assignment_id || ':' || p_program_revision::text || ':' || p_progression_series_id, 0
  ));
$$;

CREATE OR REPLACE FUNCTION public.read_training_recovery_context(
  p_session_id text,
  p_exercise_instance_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.training_sessions%ROWTYPE;
  v_assignment public.training_program_assignments%ROWTYPE;
  v_program public.training_program_revisions%ROWTYPE;
  v_metadata public.training_session_progression_metadata%ROWTYPE;
  v_record public.training_recovery_context_records%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2'
    OR NOT private.is_stable_training_reference(p_session_id, 128)
    OR NOT private.is_stable_training_reference(p_exercise_instance_id, 128)
  THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_session FROM public.training_sessions
  WHERE id = p_session_id AND session_kind = 'strength';
  IF NOT FOUND OR NOT private.can_read_training_assignment(v_session.assignment_id) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_assignment FROM public.training_program_assignments
  WHERE id = v_session.assignment_id;
  SELECT * INTO v_program FROM public.training_program_revisions
  WHERE assignment_id = v_assignment.id AND revision_number = v_assignment.active_revision;
  SELECT * INTO v_metadata FROM public.training_session_progression_metadata
  WHERE session_id = p_session_id AND exercise_instance_id = p_exercise_instance_id;
  IF v_program.assignment_id IS NULL OR v_metadata.session_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_record
  FROM public.training_recovery_context_records record
  JOIN public.training_program_revisions source_program
    ON source_program.assignment_id = record.assignment_id
    AND source_program.revision_number = record.source_program_revision_number
    AND source_program.program_hash = record.source_program_hash
  WHERE record.assignment_id = v_assignment.id
    AND record.subject_id = v_assignment.subject_id
    AND record.source_program_revision_number <= v_assignment.active_revision
    AND record.progression_series_id = v_metadata.progression_series_id
    AND record.execution_context = v_program.program_json->'executionContext'
  ORDER BY record.record_sequence DESC
  LIMIT 1;

  RETURN CASE WHEN v_record.id IS NULL THEN NULL
    ELSE private.training_recovery_context_projection(v_record) END;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_training_recovery_context(
  p_session_id text,
  p_exercise_instance_id text,
  p_request_id uuid,
  p_context_json jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_session public.training_sessions%ROWTYPE;
  v_assignment public.training_program_assignments%ROWTYPE;
  v_subject public.training_subjects%ROWTYPE;
  v_program public.training_program_revisions%ROWTYPE;
  v_metadata public.training_session_progression_metadata%ROWTYPE;
  v_prescription jsonb;
  v_existing public.training_recovery_context_records%ROWTYPE;
  v_record public.training_recovery_context_records%ROWTYPE;
  v_request_hash text;
BEGIN
  IF v_actor IS NULL OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 recovery context write required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL
    OR NOT private.is_stable_training_reference(p_session_id, 128)
    OR NOT private.is_stable_training_reference(p_exercise_instance_id, 128)
    OR private.is_valid_training_recovery_context(p_context_json) IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'invalid training recovery context' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_session FROM public.training_sessions
  WHERE id = p_session_id AND session_kind = 'strength' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'training recovery source is unavailable' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_assignment FROM public.training_program_assignments
  WHERE id = v_session.assignment_id FOR UPDATE;
  SELECT * INTO v_subject FROM public.training_subjects
  WHERE id = v_session.subject_id FOR UPDATE;
  IF v_assignment.id IS NULL OR v_subject.id IS NULL
    OR v_assignment.status <> 'active'
    OR v_subject.status <> 'active' OR v_subject.deleted_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'training recovery source is unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF private.is_training_subject_owner(v_session.subject_id) THEN
    NULL;
  ELSIF v_assignment.program_mode <> 'coach_assigned'
    OR v_assignment.owning_practitioner_id IS DISTINCT FROM v_actor
    OR NOT private.is_training_subject_coach(v_session.subject_id, 'program:coach_publish')
    OR (v_assignment.simulation_run_id IS NOT NULL
      AND NOT private.has_training_simulation_control(v_assignment.simulation_run_id))
  THEN
    RAISE EXCEPTION 'training recovery context is not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_assignment.simulation_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.training_simulation_runs run
    WHERE run.id = v_assignment.simulation_run_id
      AND run.subject_id = v_session.subject_id
      AND run.status = 'active' AND run.expires_at > pg_catalog.clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'training recovery source is unavailable' USING ERRCODE = 'P0001';
  END IF;

  v_request_hash := private.training_evidence_sha256(pg_catalog.jsonb_build_object(
    'operation','record_training_recovery_context',
    'sessionId',p_session_id,
    'exerciseInstanceId',p_exercise_instance_id,
    'context',p_context_json
  ));
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor::text || ':' || p_request_id::text, 0)
  );
  SELECT * INTO v_existing FROM public.training_recovery_context_records
  WHERE actor_user_id = v_actor AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'recovery request ID reused with different content' USING ERRCODE = 'PT409';
    END IF;
    RETURN private.training_recovery_context_projection(v_existing);
  END IF;

  SELECT * INTO v_program FROM public.training_program_revisions
  WHERE assignment_id = v_assignment.id AND revision_number = v_assignment.active_revision;
  SELECT * INTO v_metadata FROM public.training_session_progression_metadata
  WHERE session_id = p_session_id AND exercise_instance_id = p_exercise_instance_id;
  SELECT prescription_json INTO v_prescription FROM public.training_session_prescriptions
  WHERE session_id = p_session_id;
  IF v_program.assignment_id IS NULL OR v_metadata.session_id IS NULL OR v_prescription IS NULL
    OR v_prescription->'executionContext' IS DISTINCT FROM v_program.program_json->'executionContext'
  THEN
    RAISE EXCEPTION 'training recovery source changed' USING ERRCODE = '40001';
  END IF;

  PERFORM private.lock_training_recovery_context_scope(
    v_assignment.id, v_assignment.active_revision, v_metadata.progression_series_id
  );
  INSERT INTO public.training_recovery_context_records(
    actor_user_id,request_id,request_hash,subject_id,assignment_id,
    source_program_revision_number,source_program_hash,
    source_session_id,source_session_revision,exercise_instance_id,
    progression_series_id,execution_context,context_json
  ) VALUES (
    v_actor,p_request_id,v_request_hash,v_session.subject_id,v_assignment.id,
    v_assignment.active_revision,v_program.program_hash,
    v_session.id,v_session.revision,p_exercise_instance_id,
    v_metadata.progression_series_id,v_program.program_json->'executionContext',p_context_json
  ) RETURNING * INTO v_record;

  RETURN private.training_recovery_context_projection(v_record);
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_training_progression_recovery_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_proposal public.training_progression_proposals%ROWTYPE;
  v_latest public.training_recovery_context_records%ROWTYPE;
BEGIN
  SELECT * INTO v_proposal FROM public.training_progression_proposals
  WHERE id = NEW.proposal_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  PERFORM private.lock_training_recovery_context_scope(
    v_proposal.assignment_id,
    v_proposal.base_program_revision_number,
    v_proposal.progression_series_id
  );
  SELECT * INTO v_latest
  FROM public.training_recovery_context_records record
  JOIN public.training_program_revisions source_program
    ON source_program.assignment_id = record.assignment_id
    AND source_program.revision_number = record.source_program_revision_number
    AND source_program.program_hash = record.source_program_hash
  WHERE record.assignment_id = v_proposal.assignment_id
    AND record.subject_id = v_proposal.subject_id
    AND record.source_program_revision_number <= v_proposal.base_program_revision_number
    AND record.progression_series_id = v_proposal.progression_series_id
    AND record.execution_context = v_proposal.execution_context
  ORDER BY record.record_sequence DESC
  LIMIT 1;

  IF v_latest.id IS NOT NULL
    AND v_proposal.recovery_context_record_id IS DISTINCT FROM v_latest.id
  THEN
    RAISE EXCEPTION 'progression recovery context changed' USING ERRCODE = 'PT409';
  END IF;
  IF v_latest.id IS NULL AND v_proposal.recovery_context_record_id IS NOT NULL THEN
    RAISE EXCEPTION 'progression recovery context binding is invalid' USING ERRCODE = 'PT409';
  END IF;
  IF v_latest.id IS NOT NULL AND v_latest.context_json ? 'choice' THEN
    RAISE EXCEPTION 'progression recovery choice requires review' USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER training_progression_acceptance_recovery_context
  BEFORE INSERT ON public.training_progression_acceptances
  FOR EACH ROW EXECUTE FUNCTION private.enforce_training_progression_recovery_context();

REVOKE ALL ON FUNCTION private.is_valid_training_recovery_context(jsonb),
  private.training_recovery_context_projection(public.training_recovery_context_records),
  private.lock_training_recovery_context_scope(text,bigint,text),
  private.enforce_training_progression_recovery_context()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_training_recovery_context(text,text),
  public.record_training_recovery_context(text,text,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_training_recovery_context(text,text),
  public.record_training_recovery_context(text,text,uuid,jsonb)
  TO authenticated;

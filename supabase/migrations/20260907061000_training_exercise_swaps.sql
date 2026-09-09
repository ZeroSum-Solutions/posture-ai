-- Future-only exercise swaps. The server may stage immutable proposals from an
-- exact catalog, but only an authenticated AAL2 owner or the assignment's
-- current publishing coach can accept one. Started prescriptions stay frozen.

CREATE OR REPLACE FUNCTION private.training_exercise_swap_targets_match(
  p_proposal jsonb,
  p_bindings jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(p_proposal->'affectedFutureSessions') IS DISTINCT FROM 'array'
      OR pg_catalog.jsonb_typeof(p_bindings) IS DISTINCT FROM 'array' THEN false
    ELSE pg_catalog.jsonb_array_length(p_proposal->'affectedFutureSessions')
      = pg_catalog.jsonb_array_length(p_bindings)
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements(p_proposal->'affectedFutureSessions')
          WITH ORDINALITY proposed(value, ordinal)
        FULL JOIN pg_catalog.jsonb_array_elements(p_bindings)
          WITH ORDINALITY bound(value, ordinal) USING (ordinal)
        WHERE proposed.value IS NULL OR bound.value IS NULL
          OR pg_catalog.jsonb_typeof(proposed.value) IS DISTINCT FROM 'object'
          OR pg_catalog.jsonb_typeof(bound.value) IS DISTINCT FROM 'object'
          OR pg_catalog.jsonb_typeof(proposed.value->'sessionId') IS DISTINCT FROM 'string'
          OR pg_catalog.jsonb_typeof(bound.value->'sessionId') IS DISTINCT FROM 'string'
          OR pg_catalog.jsonb_typeof(proposed.value->'exerciseInstanceId') IS DISTINCT FROM 'string'
          OR pg_catalog.jsonb_typeof(bound.value->'exerciseInstanceId') IS DISTINCT FROM 'string'
          OR pg_catalog.jsonb_typeof(proposed.value->'scheduledLocalDate') IS DISTINCT FROM 'string'
          OR pg_catalog.jsonb_typeof(bound.value->'scheduledLocalDate') IS DISTINCT FROM 'string'
          OR (proposed.value->>'scheduledLocalDate') !~ '^\d{4}-\d{2}-\d{2}$'
          OR (bound.value->>'scheduledLocalDate') !~ '^\d{4}-\d{2}-\d{2}$'
          OR proposed.value->>'sessionId' IS DISTINCT FROM bound.value->>'sessionId'
          OR proposed.value->>'exerciseInstanceId' IS DISTINCT FROM bound.value->>'exerciseInstanceId'
          OR proposed.value->>'scheduledLocalDate' IS DISTINCT FROM bound.value->>'scheduledLocalDate'
      )
  END;
$$;

REVOKE ALL ON FUNCTION private.training_exercise_swap_targets_match(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.training_exercise_swap_targets_match(jsonb, jsonb) TO service_role;

CREATE TABLE public.training_exercise_swap_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_key text NOT NULL UNIQUE CHECK (proposal_key ~ '^[a-f0-9]{64}$'),
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL REFERENCES public.training_subjects(id) ON DELETE RESTRICT,
  assignment_id text NOT NULL,
  base_program_revision_number bigint NOT NULL CHECK (base_program_revision_number > 0),
  base_assignment_revision bigint NOT NULL CHECK (base_assignment_revision > 0),
  source_exercise_version_id text NOT NULL
    CHECK (private.is_stable_training_reference(source_exercise_version_id, 128)),
  replacement_exercise_version_id text NOT NULL
    CHECK (private.is_stable_training_reference(replacement_exercise_version_id, 128)),
  catalog_version text NOT NULL CHECK (private.is_stable_training_reference(catalog_version, 128)),
  catalog_origin jsonb NOT NULL,
  source_program_hash text NOT NULL CHECK (source_program_hash ~ '^[a-f0-9]{64}$'),
  source_profile_revision bigint NOT NULL CHECK (source_profile_revision > 0),
  source_eligibility_revision_id text NOT NULL
    CHECK (private.is_stable_training_reference(source_eligibility_revision_id, 160)),
  execution_context jsonb NOT NULL,
  load_options jsonb NOT NULL,
  target_bindings jsonb NOT NULL,
  replacement_defaults jsonb NOT NULL,
  proposal_json jsonb NOT NULL,
  proposal_hash text GENERATED ALWAYS AS (private.training_evidence_sha256(proposal_json)) STORED,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (assignment_id, subject_id)
    REFERENCES public.training_program_assignments(id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id, base_program_revision_number)
    REFERENCES public.training_program_revisions(assignment_id, revision_number) ON DELETE RESTRICT,
  FOREIGN KEY (subject_id, source_profile_revision)
    REFERENCES public.training_profile_revisions(subject_id, revision) ON DELETE RESTRICT,
  CHECK (source_exercise_version_id <> replacement_exercise_version_id),
  CHECK (expires_at > created_at),
  CHECK ((execution_context->>'kind' IN ('live', 'synthetic_simulation')) IS TRUE),
  CHECK ((pg_catalog.jsonb_typeof(load_options) = 'array'
    AND pg_catalog.jsonb_array_length(load_options) BETWEEN 1 AND 64) IS TRUE),
  CHECK ((pg_catalog.jsonb_typeof(target_bindings) = 'array'
    AND pg_catalog.jsonb_array_length(target_bindings) BETWEEN 1 AND 64) IS TRUE),
  CHECK ((proposal_json->>'schemaVersion' = 'training-exercise-swap-proposal.v1') IS TRUE),
  CHECK ((proposal_json->>'proposalId' = id::text) IS TRUE),
  CHECK ((proposal_json->>'assignmentId' = assignment_id) IS TRUE),
  CHECK ((proposal_json->>'baseProgramRevisionNumber' = base_program_revision_number::text) IS TRUE),
  CHECK ((proposal_json#>>'{sourceExercise,exerciseVersionId}' = source_exercise_version_id) IS TRUE),
  CHECK ((proposal_json#>>'{replacementExercise,exerciseVersionId}' = replacement_exercise_version_id) IS TRUE),
  CHECK ((proposal_json#>>'{replacementExercise,recalibrationRequired}' = 'true') IS TRUE),
  CHECK ((proposal_json->>'catalogVersion' = catalog_version) IS TRUE),
  CHECK ((proposal_json->'catalogOrigin' = catalog_origin) IS TRUE),
  CHECK ((proposal_json->'loadOptions' = load_options) IS TRUE),
  CHECK (private.training_exercise_swap_targets_match(proposal_json, target_bindings)),
  CHECK ((pg_catalog.jsonb_typeof(replacement_defaults->'progressionDefaults') = 'object') IS TRUE),
  CONSTRAINT training_exercise_swap_proposals_warmup_defaults_valid CHECK ((
    NOT (replacement_defaults ? 'warmupSets')
    OR replacement_defaults->'warmupSets' = 'null'::jsonb
    OR (
      pg_catalog.jsonb_typeof(replacement_defaults->'warmupSets') = 'array'
      AND pg_catalog.jsonb_array_length(replacement_defaults->'warmupSets') BETWEEN 1 AND 5
    )
  ) IS TRUE)
);

CREATE TABLE public.training_exercise_swap_acceptances (
  proposal_id uuid PRIMARY KEY
    REFERENCES public.training_exercise_swap_proposals(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  selected_load_option_index integer NOT NULL CHECK (selected_load_option_index BETWEEN 0 AND 63),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  assignment_id text NOT NULL,
  result_program_revision_number bigint NOT NULL CHECK (result_program_revision_number > 1),
  result_json jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (actor_user_id, request_id),
  FOREIGN KEY (assignment_id, result_program_revision_number)
    REFERENCES public.training_program_revisions(assignment_id, revision_number) ON DELETE RESTRICT,
  CHECK ((result_json->>'schemaVersion' = 'training-exercise-swap-acceptance.v1') IS TRUE),
  CHECK ((result_json->>'proposalId' = proposal_id::text) IS TRUE),
  CHECK ((result_json->>'assignmentId' = assignment_id) IS TRUE),
  CHECK ((result_json->>'programRevisionNumber' = result_program_revision_number::text) IS TRUE),
  CHECK ((result_json#>>'{selectedLoad,optionIndex}' = selected_load_option_index::text) IS TRUE)
);

CREATE INDEX training_exercise_swap_proposals_assignment_created
  ON public.training_exercise_swap_proposals(assignment_id, created_at DESC);

CREATE TRIGGER training_exercise_swap_proposals_immutable
  BEFORE UPDATE OR DELETE ON public.training_exercise_swap_proposals
  FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();
CREATE TRIGGER training_exercise_swap_acceptances_immutable
  BEFORE UPDATE OR DELETE ON public.training_exercise_swap_acceptances
  FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();

ALTER TABLE public.training_exercise_swap_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_exercise_swap_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY training_exercise_swap_proposals_read
  ON public.training_exercise_swap_proposals FOR SELECT TO authenticated
  USING (private.can_read_training_assignment(assignment_id));
CREATE POLICY training_exercise_swap_acceptances_read
  ON public.training_exercise_swap_acceptances FOR SELECT TO authenticated
  USING (private.can_read_training_assignment(assignment_id));

REVOKE ALL ON public.training_exercise_swap_proposals,
  public.training_exercise_swap_acceptances FROM anon, authenticated, service_role;
GRANT SELECT ON public.training_exercise_swap_proposals,
  public.training_exercise_swap_acceptances TO authenticated, service_role;
GRANT INSERT ON public.training_exercise_swap_proposals TO service_role;

CREATE OR REPLACE FUNCTION private.can_mutate_training_exercise_swap(p_assignment_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_assignment public.training_program_assignments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN RETURN false; END IF;
  SELECT * INTO v_assignment FROM public.training_program_assignments WHERE id = p_assignment_id;
  IF NOT FOUND OR v_assignment.status <> 'active' THEN RETURN false; END IF;
  IF v_assignment.program_mode = 'self_directed' THEN
    RETURN private.is_training_subject_owner(v_assignment.subject_id);
  END IF;
  RETURN v_assignment.owning_practitioner_id = auth.uid()
    AND private.is_training_subject_coach(v_assignment.subject_id, 'program:coach_publish')
    AND (v_assignment.simulation_run_id IS NULL
      OR private.has_training_simulation_control(v_assignment.simulation_run_id));
END;
$$;

REVOKE ALL ON FUNCTION private.can_mutate_training_exercise_swap(text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION public.read_training_exercise_swap_candidate(
  p_session_id text,
  p_exercise_instance_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.training_sessions%ROWTYPE;
  v_assignment public.training_program_assignments%ROWTYPE;
  v_program public.training_program_revisions%ROWTYPE;
  v_subject public.training_subjects%ROWTYPE;
  v_source jsonb;
  v_started jsonb;
  v_profile jsonb;
  v_targets jsonb;
BEGIN
  IF NOT private.is_stable_training_reference(p_session_id, 128)
    OR NOT private.is_stable_training_reference(p_exercise_instance_id, 128) THEN RETURN NULL; END IF;

  SELECT * INTO v_session FROM public.training_sessions
    WHERE id = p_session_id AND session_kind = 'strength';
  IF NOT FOUND OR NOT private.can_mutate_training_exercise_swap(v_session.assignment_id) THEN RETURN NULL; END IF;
  SELECT * INTO STRICT v_assignment FROM public.training_program_assignments WHERE id = v_session.assignment_id;
  SELECT * INTO STRICT v_program FROM public.training_program_revisions
    WHERE assignment_id = v_assignment.id AND revision_number = v_assignment.active_revision;
  SELECT * INTO STRICT v_subject FROM public.training_subjects WHERE id = v_session.subject_id;
  IF v_subject.current_profile_revision IS NULL
    OR v_program.program_json->>'profileRevisionId' IS DISTINCT FROM v_subject.current_profile_revision::text THEN
    RETURN NULL;
  END IF;
  PERFORM private.assert_training_program_eligibility(
    v_session.subject_id, v_program.program_json, v_assignment.simulation_run_id
  );
  SELECT profile_json INTO v_profile FROM public.training_profile_revisions
    WHERE subject_id = v_session.subject_id AND revision = v_subject.current_profile_revision;
  IF v_profile IS NULL THEN RETURN NULL; END IF;

  SELECT prescription_json INTO v_started FROM public.training_session_prescriptions WHERE session_id = p_session_id;
  IF v_started IS NOT NULL THEN
    SELECT value INTO v_source FROM pg_catalog.jsonb_array_elements(v_started->'exercises')
      WHERE value->>'exerciseInstanceId' = p_exercise_instance_id;
  ELSE
    SELECT exercise.value INTO v_source
    FROM pg_catalog.jsonb_array_elements(v_program.program_json->'sessions') program_session(value)
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(program_session.value->'exercises') exercise(value)
    WHERE program_session.value->>'sessionId' = p_session_id
      AND exercise.value->>'exerciseInstanceId' = p_exercise_instance_id;
  END IF;
  IF v_source IS NULL OR v_source#>>'{progression,progressionSeriesId}' IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'sessionId', target_session.id,
    'sessionRevision', target_session.revision,
    'scheduledLocalDate', target_session.scheduled_local_date::text,
    'exerciseInstanceId', exercise.value->>'exerciseInstanceId',
    'sourceExercise', exercise.value
  ) ORDER BY target_session.scheduled_local_date, target_session.id, exercise.ordinality), '[]'::jsonb)
  INTO v_targets
  FROM pg_catalog.jsonb_array_elements(v_program.program_json->'sessions') program_session(value)
  JOIN public.training_sessions target_session
    ON target_session.id = program_session.value->>'sessionId'
    AND target_session.assignment_id = v_assignment.id
    AND target_session.subject_id = v_session.subject_id
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(program_session.value->'exercises')
    WITH ORDINALITY exercise(value, ordinality)
  WHERE target_session.session_kind = 'strength'
    AND target_session.state = 'scheduled'
    AND target_session.scheduled_local_date >= v_session.scheduled_local_date
    AND NOT EXISTS (
      SELECT 1 FROM public.training_session_prescriptions prescription
      WHERE prescription.session_id = target_session.id
    )
    AND exercise.value#>>'{progression,progressionSeriesId}' = v_source#>>'{progression,progressionSeriesId}'
    AND exercise.value->>'exerciseVersionId' = v_source->>'exerciseVersionId';

  IF pg_catalog.jsonb_array_length(v_targets) = 0 THEN
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 'training-exercise-swap-candidate.v1', 'status', 'no_future_target'
    );
  END IF;
  IF pg_catalog.jsonb_array_length(v_targets) > 64 THEN RETURN NULL; END IF;
  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 'training-exercise-swap-candidate.v1', 'status', 'ready',
    'assignmentId', v_assignment.id, 'assignmentRevision', v_assignment.revision,
    'baseProgramRevisionNumber', v_assignment.active_revision,
    'subjectId', v_session.subject_id, 'programHash', v_program.program_hash,
    'program', v_program.program_json, 'profile', v_profile,
    'currentProfileRevision', v_subject.current_profile_revision,
    'sourceExerciseVersionId', v_source->>'exerciseVersionId',
    'sourceExerciseInstanceId', p_exercise_instance_id, 'targets', v_targets
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.apply_training_exercise_swap(
  p_program jsonb,
  p_proposal_id uuid,
  p_actor_user_id uuid,
  p_accepted_at timestamptz,
  p_replacement_exercise_version_id text,
  p_selected_load jsonb,
  p_targets jsonb,
  p_replacement_defaults jsonb,
  p_author_kind text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_sessions jsonb;
BEGIN
  SELECT pg_catalog.jsonb_agg(
    program_session.value || pg_catalog.jsonb_build_object('exercises', (
      SELECT pg_catalog.jsonb_agg(
        CASE WHEN EXISTS (
          SELECT 1 FROM pg_catalog.jsonb_array_elements(p_targets) target(value)
          WHERE target.value->>'sessionId' = program_session.value->>'sessionId'
            AND target.value->>'exerciseInstanceId' = exercise.value->>'exerciseInstanceId'
            AND target.value->'sourceExercise' = exercise.value
        ) THEN
          (exercise.value - 'warmupSets')
          || pg_catalog.jsonb_build_object('exerciseVersionId', p_replacement_exercise_version_id)
          || pg_catalog.jsonb_build_object('progression',
            exercise.value->'progression' || (p_replacement_defaults->'progressionDefaults')
            || pg_catalog.jsonb_build_object(
              'progressionSeriesId', exercise.value#>>'{progression,progressionSeriesId}',
              'exposureType', exercise.value#>>'{progression,exposureType}',
              'loadEpoch', (exercise.value#>>'{progression,loadEpoch}')::bigint + 1
            )
          )
          || pg_catalog.jsonb_build_object('acceptedInitialLoad',
            exercise.value->'acceptedInitialLoad' || pg_catalog.jsonb_build_object(
              'acceptanceId', 'swap:' || p_proposal_id::text,
              'acceptedAt', pg_catalog.to_char(p_accepted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
              'acceptedByUserId', p_actor_user_id::text,
              'exerciseVersionId', p_replacement_exercise_version_id,
              'equipmentId', p_selected_load->>'equipmentId',
              'loadBasis', p_selected_load->>'loadBasis',
              'implementCount', p_selected_load->'implementCount',
              'holdingConfiguration', p_selected_load->>'holdingConfiguration',
              'quantity', p_selected_load->'quantity'
            )
          )
          || CASE WHEN pg_catalog.jsonb_typeof(p_replacement_defaults->'warmupSets')
              IS DISTINCT FROM 'array' THEN '{}'::jsonb
            ELSE pg_catalog.jsonb_build_object('warmupSets', (
              SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'setId', 'swap:' || p_proposal_id::text || ':'
                  || pg_catalog.md5(
                    (program_session.value->>'sessionId') || ':' || (exercise.value->>'exerciseInstanceId')
                  ) || ':warmup:' || warmup.ordinality,
                'targetReps', warmup.value->'targetReps',
                'prescribedLoad', warmup.value->'prescribedLoad'
              ) ORDER BY warmup.ordinality)
              FROM pg_catalog.jsonb_array_elements(p_replacement_defaults->'warmupSets')
                WITH ORDINALITY warmup(value, ordinality)
            )) END
        ELSE exercise.value END
        ORDER BY exercise.ordinality
      ) FROM pg_catalog.jsonb_array_elements(program_session.value->'exercises')
        WITH ORDINALITY exercise(value, ordinality)
    )) ORDER BY program_session.ordinality
  ) INTO v_sessions
  FROM pg_catalog.jsonb_array_elements(p_program->'sessions')
    WITH ORDINALITY program_session(value, ordinality);

  RETURN p_program || pg_catalog.jsonb_build_object(
    'revisionNumber', (p_program->>'revisionNumber')::bigint + 1,
    'publishedAt', pg_catalog.to_char(p_accepted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'author', pg_catalog.jsonb_build_object('kind', p_author_kind, 'userId', p_actor_user_id::text),
    'sessions', v_sessions
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_training_exercise_swap_proposal(
  p_proposal_id uuid,
  p_request_id uuid,
  p_selected_load_option_index integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_proposal public.training_exercise_swap_proposals%ROWTYPE;
  v_existing public.training_exercise_swap_acceptances%ROWTYPE;
  v_assignment public.training_program_assignments%ROWTYPE;
  v_program public.training_program_revisions%ROWTYPE;
  v_subject public.training_subjects%ROWTYPE;
  v_target jsonb;
  v_selected jsonb;
  v_next_program jsonb;
  v_next_revision bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_author_kind text;
  v_result jsonb;
  v_request_hash text;
BEGIN
  IF v_actor IS NULL OR p_request_id IS NULL OR p_selected_load_option_index IS NULL
    OR p_selected_load_option_index NOT BETWEEN 0 AND 63
    OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'authenticated AAL2 exercise swap acceptance required' USING ERRCODE = '42501';
  END IF;
  v_request_hash := private.training_evidence_sha256(pg_catalog.jsonb_build_object(
    'proposalId', p_proposal_id, 'requestId', p_request_id,
    'selectedLoadOptionIndex', p_selected_load_option_index
  ));
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor::text || ':' || p_request_id::text, 0)
  );
  SELECT * INTO v_existing FROM public.training_exercise_swap_acceptances
    WHERE actor_user_id = v_actor AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.proposal_id = p_proposal_id
      AND v_existing.selected_load_option_index = p_selected_load_option_index
      AND v_existing.request_hash = v_request_hash THEN RETURN v_existing.result_json; END IF;
    RAISE EXCEPTION 'exercise swap request ID reused with different content' USING ERRCODE = 'PT409';
  END IF;

  SELECT * INTO v_proposal FROM public.training_exercise_swap_proposals
    WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND OR v_proposal.expires_at <= v_now THEN
    RAISE EXCEPTION 'exercise swap proposal is unavailable' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_assignment FROM public.training_program_assignments
    WHERE id = v_proposal.assignment_id;
  IF v_assignment.id IS NULL OR v_assignment.subject_id <> v_proposal.subject_id
    OR NOT private.can_mutate_training_exercise_swap(v_proposal.assignment_id) THEN
    RAISE EXCEPTION 'exercise swap acceptance is not authorized' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.training_exercise_swap_acceptances WHERE proposal_id = p_proposal_id) THEN
    RAISE EXCEPTION 'exercise swap proposal was already accepted' USING ERRCODE = 'PT409';
  END IF;
  SELECT value INTO v_selected FROM pg_catalog.jsonb_array_elements(v_proposal.load_options) value
    WHERE (value->>'optionIndex')::integer = p_selected_load_option_index;
  IF v_selected IS NULL THEN RAISE EXCEPTION 'exercise swap load option is invalid' USING ERRCODE = '22023'; END IF;

  -- Session start and coach revocation both lock sessions before assignment.
  -- Follow the same order here, then repeat authorization after every lock.
  PERFORM target_session.id
  FROM public.training_sessions target_session
  WHERE target_session.id IN (
    SELECT value->>'sessionId'
    FROM pg_catalog.jsonb_array_elements(v_proposal.target_bindings) value
  )
  ORDER BY target_session.id
  FOR UPDATE OF target_session;
  SELECT * INTO v_assignment FROM public.training_program_assignments
    WHERE id = v_proposal.assignment_id FOR UPDATE;
  SELECT * INTO v_subject FROM public.training_subjects
    WHERE id = v_proposal.subject_id FOR UPDATE;
  IF v_assignment.id IS NULL OR v_subject.id IS NULL OR v_assignment.subject_id <> v_proposal.subject_id
    OR NOT private.can_mutate_training_exercise_swap(v_proposal.assignment_id) THEN
    RAISE EXCEPTION 'exercise swap acceptance is not authorized' USING ERRCODE = '42501';
  END IF;

  v_author_kind := CASE WHEN v_assignment.program_mode = 'self_directed' THEN 'athlete' ELSE 'coach' END;
  SELECT * INTO v_program FROM public.training_program_revisions
    WHERE assignment_id = v_assignment.id AND revision_number = v_assignment.active_revision;
  IF v_assignment.active_revision IS DISTINCT FROM v_proposal.base_program_revision_number
    OR v_assignment.revision IS DISTINCT FROM v_proposal.base_assignment_revision
    OR v_program.program_hash IS DISTINCT FROM v_proposal.source_program_hash
    OR v_subject.current_profile_revision IS DISTINCT FROM v_proposal.source_profile_revision
    OR v_program.program_json->'executionContext' IS DISTINCT FROM v_proposal.execution_context THEN
    RAISE EXCEPTION 'exercise swap source changed' USING ERRCODE = 'PT409';
  END IF;
  IF v_assignment.simulation_run_id IS NULL
    AND v_subject.current_eligibility_decision_source_revision_id
      IS DISTINCT FROM v_proposal.source_eligibility_revision_id THEN
    RAISE EXCEPTION 'exercise swap eligibility changed' USING ERRCODE = 'PT409';
  END IF;
  PERFORM private.assert_training_program_eligibility(
    v_proposal.subject_id, v_program.program_json, v_assignment.simulation_run_id
  );

  FOR v_target IN SELECT value FROM pg_catalog.jsonb_array_elements(v_proposal.target_bindings) LOOP
    PERFORM 1 FROM public.training_sessions target_session
      WHERE target_session.id = v_target->>'sessionId'
        AND target_session.assignment_id = v_assignment.id
        AND target_session.subject_id = v_proposal.subject_id
        AND target_session.session_kind = 'strength'
        AND target_session.state = 'scheduled'
        AND target_session.revision = (v_target->>'sessionRevision')::bigint
        AND NOT EXISTS (
          SELECT 1 FROM public.training_session_prescriptions prescription
          WHERE prescription.session_id = target_session.id
        );
    IF NOT FOUND THEN RAISE EXCEPTION 'exercise swap target changed' USING ERRCODE = 'PT409'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(v_program.program_json->'sessions') program_session(value)
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(program_session.value->'exercises') exercise(value)
      WHERE program_session.value->>'sessionId' = v_target->>'sessionId'
        AND exercise.value->>'exerciseInstanceId' = v_target->>'exerciseInstanceId'
        AND exercise.value = v_target->'sourceExercise'
    ) THEN RAISE EXCEPTION 'exercise swap paired target changed' USING ERRCODE = 'PT409'; END IF;
  END LOOP;

  v_next_program := private.apply_training_exercise_swap(
    v_program.program_json, v_proposal.id, v_actor, v_now,
    v_proposal.replacement_exercise_version_id, v_selected,
    v_proposal.target_bindings, v_proposal.replacement_defaults, v_author_kind
  );
  v_next_revision := v_assignment.active_revision + 1;
  INSERT INTO public.training_program_revisions(
    assignment_id, subject_id, revision_number, program_json, created_by_user_id, published_at
  ) VALUES (v_assignment.id, v_proposal.subject_id, v_next_revision, v_next_program, v_actor, v_now);
  UPDATE public.training_program_assignments
    SET active_revision = v_next_revision, revision = revision + 1 WHERE id = v_assignment.id;

  v_result := pg_catalog.jsonb_build_object(
    'schemaVersion', 'training-exercise-swap-acceptance.v1',
    'proposalId', v_proposal.id, 'assignmentId', v_assignment.id,
    'programRevisionNumber', v_next_revision,
    'replacementExerciseVersionId', v_proposal.replacement_exercise_version_id,
    'selectedLoad', v_selected,
    'affectedSessionIds', (
      SELECT pg_catalog.jsonb_agg(value->>'sessionId' ORDER BY value->>'scheduledLocalDate', value->>'sessionId')
      FROM pg_catalog.jsonb_array_elements(v_proposal.target_bindings) value
    ),
    'recalibration', pg_catalog.jsonb_build_object(
      'required', true, 'reason', 'exercise_variant_changed',
      'loadDisposition', 'starting_target_to_confirm'
    )
  );
  INSERT INTO public.training_exercise_swap_acceptances(
    proposal_id, actor_user_id, request_id, selected_load_option_index, request_hash,
    assignment_id, result_program_revision_number, result_json, accepted_at
  ) VALUES (
    v_proposal.id, v_actor, p_request_id, p_selected_load_option_index, v_request_hash,
    v_assignment.id, v_next_revision, v_result, v_now
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.read_training_exercise_swap_candidate(text, text),
  public.accept_training_exercise_swap_proposal(uuid, uuid, integer),
  private.apply_training_exercise_swap(jsonb, uuid, uuid, timestamptz, text, jsonb, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.read_training_exercise_swap_candidate(text, text),
  public.accept_training_exercise_swap_proposal(uuid, uuid, integer) TO authenticated;

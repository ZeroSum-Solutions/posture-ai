-- Immutable, explainable strength progression proposals. Proposal generation is
-- server validated but non-authoritative; only the authenticated acceptance RPC
-- may append a program revision. Existing started prescriptions never change.

CREATE TABLE public.training_progression_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_key text NOT NULL UNIQUE CHECK (proposal_key ~ '^[a-f0-9]{64}$'),
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL REFERENCES public.training_subjects(id) ON DELETE RESTRICT,
  assignment_id text NOT NULL,
  base_program_revision_number bigint NOT NULL CHECK (base_program_revision_number > 0),
  base_assignment_revision bigint NOT NULL CHECK (base_assignment_revision > 0),
  target_session_id text NOT NULL,
  target_exercise_instance_id text NOT NULL
    CHECK (private.is_stable_training_reference(target_exercise_instance_id, 128)),
  target_session_revision bigint NOT NULL CHECK (target_session_revision > 0),
  progression_series_id text NOT NULL
    CHECK (private.is_stable_training_reference(progression_series_id, 128)),
  source_profile_revision bigint NOT NULL CHECK (source_profile_revision > 0),
  source_eligibility_revision_id text NOT NULL
    CHECK (private.is_stable_training_reference(source_eligibility_revision_id, 160)),
  source_program_hash text NOT NULL CHECK (source_program_hash ~ '^[a-f0-9]{64}$'),
  execution_context jsonb NOT NULL,
  source_session_revisions jsonb NOT NULL,
  mutable_target_revisions jsonb NOT NULL,
  decision_json jsonb NOT NULL,
  decision_hash text GENERATED ALWAYS AS (private.training_evidence_sha256(decision_json)) STORED,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  FOREIGN KEY (assignment_id, subject_id)
    REFERENCES public.training_program_assignments(id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id, base_program_revision_number)
    REFERENCES public.training_program_revisions(assignment_id, revision_number) ON DELETE RESTRICT,
  FOREIGN KEY (target_session_id, subject_id)
    REFERENCES public.training_sessions(id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (subject_id, source_profile_revision)
    REFERENCES public.training_profile_revisions(subject_id, revision) ON DELETE RESTRICT,
  CHECK ((execution_context->>'kind' IN ('live', 'synthetic_simulation')) IS TRUE),
  CHECK ((pg_catalog.jsonb_typeof(source_session_revisions) = 'array'
    AND pg_catalog.jsonb_array_length(source_session_revisions) BETWEEN 1 AND 64) IS TRUE),
  CHECK ((pg_catalog.jsonb_typeof(mutable_target_revisions) = 'array'
    AND pg_catalog.jsonb_array_length(mutable_target_revisions) BETWEEN 1 AND 64) IS TRUE),
  CHECK ((decision_json->>'status' = 'proposed') IS TRUE),
  CHECK ((decision_json->>'kind' IN ('rep_proposal', 'load_proposal')) IS TRUE),
  CHECK ((decision_json->>'decisionKey' IS NOT NULL) IS TRUE),
  CHECK ((decision_json->>'subjectId' = subject_id::text) IS TRUE),
  CHECK ((decision_json->>'sourceProfileRevisionId' = source_profile_revision::text) IS TRUE),
  CHECK ((decision_json->>'sourceEligibilityRevisionId' = source_eligibility_revision_id) IS TRUE),
  CHECK ((decision_json->'executionContext' = execution_context) IS TRUE),
  CHECK ((decision_json#>>'{proposal,load,equipmentId}' IS NOT NULL) IS TRUE),
  CHECK ((pg_catalog.jsonb_typeof(decision_json#>'{proposal,targetReps}') = 'array') IS TRUE)
);

CREATE TABLE public.training_progression_acceptances (
  proposal_id uuid PRIMARY KEY
    REFERENCES public.training_progression_proposals(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  assignment_id text NOT NULL,
  result_program_revision_number bigint NOT NULL CHECK (result_program_revision_number > 1),
  result_json jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (actor_user_id, request_id),
  FOREIGN KEY (assignment_id, result_program_revision_number)
    REFERENCES public.training_program_revisions(assignment_id, revision_number) ON DELETE RESTRICT,
  CHECK ((result_json->>'schemaVersion' = 'training-progression-acceptance.v1') IS TRUE),
  CHECK ((result_json->>'proposalId' = proposal_id::text) IS TRUE),
  CHECK ((result_json->>'assignmentId' = assignment_id) IS TRUE),
  CHECK ((result_json->>'programRevisionNumber' = result_program_revision_number::text) IS TRUE)
);

CREATE INDEX training_progression_proposals_assignment_created
  ON public.training_progression_proposals(assignment_id, created_at DESC);

CREATE TRIGGER training_progression_proposals_immutable
  BEFORE UPDATE OR DELETE ON public.training_progression_proposals
  FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();
CREATE TRIGGER training_progression_acceptances_immutable
  BEFORE UPDATE OR DELETE ON public.training_progression_acceptances
  FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();

ALTER TABLE public.training_progression_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_progression_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY training_progression_proposals_read
  ON public.training_progression_proposals FOR SELECT TO authenticated
  USING (private.can_read_training_assignment(assignment_id));
CREATE POLICY training_progression_acceptances_read
  ON public.training_progression_acceptances FOR SELECT TO authenticated
  USING (private.can_read_training_assignment(assignment_id));

REVOKE ALL ON public.training_progression_proposals,
  public.training_progression_acceptances FROM anon, authenticated, service_role;
GRANT SELECT ON public.training_progression_proposals,
  public.training_progression_acceptances TO authenticated, service_role;
-- The service may append a validated proposal. It cannot accept one, alter an
-- assignment, or write an acceptance.
GRANT INSERT ON public.training_progression_proposals TO service_role;

CREATE OR REPLACE FUNCTION public.read_training_progression_candidate(
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
  v_assignment public.training_program_assignments%ROWTYPE;
  v_program public.training_program_revisions%ROWTYPE;
  v_metadata public.training_session_progression_metadata%ROWTYPE;
  v_prescription jsonb;
  v_source_exercise jsonb;
  v_profile_revision bigint;
  v_profile jsonb;
  v_eligibility jsonb;
  v_context jsonb;
  v_evidence jsonb;
  v_targets jsonb;
  v_run public.training_simulation_runs%ROWTYPE;
BEGIN
  IF NOT private.is_stable_training_reference(p_session_id, 128)
    OR NOT private.is_stable_training_reference(p_exercise_instance_id, 128) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_session FROM public.training_sessions
    WHERE id = p_session_id AND session_kind = 'strength';
  IF NOT FOUND OR NOT private.can_read_training_assignment(v_session.assignment_id) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO STRICT v_assignment FROM public.training_program_assignments
    WHERE id = v_session.assignment_id;
  SELECT * INTO STRICT v_program FROM public.training_program_revisions
    WHERE assignment_id = v_assignment.id AND revision_number = v_assignment.active_revision;
  SELECT * INTO v_metadata FROM public.training_session_progression_metadata
    WHERE session_id = p_session_id AND exercise_instance_id = p_exercise_instance_id;
  SELECT prescription_json INTO v_prescription FROM public.training_session_prescriptions
    WHERE session_id = p_session_id;
  IF v_metadata.session_id IS NULL OR v_prescription IS NULL THEN RETURN NULL; END IF;
  SELECT value INTO v_source_exercise
    FROM pg_catalog.jsonb_array_elements(v_prescription->'exercises')
    WHERE value->>'exerciseInstanceId' = p_exercise_instance_id;
  IF v_source_exercise IS NULL THEN RETURN NULL; END IF;

  v_profile_revision := (v_program.program_json->>'profileRevisionId')::bigint;
  SELECT profile_json INTO v_profile FROM public.training_profile_revisions
    WHERE subject_id = v_session.subject_id AND revision = v_profile_revision;
  IF v_profile IS NULL THEN RETURN NULL; END IF;
  v_context := v_program.program_json->'executionContext';

  IF v_assignment.simulation_run_id IS NULL THEN
    SELECT pg_catalog.jsonb_build_object(
      'state', decision.decision_json->'state',
      'scope', decision.decision_json->'scope',
      'policyVersion', decision.decision_json->'policyVersion',
      'sourceRevisionId', decision.decision_json->'sourceRevisionId',
      'source', decision.decision_json->'source',
      'effectiveFrom', decision.decision_json->'effectiveFrom',
      'effectiveUntil', decision.decision_json->'effectiveUntil',
      'supersededAt', decision.decision_json->'supersededAt'
    ) INTO v_eligibility
    FROM public.training_eligibility_decisions decision
    WHERE decision.subject_id = v_session.subject_id
      AND decision.source_revision_id = v_program.program_json->>'eligibilitySourceRevisionId';
  ELSE
    SELECT * INTO v_run FROM public.training_simulation_runs
      WHERE id = v_assignment.simulation_run_id AND subject_id = v_session.subject_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_eligibility := pg_catalog.jsonb_build_object(
      'state', 'eligible_general', 'scope', 'supported',
      'policyVersion', 'synthetic-progression-policy.v1',
      'sourceRevisionId', 'simulation:' || v_run.id::text,
      'source', pg_catalog.jsonb_build_object(
        'kind', 'synthetic_fixture',
        'sourceVersion', 'synthetic-eligibility-fixture.v1',
        'fixtureId', v_run.fixture_id,
        'label', 'Synthetic eligibility for practice data'
      ),
      'effectiveFrom', pg_catalog.to_char(v_run.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'effectiveUntil', pg_catalog.to_char(v_run.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'supersededAt', NULL
    );
  END IF;
  IF v_eligibility IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(item.projection ORDER BY item.started_at), '[]'::jsonb)
  INTO v_evidence
  FROM (
    SELECT prescription.started_at,
      public.read_training_strength_evidence_projection(
        metadata.session_id, metadata.exercise_instance_id
      ) AS projection
    FROM public.training_session_progression_metadata metadata
    JOIN public.training_sessions evidence_session
      ON evidence_session.id = metadata.session_id
      AND evidence_session.subject_id = metadata.subject_id
    JOIN public.training_session_prescriptions prescription
      ON prescription.session_id = metadata.session_id
    WHERE evidence_session.assignment_id = v_assignment.id
      AND metadata.progression_series_id = v_metadata.progression_series_id
      AND prescription.started_at <= (
        SELECT source_prescription.started_at
        FROM public.training_session_prescriptions source_prescription
        WHERE source_prescription.session_id = p_session_id
      )
    ORDER BY prescription.started_at DESC
    LIMIT 64
  ) item;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'sessionId', scheduled.id,
    'sessionRevision', scheduled.revision,
    'exerciseInstanceId', exercise.value->>'exerciseInstanceId',
    'scheduledLocalDate', scheduled.scheduled_local_date::text
  ) ORDER BY scheduled.scheduled_local_date, scheduled.id, exercise.ordinality), '[]'::jsonb)
  INTO v_targets
  FROM pg_catalog.jsonb_array_elements(v_program.program_json->'sessions') WITH ORDINALITY program_session(value, ordinality)
  JOIN public.training_sessions scheduled
    ON scheduled.id = program_session.value->>'sessionId'
    AND scheduled.assignment_id = v_assignment.id
    AND scheduled.subject_id = v_session.subject_id
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(program_session.value->'exercises')
    WITH ORDINALITY exercise(value, ordinality)
  WHERE scheduled.state = 'scheduled'
    AND scheduled.scheduled_local_date > v_session.scheduled_local_date
    AND NOT EXISTS (
      SELECT 1 FROM public.training_session_prescriptions existing
      WHERE existing.session_id = scheduled.id
    )
    AND exercise.value#>>'{progression,progressionSeriesId}' = v_metadata.progression_series_id
    AND exercise.value->>'exerciseVersionId' = v_source_exercise->>'exerciseVersionId'
    AND exercise.value#>>'{acceptedInitialLoad,equipmentId}' = v_source_exercise#>>'{acceptedInitialLoad,equipmentId}'
    AND exercise.value#>>'{acceptedInitialLoad,loadBasis}' = v_source_exercise#>>'{acceptedInitialLoad,loadBasis}'
    AND exercise.value->'progression' = v_source_exercise->'progression'
    AND exercise.value->'repRange' = v_source_exercise->'repRange'
    AND exercise.value->'targetRir' = v_source_exercise->'targetRir'
    AND pg_catalog.jsonb_array_length(exercise.value->'setIds')
      = pg_catalog.jsonb_array_length(v_source_exercise->'setIds');

  RETURN pg_catalog.jsonb_build_object(
    'assignment', pg_catalog.jsonb_build_object(
      'id', v_assignment.id, 'subjectId', v_assignment.subject_id,
      'programMode', v_assignment.program_mode,
      'owningPractitionerId', v_assignment.owning_practitioner_id,
      'simulationRunId', v_assignment.simulation_run_id,
      'activeRevision', v_assignment.active_revision, 'revision', v_assignment.revision
    ),
    'program', v_program.program_json,
    'programHash', v_program.program_hash,
    'currentProfileRevision', (
      SELECT current_profile_revision FROM public.training_subjects WHERE id = v_session.subject_id
    ),
    'profileRevision', v_profile_revision,
    'profile', v_profile,
    'eligibility', v_eligibility,
    'progressionSeriesId', v_metadata.progression_series_id,
    'evidence', v_evidence,
    'targets', v_targets,
    'executionContext', v_context
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.apply_training_progression_proposal(
  p_program jsonb,
  p_proposal_id uuid,
  p_actor_user_id uuid,
  p_accepted_at timestamptz,
  p_decision jsonb,
  p_targets jsonb,
  p_target_session_id text,
  p_target_exercise_instance_id text,
  p_progression_series_id text,
  p_author_kind text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_target jsonb;
  v_sessions jsonb;
BEGIN
  SELECT exercise.value INTO v_target
  FROM pg_catalog.jsonb_array_elements(p_program->'sessions') program_session(value)
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(program_session.value->'exercises') exercise(value)
  WHERE program_session.value->>'sessionId' = p_target_session_id
    AND exercise.value->>'exerciseInstanceId' = p_target_exercise_instance_id;
  IF v_target IS NULL
    OR v_target#>>'{progression,progressionSeriesId}' IS DISTINCT FROM p_progression_series_id
    OR p_decision#>>'{proposal,load,equipmentId}' IS DISTINCT FROM v_target#>>'{acceptedInitialLoad,equipmentId}'
    OR p_decision#>>'{proposal,load,basis}' IS DISTINCT FROM v_target#>>'{acceptedInitialLoad,loadBasis}'
    OR pg_catalog.jsonb_array_length(p_decision#>'{proposal,targetReps}')
      <> pg_catalog.jsonb_array_length(v_target->'setIds') THEN
    RAISE EXCEPTION 'progression proposal target is invalid' USING ERRCODE = 'PT409';
  END IF;

  SELECT pg_catalog.jsonb_agg(
    program_session.value || pg_catalog.jsonb_build_object('exercises', (
      SELECT pg_catalog.jsonb_agg(
        CASE WHEN EXISTS (
          SELECT 1 FROM pg_catalog.jsonb_array_elements(p_targets) target(value)
          WHERE target.value->>'sessionId' = program_session.value->>'sessionId'
            AND target.value->>'exerciseInstanceId' = exercise.value->>'exerciseInstanceId'
        )
        AND exercise.value->>'exerciseVersionId' = v_target->>'exerciseVersionId'
        AND exercise.value#>>'{acceptedInitialLoad,equipmentId}' = v_target#>>'{acceptedInitialLoad,equipmentId}'
        AND exercise.value#>>'{acceptedInitialLoad,loadBasis}' = v_target#>>'{acceptedInitialLoad,loadBasis}'
        AND exercise.value->'progression' = v_target->'progression'
        AND exercise.value->'repRange' = v_target->'repRange'
        AND exercise.value->'targetRir' = v_target->'targetRir'
        AND pg_catalog.jsonb_array_length(exercise.value->'setIds') = pg_catalog.jsonb_array_length(v_target->'setIds')
        THEN exercise.value
          || pg_catalog.jsonb_build_object('targetReps', p_decision#>'{proposal,targetReps}')
          || pg_catalog.jsonb_build_object('progression',
            exercise.value->'progression' || pg_catalog.jsonb_build_object(
              'loadEpoch', (exercise.value#>>'{progression,loadEpoch}')::bigint
                + CASE WHEN p_decision->>'kind' = 'load_proposal' THEN 1 ELSE 0 END
            )
          )
          || CASE WHEN p_decision->>'kind' = 'load_proposal' THEN
            pg_catalog.jsonb_build_object('acceptedInitialLoad',
              exercise.value->'acceptedInitialLoad' || pg_catalog.jsonb_build_object(
                'acceptanceId', 'progression:' || p_proposal_id::text,
                'acceptedAt', pg_catalog.to_char(p_accepted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                'acceptedByUserId', p_actor_user_id::text,
                'quantity', p_decision#>'{proposal,load,quantity}'
              )
            )
          ELSE '{}'::jsonb END
        ELSE exercise.value END
        ORDER BY exercise.ordinality
      ) FROM pg_catalog.jsonb_array_elements(program_session.value->'exercises')
        WITH ORDINALITY exercise(value, ordinality)
    )) ORDER BY program_session.ordinality
  ) INTO v_sessions
  FROM pg_catalog.jsonb_array_elements(p_program->'sessions')
    WITH ORDINALITY program_session(value, ordinality);

  RETURN p_program
    || pg_catalog.jsonb_build_object(
      'revisionNumber', (p_program->>'revisionNumber')::bigint + 1,
      'publishedAt', pg_catalog.to_char(p_accepted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'author', pg_catalog.jsonb_build_object('kind', p_author_kind, 'userId', p_actor_user_id::text),
      'sessions', v_sessions
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_training_progression_proposal(
  p_proposal_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_proposal public.training_progression_proposals%ROWTYPE;
  v_assignment public.training_program_assignments%ROWTYPE;
  v_program public.training_program_revisions%ROWTYPE;
  v_subject public.training_subjects%ROWTYPE;
  v_existing public.training_progression_acceptances%ROWTYPE;
  v_source jsonb;
  v_target jsonb;
  v_next_program jsonb;
  v_next_revision bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_author_kind text;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'authenticated progression acceptance required' USING ERRCODE = '42501';
  END IF;
  IF auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 progression acceptance required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing FROM public.training_progression_acceptances
    WHERE actor_user_id = v_actor AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.proposal_id = p_proposal_id THEN RETURN v_existing.result_json; END IF;
    RAISE EXCEPTION 'progression request ID reused with different proposal' USING ERRCODE = 'PT409';
  END IF;

  SELECT * INTO v_proposal FROM public.training_progression_proposals
    WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'progression proposal is unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.training_progression_acceptances WHERE proposal_id = p_proposal_id) THEN
    RAISE EXCEPTION 'progression proposal was already accepted' USING ERRCODE = 'PT409';
  END IF;

  SELECT * INTO v_assignment FROM public.training_program_assignments
    WHERE id = v_proposal.assignment_id FOR UPDATE;
  SELECT * INTO v_subject FROM public.training_subjects
    WHERE id = v_proposal.subject_id FOR UPDATE;
  IF v_assignment.id IS NULL OR v_subject.id IS NULL
    OR v_assignment.subject_id <> v_proposal.subject_id OR v_assignment.status <> 'active' THEN
    RAISE EXCEPTION 'progression assignment is unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF v_assignment.program_mode = 'self_directed' THEN
    IF NOT private.is_training_subject_owner(v_proposal.subject_id) THEN
      RAISE EXCEPTION 'progression acceptance is not authorized' USING ERRCODE = '42501';
    END IF;
    v_author_kind := 'athlete';
  ELSE
    IF v_assignment.owning_practitioner_id IS DISTINCT FROM v_actor
      OR NOT private.is_training_subject_coach(v_proposal.subject_id, 'program:coach_publish')
      OR (v_assignment.simulation_run_id IS NOT NULL
        AND NOT private.has_training_simulation_control(v_assignment.simulation_run_id)) THEN
      RAISE EXCEPTION 'progression acceptance is not authorized' USING ERRCODE = '42501';
    END IF;
    v_author_kind := 'coach';
  END IF;

  SELECT * INTO v_program FROM public.training_program_revisions
    WHERE assignment_id = v_assignment.id AND revision_number = v_assignment.active_revision;
  IF v_assignment.active_revision IS DISTINCT FROM v_proposal.base_program_revision_number
    OR v_assignment.revision IS DISTINCT FROM v_proposal.base_assignment_revision
    OR v_program.program_hash IS DISTINCT FROM v_proposal.source_program_hash
    OR v_subject.current_profile_revision IS DISTINCT FROM v_proposal.source_profile_revision THEN
    RAISE EXCEPTION 'progression source changed' USING ERRCODE = 'PT409';
  END IF;
  IF v_assignment.simulation_run_id IS NULL
    AND v_subject.current_eligibility_decision_source_revision_id
      IS DISTINCT FROM v_proposal.source_eligibility_revision_id THEN
    RAISE EXCEPTION 'progression eligibility changed' USING ERRCODE = 'PT409';
  END IF;
  IF v_program.program_json->'executionContext' IS DISTINCT FROM v_proposal.execution_context THEN
    RAISE EXCEPTION 'progression context changed' USING ERRCODE = 'PT409';
  END IF;
  PERFORM private.assert_training_program_eligibility(
    v_proposal.subject_id, v_program.program_json, v_assignment.simulation_run_id
  );

  FOR v_source IN SELECT value FROM pg_catalog.jsonb_array_elements(v_proposal.source_session_revisions) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.training_sessions source_session
      WHERE source_session.id = v_source->>'sessionId'
        AND source_session.assignment_id = v_assignment.id
        AND source_session.subject_id = v_proposal.subject_id
        AND source_session.revision = (v_source->>'revision')::bigint
    ) THEN RAISE EXCEPTION 'progression evidence changed' USING ERRCODE = 'PT409'; END IF;
  END LOOP;
  FOR v_target IN SELECT value FROM pg_catalog.jsonb_array_elements(v_proposal.mutable_target_revisions) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.training_sessions target_session
      WHERE target_session.id = v_target->>'sessionId'
        AND target_session.assignment_id = v_assignment.id
        AND target_session.subject_id = v_proposal.subject_id
        AND target_session.session_kind = 'strength'
        AND target_session.state = 'scheduled'
        AND target_session.revision = (v_target->>'sessionRevision')::bigint
        AND NOT EXISTS (
          SELECT 1 FROM public.training_session_prescriptions prescription
          WHERE prescription.session_id = target_session.id
        )
    ) THEN RAISE EXCEPTION 'progression target changed' USING ERRCODE = 'PT409'; END IF;
  END LOOP;

  v_next_program := private.apply_training_progression_proposal(
    v_program.program_json, v_proposal.id, v_actor, v_now, v_proposal.decision_json,
    v_proposal.mutable_target_revisions, v_proposal.target_session_id,
    v_proposal.target_exercise_instance_id, v_proposal.progression_series_id, v_author_kind
  );
  v_next_revision := v_assignment.active_revision + 1;
  INSERT INTO public.training_program_revisions(
    assignment_id, subject_id, revision_number, program_json, created_by_user_id, published_at
  ) VALUES (
    v_assignment.id, v_proposal.subject_id, v_next_revision,
    v_next_program, v_actor, v_now
  );
  UPDATE public.training_program_assignments
  SET active_revision = v_next_revision, revision = revision + 1
  WHERE id = v_assignment.id;

  v_result := pg_catalog.jsonb_build_object(
    'schemaVersion', 'training-progression-acceptance.v1',
    'proposalId', v_proposal.id,
    'assignmentId', v_assignment.id,
    'programRevisionNumber', v_next_revision,
    'targetSessionId', v_proposal.target_session_id,
    'targetExerciseInstanceId', v_proposal.target_exercise_instance_id
  );
  INSERT INTO public.training_progression_acceptances(
    proposal_id, actor_user_id, request_id, request_hash,
    assignment_id, result_program_revision_number, result_json, accepted_at
  ) VALUES (
    v_proposal.id, v_actor, p_request_id,
    private.training_evidence_sha256(pg_catalog.jsonb_build_object(
      'proposalId', v_proposal.id, 'requestId', p_request_id
    )),
    v_assignment.id, v_next_revision, v_result, v_now
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.read_training_progression_candidate(text, text),
  public.accept_training_progression_proposal(uuid, uuid),
  private.apply_training_progression_proposal(jsonb, uuid, uuid, timestamptz, jsonb, jsonb, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_training_progression_candidate(text, text),
  public.accept_training_progression_proposal(uuid, uuid) TO authenticated;

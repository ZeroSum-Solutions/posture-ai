-- Close two authenticated training-write races without changing domain policy.
-- The source bodies are the final 46000 and 49000 definitions. Only the athlete
-- session-cutoff predicate and proposal/session lock acquisition are changed.

CREATE OR REPLACE FUNCTION public.append_training_eligibility_response(
  p_subject_id uuid,
  p_expected_revision bigint,
  p_source_revision_id text,
  p_answers_json jsonb
)
RETURNS TABLE (
  revision bigint,
  source_revision_id text,
  answers_hash text,
  hash_encoding text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subject public.training_subjects%ROWTYPE;
  v_current_revision bigint;
  v_answers_hash text;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt()->>'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'current AAL2 athlete is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_subject
  FROM public.training_subjects
  WHERE id = p_subject_id
  FOR UPDATE;

  IF NOT FOUND
    -- Reuse the final owner predicate so a correctly identified athlete whose
    -- JWT predates session_valid_after cannot write eligibility answers.
    OR NOT private.is_training_subject_owner(p_subject_id)
  THEN
    RAISE EXCEPTION 'eligibility answer write is not authorized'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(pg_catalog.max(response.revision), 0)
  INTO v_current_revision
  FROM public.training_eligibility_responses response
  WHERE response.subject_id = p_subject_id;

  IF v_current_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'eligibility answer revision changed concurrently'
      USING ERRCODE = 'PT409';
  END IF;

  IF private.is_valid_training_answers(p_answers_json) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'answers do not match eligibility-answers.v1'
      USING ERRCODE = '22023';
  END IF;
  IF p_source_revision_id IS DISTINCT FROM p_answers_json->>'sourceRevisionId'
    AND p_answers_json ? 'sourceRevisionId'
  THEN
    RAISE EXCEPTION 'answers source revision does not match the document'
      USING ERRCODE = '22023';
  END IF;

  revision := p_expected_revision + 1;
  source_revision_id := p_source_revision_id;
  v_answers_hash := private.training_evidence_sha256(p_answers_json);
  INSERT INTO public.training_eligibility_responses (
    subject_id, revision, source_revision_id, schema_version,
    questionnaire_source_version, answers_json, answers_hash, hash_encoding,
    submitted_by_user_id, submitted_at
  ) VALUES (
    p_subject_id,
    revision,
    p_source_revision_id,
    p_answers_json->>'schemaVersion',
    p_answers_json->>'questionnaireSourceVersion',
    p_answers_json,
    v_answers_hash,
    'postgres-jsonb-text-utf8.v1',
    auth.uid(),
    (p_answers_json->>'submittedAt')::timestamptz
  );
  answers_hash := v_answers_hash;
  hash_encoding := 'postgres-jsonb-text-utf8.v1';
  RETURN NEXT;
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

  -- Every session mutation locks its session before the assignment. Lock the
  -- complete proposal evidence/target set in stable ID order before taking the
  -- assignment and subject locks. A correction or start that commits first is
  -- therefore observed by the revision checks below; an acceptance that locks
  -- first is linearized before that later mutation, without lock inversion.
  PERFORM 1
  FROM public.training_sessions locked_session
  WHERE locked_session.id IN (
    SELECT source.value->>'sessionId'
    FROM pg_catalog.jsonb_array_elements(v_proposal.source_session_revisions) source(value)
    UNION
    SELECT target.value->>'sessionId'
    FROM pg_catalog.jsonb_array_elements(v_proposal.mutable_target_revisions) target(value)
  )
  ORDER BY locked_session.id
  FOR UPDATE OF locked_session;

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

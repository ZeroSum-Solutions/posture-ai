-- Allow an exact committed acceptance replay after proposal expiry. Current actor and
-- assignment authority still run first; expiry still blocks every unaccepted proposal.

CREATE OR REPLACE FUNCTION public.accept_training_active_calibration_proposal(
  p_proposal_id uuid,
  p_request_id uuid,
  p_option_index integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_proposal public.training_active_calibration_proposals%ROWTYPE;
  v_assignment public.training_program_assignments%ROWTYPE;
  v_subject public.training_subjects%ROWTYPE;
  v_program public.training_program_revisions%ROWTYPE;
  v_source public.training_sessions%ROWTYPE;
  v_existing public.training_active_calibration_acceptances%ROWTYPE;
  v_target jsonb;
  v_selected jsonb;
  v_request_hash text;
  v_new_series_id text;
  v_next_program jsonb;
  v_next_revision bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_author_kind text;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2'
    OR p_request_id IS NULL OR p_option_index IS NULL OR p_option_index NOT BETWEEN 0 AND 49999
  THEN RAISE EXCEPTION 'invalid active calibration acceptance' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_proposal FROM public.training_active_calibration_proposals
    WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'active calibration proposal unavailable' USING ERRCODE = 'P0001'; END IF;

  PERFORM 1 FROM public.training_sessions locked_session
  WHERE locked_session.id IN (
    SELECT v_proposal.source_session_id
    UNION
    SELECT value->>'sessionId' FROM pg_catalog.jsonb_array_elements(v_proposal.target_bindings) value
  ) ORDER BY locked_session.id FOR UPDATE OF locked_session;
  SELECT * INTO v_assignment FROM public.training_program_assignments
    WHERE id = v_proposal.assignment_id FOR UPDATE;
  SELECT * INTO v_subject FROM public.training_subjects
    WHERE id = v_proposal.subject_id FOR UPDATE;
  IF v_assignment.id IS NULL OR v_subject.id IS NULL
    OR v_assignment.subject_id <> v_proposal.subject_id OR v_assignment.status <> 'active'
  THEN RAISE EXCEPTION 'active calibration acceptance forbidden' USING ERRCODE = '42501'; END IF;
  IF v_assignment.program_mode = 'self_directed' THEN
    IF NOT private.is_training_subject_owner(v_proposal.subject_id) THEN
      RAISE EXCEPTION 'active calibration acceptance forbidden' USING ERRCODE = '42501';
    END IF;
    v_author_kind := 'athlete';
  ELSE
    IF v_assignment.owning_practitioner_id IS DISTINCT FROM v_actor
      OR NOT private.is_training_subject_coach(v_proposal.subject_id, 'program:coach_publish')
      OR (v_assignment.simulation_run_id IS NOT NULL
        AND NOT private.has_training_simulation_control(v_assignment.simulation_run_id))
    THEN RAISE EXCEPTION 'active calibration acceptance forbidden' USING ERRCODE = '42501'; END IF;
    v_author_kind := 'coach';
  END IF;
  v_request_hash := private.training_evidence_sha256(pg_catalog.jsonb_build_object(
    'proposalId', p_proposal_id, 'requestId', p_request_id, 'optionIndex', p_option_index
  ));
  SELECT * INTO v_existing FROM public.training_active_calibration_acceptances
    WHERE actor_user_id = v_actor AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash = v_request_hash THEN RETURN v_existing.result_json; END IF;
    RAISE EXCEPTION 'active calibration request ID reused with different selection' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (SELECT 1 FROM public.training_active_calibration_acceptances
    WHERE proposal_id = p_proposal_id) THEN
    RAISE EXCEPTION 'active calibration proposal already accepted' USING ERRCODE = 'PT409';
  END IF;

  IF v_proposal.expires_at <= v_now THEN
    RAISE EXCEPTION 'active calibration proposal expired' USING ERRCODE = 'PT409';
  END IF;

  SELECT * INTO v_program FROM public.training_program_revisions
    WHERE assignment_id = v_assignment.id AND revision_number = v_assignment.active_revision;
  SELECT * INTO v_source FROM public.training_sessions WHERE id = v_proposal.source_session_id;
  IF v_assignment.active_revision IS DISTINCT FROM v_proposal.base_program_revision_number
    OR v_assignment.revision IS DISTINCT FROM v_proposal.base_assignment_revision
    OR v_program.program_hash IS DISTINCT FROM v_proposal.source_program_hash
    OR v_subject.current_profile_revision IS DISTINCT FROM v_proposal.source_profile_revision
    OR v_source.subject_id IS DISTINCT FROM v_proposal.subject_id
    OR v_source.assignment_id IS DISTINCT FROM v_proposal.assignment_id
    OR v_source.revision IS DISTINCT FROM v_proposal.source_session_revision
    OR v_source.state NOT IN ('completed', 'completed_with_omissions')
    OR v_program.program_json->'executionContext' IS DISTINCT FROM v_proposal.execution_context
  THEN RAISE EXCEPTION 'active calibration source changed' USING ERRCODE = 'PT409'; END IF;
  IF v_assignment.simulation_run_id IS NULL
    AND v_subject.current_eligibility_decision_source_revision_id
      IS DISTINCT FROM v_proposal.source_eligibility_revision_id
  THEN RAISE EXCEPTION 'active calibration eligibility changed' USING ERRCODE = 'PT409'; END IF;
  PERFORM private.assert_training_program_eligibility(
    v_proposal.subject_id, v_program.program_json, v_assignment.simulation_run_id
  );

  SELECT value INTO v_selected FROM pg_catalog.jsonb_array_elements(v_proposal.offer_json->'options') value
    WHERE (value->>'optionIndex')::integer = p_option_index;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(v_proposal.offer_json->'options') value
      WHERE (value->>'optionIndex')::integer = p_option_index) <> 1
    OR v_selected IS NULL
    OR v_selected->>'equipmentId' IS DISTINCT FROM v_proposal.offer_json#>>'{currentLoad,equipmentId}'
    OR v_selected->>'basis' IS DISTINCT FROM v_proposal.offer_json#>>'{currentLoad,basis}'
  THEN RAISE EXCEPTION 'active calibration option unavailable' USING ERRCODE = 'PT409'; END IF;

  FOR v_target IN SELECT value FROM pg_catalog.jsonb_array_elements(v_proposal.target_bindings) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.training_sessions target_session
      WHERE target_session.id = v_target->>'sessionId'
        AND target_session.assignment_id = v_proposal.assignment_id
        AND target_session.subject_id = v_proposal.subject_id
        AND target_session.session_kind = 'strength'
        AND target_session.state = 'scheduled'
        AND target_session.revision = (v_target->>'sessionRevision')::bigint
        AND NOT EXISTS (SELECT 1 FROM public.training_session_prescriptions prescription
          WHERE prescription.session_id = target_session.id)
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(v_program.program_json->'sessions') program_session(value)
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(program_session.value->'exercises') exercise(value)
      WHERE program_session.value->>'sessionId' = v_target->>'sessionId'
        AND exercise.value->>'exerciseInstanceId' = v_target->>'exerciseInstanceId'
        AND exercise.value#>>'{progression,progressionSeriesId}'
          = v_proposal.offer_json#>>'{seriesIntent,sourceProgressionSeriesId}'
        AND (exercise.value#>>'{progression,loadEpoch}')::bigint
          = (v_proposal.offer_json#>>'{seriesIntent,sourceLoadEpoch}')::bigint
        AND exercise.value#>>'{acceptedInitialLoad,equipmentId}'
          = v_proposal.offer_json#>>'{currentLoad,equipmentId}'
        AND exercise.value#>>'{acceptedInitialLoad,loadBasis}'
          = v_proposal.offer_json#>>'{currentLoad,basis}'
        AND exercise.value#>'{acceptedInitialLoad,quantity}' = v_proposal.offer_json#>'{currentLoad,quantity}'
        AND NOT EXISTS (
          SELECT 1 FROM pg_catalog.jsonb_array_elements(
            CASE WHEN pg_catalog.jsonb_typeof(exercise.value->'warmupSets') = 'array'
              THEN exercise.value->'warmupSets' ELSE '[]'::jsonb END
          ) warmup(value)
          WHERE CASE v_selected->>'basis'
            WHEN 'machine_assistance' THEN
              (warmup.value#>>'{prescribedLoad,canonicalKg}')::numeric
                < (v_selected#>>'{quantity,canonicalKg}')::numeric
            ELSE
              (warmup.value#>>'{prescribedLoad,canonicalKg}')::numeric
                > (v_selected#>>'{quantity,canonicalKg}')::numeric
          END
        )
    ) THEN RAISE EXCEPTION 'active calibration target changed' USING ERRCODE = 'PT409'; END IF;
  END LOOP;

  v_new_series_id := 'familiarization:' || p_proposal_id::text;
  v_next_program := private.apply_training_active_calibration(
    v_program.program_json, v_proposal.id, v_actor, v_now, v_selected,
    v_proposal.target_bindings,
    v_proposal.offer_json#>>'{seriesIntent,sourceProgressionSeriesId}',
    (v_proposal.offer_json#>>'{seriesIntent,sourceLoadEpoch}')::bigint,
    (v_proposal.offer_json#>>'{seriesIntent,nextLoadEpoch}')::bigint,
    v_new_series_id, v_author_kind
  );
  v_next_revision := v_assignment.active_revision + 1;
  INSERT INTO public.training_program_revisions(
    assignment_id,subject_id,revision_number,program_json,created_by_user_id,published_at
  ) VALUES (v_assignment.id,v_proposal.subject_id,v_next_revision,v_next_program,v_actor,v_now);
  UPDATE public.training_program_assignments SET active_revision=v_next_revision,revision=revision+1
    WHERE id=v_assignment.id;

  v_result := pg_catalog.jsonb_build_object(
    'schemaVersion','active-calibration-acceptance.v1',
    'proposalId',v_proposal.id,'assignmentId',v_assignment.id,
    'programRevisionNumber',v_next_revision,'executionContext',v_proposal.execution_context,
    'selectedLoad',pg_catalog.jsonb_build_object(
      'equipmentId',v_selected->>'equipmentId','basis',v_selected->>'basis','quantity',v_selected->'quantity'
    ),
    'seriesIntent',v_proposal.offer_json->'seriesIntent','newProgressionSeriesId',v_new_series_id,
    'affectedTargets',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'sessionId',value->>'sessionId','exerciseInstanceId',value->>'exerciseInstanceId'
    ) ORDER BY value->>'scheduledLocalDate',value->>'sessionId',value->>'exerciseInstanceId')
      FROM pg_catalog.jsonb_array_elements(v_proposal.target_bindings) value)
  );
  INSERT INTO public.training_active_calibration_acceptances(
    proposal_id,actor_user_id,request_id,option_index,request_hash,
    assignment_id,result_program_revision_number,result_json,accepted_at
  ) VALUES (v_proposal.id,v_actor,p_request_id,p_option_index,v_request_hash,
    v_assignment.id,v_next_revision,v_result,v_now);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_training_active_calibration_proposal(uuid,uuid,integer)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.accept_training_active_calibration_proposal(uuid,uuid,integer)
  TO authenticated;

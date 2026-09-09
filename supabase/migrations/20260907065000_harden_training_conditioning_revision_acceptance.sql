-- Harden conditioning revision acceptance against stale local dates and revoked replay authority.

CREATE OR REPLACE FUNCTION public.accept_training_conditioning_revision_proposal(
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
  v_proposal public.training_conditioning_revision_proposals%ROWTYPE;
  v_existing public.training_conditioning_revision_acceptances%ROWTYPE;
  v_assignment public.training_program_assignments%ROWTYPE;
  v_subject public.training_subjects%ROWTYPE;
  v_program public.training_program_revisions%ROWTYPE;
  v_target jsonb;
  v_replacement jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_next_program jsonb;
  v_next_revision bigint;
  v_author_kind text;
  v_result jsonb;
  v_timezone text;
  v_timezone_count integer;
  v_current_local_date date;
BEGIN
  IF v_actor IS NULL OR p_request_id IS NULL OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 conditioning revision acceptance required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_existing FROM public.training_conditioning_revision_acceptances
    WHERE actor_user_id=v_actor AND request_id=p_request_id;
  IF FOUND THEN
    IF v_existing.proposal_id IS DISTINCT FROM p_proposal_id THEN
      RAISE EXCEPTION 'conditioning revision request ID reused' USING ERRCODE='PT409';
    END IF;
    SELECT * INTO v_assignment FROM public.training_program_assignments
      WHERE id=v_existing.assignment_id;
    SELECT * INTO v_subject FROM public.training_subjects WHERE id=v_assignment.subject_id;
    IF v_assignment.id IS NULL OR v_subject.id IS NULL OR v_assignment.status <> 'active'
      OR (v_assignment.program_mode='self_directed'
        AND NOT private.is_training_subject_owner(v_assignment.subject_id))
      OR (v_assignment.program_mode='coach_assigned' AND (
        v_assignment.owning_practitioner_id IS DISTINCT FROM v_actor
        OR NOT private.is_training_subject_coach(v_assignment.subject_id,'program:coach_publish')
        OR (v_assignment.simulation_run_id IS NOT NULL
          AND NOT private.has_training_simulation_control(v_assignment.simulation_run_id)))) THEN
      RAISE EXCEPTION 'conditioning revision not authorized' USING ERRCODE='42501';
    END IF;
    RETURN v_existing.result_json;
  END IF;
  SELECT * INTO v_proposal FROM public.training_conditioning_revision_proposals
    WHERE id=p_proposal_id FOR UPDATE;
  IF NOT FOUND OR v_proposal.expires_at <= v_now THEN
    RAISE EXCEPTION 'conditioning revision proposal unavailable' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.training_conditioning_revision_acceptances
    WHERE proposal_id=p_proposal_id) THEN
    RAISE EXCEPTION 'conditioning revision proposal already accepted' USING ERRCODE='PT409';
  END IF;

  SELECT * INTO v_assignment FROM public.training_program_assignments WHERE id=v_proposal.assignment_id;
  SELECT * INTO v_subject FROM public.training_subjects WHERE id=v_proposal.subject_id;
  IF v_assignment.id IS NULL OR v_subject.id IS NULL OR v_assignment.status <> 'active' THEN
    RAISE EXCEPTION 'conditioning revision assignment unavailable' USING ERRCODE='P0001';
  END IF;
  IF v_assignment.program_mode='self_directed' THEN
    IF NOT private.is_training_subject_owner(v_proposal.subject_id) THEN
      RAISE EXCEPTION 'conditioning revision not authorized' USING ERRCODE='42501'; END IF;
    v_author_kind := 'athlete';
  ELSE
    IF v_assignment.owning_practitioner_id IS DISTINCT FROM v_actor
      OR NOT private.is_training_subject_coach(v_proposal.subject_id,'program:coach_publish')
      OR (v_assignment.simulation_run_id IS NOT NULL
        AND NOT private.has_training_simulation_control(v_assignment.simulation_run_id)) THEN
      RAISE EXCEPTION 'conditioning revision not authorized' USING ERRCODE='42501'; END IF;
    v_author_kind := 'coach';
  END IF;

  PERFORM 1 FROM public.training_sessions session
  WHERE session.id IN (SELECT value->>'sessionId'
    FROM pg_catalog.jsonb_array_elements(v_proposal.target_revisions) item(value))
  ORDER BY session.id FOR UPDATE;
  SELECT * INTO v_assignment FROM public.training_program_assignments
    WHERE id=v_proposal.assignment_id FOR UPDATE;
  SELECT * INTO v_subject FROM public.training_subjects WHERE id=v_proposal.subject_id FOR UPDATE;
  IF v_assignment.id IS NULL OR v_subject.id IS NULL OR v_assignment.status <> 'active'
    OR (v_assignment.program_mode='self_directed'
      AND NOT private.is_training_subject_owner(v_proposal.subject_id))
    OR (v_assignment.program_mode='coach_assigned' AND (
      v_assignment.owning_practitioner_id IS DISTINCT FROM v_actor
      OR NOT private.is_training_subject_coach(v_proposal.subject_id,'program:coach_publish')
      OR (v_assignment.simulation_run_id IS NOT NULL
        AND NOT private.has_training_simulation_control(v_assignment.simulation_run_id)))) THEN
    RAISE EXCEPTION 'conditioning revision not authorized' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_program FROM public.training_program_revisions
    WHERE assignment_id=v_assignment.id AND revision_number=v_assignment.active_revision;
  IF v_assignment.active_revision IS DISTINCT FROM v_proposal.base_program_revision_number
    OR v_assignment.revision IS DISTINCT FROM v_proposal.base_assignment_revision
    OR v_program.program_hash IS DISTINCT FROM v_proposal.source_program_hash
    OR v_subject.current_profile_revision IS DISTINCT FROM v_proposal.source_profile_revision
    OR (v_assignment.simulation_run_id IS NULL AND
      v_subject.current_eligibility_decision_source_revision_id IS DISTINCT FROM
        v_proposal.source_eligibility_revision_id)
    OR v_program.program_json->'executionContext' IS DISTINCT FROM v_proposal.execution_context THEN
    RAISE EXCEPTION 'conditioning revision source changed' USING ERRCODE='PT409';
  END IF;
  PERFORM private.assert_training_program_eligibility(
    v_proposal.subject_id,v_program.program_json,v_assignment.simulation_run_id);

  SELECT count(DISTINCT bout.value->>'athleteTimezone'),
    min(bout.value->>'athleteTimezone')
  INTO v_timezone_count,v_timezone
  FROM pg_catalog.jsonb_array_elements(v_program.program_json->'conditioningBouts') bout(value);
  IF v_timezone_count <> 1 OR v_timezone IS NULL OR pg_catalog.length(v_timezone) > 100 THEN
    RAISE EXCEPTION 'conditioning revision source changed' USING ERRCODE='PT409';
  END IF;
  BEGIN
    v_current_local_date := (pg_catalog.clock_timestamp() AT TIME ZONE v_timezone)::date;
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE EXCEPTION 'conditioning revision source changed' USING ERRCODE='PT409';
  END;

  FOR v_target IN SELECT value FROM pg_catalog.jsonb_array_elements(v_proposal.target_revisions) LOOP
    SELECT item.value INTO v_replacement
    FROM pg_catalog.jsonb_array_elements(v_proposal.revision_json->'replacements') item(value)
    WHERE item.value->>'sourceBoutId'=v_target->>'sessionId';
    IF v_replacement IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.training_sessions session
      JOIN LATERAL pg_catalog.jsonb_array_elements(v_program.program_json->'conditioningBouts') bout(value)
        ON bout.value->>'boutId'=session.id
      WHERE session.id=v_target->>'sessionId' AND session.assignment_id=v_assignment.id
        AND session.subject_id=v_proposal.subject_id AND session.session_kind='conditioning'
        AND session.state='scheduled' AND session.revision=(v_target->>'sessionRevision')::bigint
        AND session.scheduled_local_date=(v_target->>'scheduledLocalDate')::date
        AND bout.value->>'boutId'=v_replacement->>'sourceBoutId'
        AND v_replacement->>'athleteTimezone'=v_timezone
        AND (v_replacement->>'scheduledLocalDate')::date >= v_current_local_date
        AND NOT EXISTS (SELECT 1 FROM public.training_session_prescriptions prescription
          WHERE prescription.session_id=session.id)
    ) THEN RAISE EXCEPTION 'conditioning revision target changed' USING ERRCODE='PT409'; END IF;
  END LOOP;

  v_next_program := private.apply_training_conditioning_revision(
    v_program.program_json,v_proposal.id,v_actor,v_now,v_proposal.revision_json,v_author_kind);
  v_next_revision := v_assignment.active_revision+1;
  INSERT INTO public.training_program_revisions(
    assignment_id,subject_id,revision_number,program_json,created_by_user_id,published_at
  ) VALUES(v_assignment.id,v_proposal.subject_id,v_next_revision,v_next_program,v_actor,v_now);
  FOR v_replacement IN SELECT value FROM pg_catalog.jsonb_array_elements(v_proposal.revision_json->'replacements') LOOP
    UPDATE public.training_sessions SET
      scheduled_local_date=(v_replacement->>'scheduledLocalDate')::date,
      athlete_timezone=v_replacement->>'athleteTimezone',
      revision=revision+1,updated_at=v_now
    WHERE id=v_replacement->>'sourceBoutId';
  END LOOP;
  UPDATE public.training_program_assignments SET active_revision=v_next_revision,revision=revision+1
    WHERE id=v_assignment.id;

  v_result := pg_catalog.jsonb_build_object(
    'schemaVersion','conditioning-revision-acceptance.v1','proposalId',v_proposal.id,
    'assignmentId',v_assignment.id,'programRevisionNumber',v_next_revision,
    'affectedBoutIds',(SELECT pg_catalog.jsonb_agg(value->>'sourceBoutId' ORDER BY ordinality)
      FROM pg_catalog.jsonb_array_elements(v_proposal.revision_json->'replacements')
        WITH ORDINALITY item(value,ordinality)),
    'evidenceBoundary',CASE WHEN EXISTS (SELECT 1
      FROM pg_catalog.jsonb_array_elements(v_proposal.revision_json->'replacements') item(value)
      WHERE value#>>'{evidenceBoundary,kind}'='reset') THEN 'reset' ELSE 'preserved' END
  );
  INSERT INTO public.training_conditioning_revision_acceptances(
    proposal_id,actor_user_id,request_id,request_hash,assignment_id,
    result_program_revision_number,result_json,accepted_at
  ) VALUES(v_proposal.id,v_actor,p_request_id,
    private.training_evidence_sha256(pg_catalog.jsonb_build_object(
      'proposalId',v_proposal.id,'requestId',p_request_id)),
    v_assignment.id,v_next_revision,v_result,v_now);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_training_conditioning_revision_proposal(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.accept_training_conditioning_revision_proposal(uuid,uuid)
  TO authenticated;

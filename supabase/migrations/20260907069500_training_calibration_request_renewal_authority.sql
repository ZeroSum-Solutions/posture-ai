-- Restore request-level renewal authority for athletes on coach-assigned programs.
-- Acceptance remains restricted to the owning practitioner; this migration only
-- lets the current subject owner reuse or renew an immutable server-built offer.

CREATE OR REPLACE FUNCTION public.renew_training_active_calibration_proposal(
  p_proposal_id uuid
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
  v_target jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_effective_expiry timestamptz;
  v_next_expiry timestamptz;
  v_renewal_number bigint;
BEGIN
  IF v_actor IS NULL OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'active calibration renewal forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_proposal FROM public.training_active_calibration_proposals
    WHERE id=p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'active calibration proposal unavailable' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.training_sessions locked_session
  WHERE locked_session.id IN (
    SELECT v_proposal.source_session_id
    UNION
    SELECT value->>'sessionId'
    FROM pg_catalog.jsonb_array_elements(v_proposal.target_bindings) value
  ) ORDER BY locked_session.id FOR UPDATE OF locked_session;
  SELECT * INTO v_assignment FROM public.training_program_assignments
    WHERE id=v_proposal.assignment_id FOR UPDATE;
  SELECT * INTO v_subject FROM public.training_subjects
    WHERE id=v_proposal.subject_id FOR UPDATE;
  IF v_assignment.id IS NULL OR v_subject.id IS NULL
    OR v_assignment.subject_id <> v_proposal.subject_id OR v_assignment.status <> 'active'
  THEN RAISE EXCEPTION 'active calibration renewal forbidden' USING ERRCODE = '42501'; END IF;
  IF private.is_training_subject_owner(v_proposal.subject_id) THEN
    NULL; -- An athlete may request or renew a coach-assigned offer, but cannot accept it.
  ELSIF v_assignment.program_mode='self_directed'
    OR v_assignment.owning_practitioner_id IS DISTINCT FROM v_actor
    OR NOT private.is_training_subject_coach(v_proposal.subject_id,'program:coach_publish')
    OR (v_assignment.simulation_run_id IS NOT NULL
      AND NOT private.has_training_simulation_control(v_assignment.simulation_run_id))
  THEN RAISE EXCEPTION 'active calibration renewal forbidden' USING ERRCODE = '42501'; END IF;

  SELECT GREATEST(v_proposal.expires_at,
    COALESCE(pg_catalog.max(lifetime.expires_at),'-infinity'::timestamptz))
  INTO v_effective_expiry
  FROM public.training_active_calibration_proposal_lifetimes lifetime
  WHERE lifetime.proposal_id=v_proposal.id;
  IF EXISTS (SELECT 1 FROM public.training_active_calibration_acceptances
    WHERE proposal_id=v_proposal.id) THEN
    RETURN pg_catalog.jsonb_build_object(
      'proposalId',v_proposal.id,'status','accepted',
      'expiresAt',pg_catalog.to_char(v_effective_expiry AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  END IF;

  SELECT * INTO v_program FROM public.training_program_revisions
    WHERE assignment_id=v_assignment.id AND revision_number=v_assignment.active_revision;
  SELECT * INTO v_source FROM public.training_sessions WHERE id=v_proposal.source_session_id;
  IF v_assignment.active_revision IS DISTINCT FROM v_proposal.base_program_revision_number
    OR v_assignment.revision IS DISTINCT FROM v_proposal.base_assignment_revision
    OR v_program.program_hash IS DISTINCT FROM v_proposal.source_program_hash
    OR v_subject.current_profile_revision IS DISTINCT FROM v_proposal.source_profile_revision
    OR v_source.subject_id IS DISTINCT FROM v_proposal.subject_id
    OR v_source.assignment_id IS DISTINCT FROM v_proposal.assignment_id
    OR v_source.revision IS DISTINCT FROM v_proposal.source_session_revision
    OR v_source.state NOT IN ('completed','completed_with_omissions')
    OR v_program.program_json->'executionContext' IS DISTINCT FROM v_proposal.execution_context
  THEN RAISE EXCEPTION 'active calibration source changed' USING ERRCODE = 'PT409'; END IF;
  IF v_assignment.simulation_run_id IS NULL
    AND v_subject.current_eligibility_decision_source_revision_id
      IS DISTINCT FROM v_proposal.source_eligibility_revision_id
  THEN RAISE EXCEPTION 'active calibration eligibility changed' USING ERRCODE = 'PT409'; END IF;
  PERFORM private.assert_training_program_eligibility(
    v_proposal.subject_id,v_program.program_json,v_assignment.simulation_run_id);

  FOR v_target IN SELECT value FROM pg_catalog.jsonb_array_elements(v_proposal.target_bindings) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.training_sessions target_session
      WHERE target_session.id=v_target->>'sessionId'
        AND target_session.assignment_id=v_proposal.assignment_id
        AND target_session.subject_id=v_proposal.subject_id
        AND target_session.session_kind='strength'
        AND target_session.state='scheduled'
        AND target_session.revision=(v_target->>'sessionRevision')::bigint
        AND NOT EXISTS (SELECT 1 FROM public.training_session_prescriptions prescription
          WHERE prescription.session_id=target_session.id)
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(v_program.program_json->'sessions')
        program_session(value)
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(program_session.value->'exercises')
        exercise(value)
      WHERE program_session.value->>'sessionId'=v_target->>'sessionId'
        AND exercise.value->>'exerciseInstanceId'=v_target->>'exerciseInstanceId'
        AND exercise.value#>>'{progression,progressionSeriesId}'
          =v_proposal.offer_json#>>'{seriesIntent,sourceProgressionSeriesId}'
        AND (exercise.value#>>'{progression,loadEpoch}')::bigint
          =(v_proposal.offer_json#>>'{seriesIntent,sourceLoadEpoch}')::bigint
        AND exercise.value#>>'{acceptedInitialLoad,equipmentId}'
          =v_proposal.offer_json#>>'{currentLoad,equipmentId}'
        AND exercise.value#>>'{acceptedInitialLoad,loadBasis}'
          =v_proposal.offer_json#>>'{currentLoad,basis}'
        AND exercise.value#>'{acceptedInitialLoad,quantity}'
          =v_proposal.offer_json#>'{currentLoad,quantity}'
    ) THEN RAISE EXCEPTION 'active calibration target changed' USING ERRCODE = 'PT409'; END IF;
  END LOOP;

  IF v_effective_expiry > v_now THEN
    RETURN pg_catalog.jsonb_build_object(
      'proposalId',v_proposal.id,'status','active',
      'expiresAt',pg_catalog.to_char(v_effective_expiry AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  END IF;
  SELECT COALESCE(pg_catalog.max(renewal_number),0)+1 INTO v_renewal_number
  FROM public.training_active_calibration_proposal_lifetimes
  WHERE proposal_id=v_proposal.id;
  v_next_expiry := v_now+interval '1 hour';
  INSERT INTO public.training_active_calibration_proposal_lifetimes(
    proposal_id,renewal_number,renewed_by_user_id,renewed_at,expires_at
  ) VALUES (v_proposal.id,v_renewal_number,v_actor,v_now,v_next_expiry);
  RETURN pg_catalog.jsonb_build_object(
    'proposalId',v_proposal.id,'status','renewed',
    'expiresAt',pg_catalog.to_char(v_next_expiry AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_training_manual_recalibration_proposal(
  p_proposal_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_proposal public.training_manual_recalibration_proposals%ROWTYPE;
  v_assignment public.training_program_assignments%ROWTYPE;
  v_subject public.training_subjects%ROWTYPE;
  v_program public.training_program_revisions%ROWTYPE;
  v_source public.training_sessions%ROWTYPE;
  v_target jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_effective_expiry timestamptz;
  v_next_expiry timestamptz;
  v_renewal_number bigint;
BEGIN
  IF v_actor IS NULL OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'manual recalibration renewal forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_proposal FROM public.training_manual_recalibration_proposals
    WHERE id=p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'manual recalibration proposal unavailable' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.training_sessions locked_session
  WHERE locked_session.id IN (
    SELECT value->>'sessionId'
    FROM pg_catalog.jsonb_array_elements(v_proposal.source_session_revisions) value
    UNION
    SELECT value->>'sessionId'
    FROM pg_catalog.jsonb_array_elements(v_proposal.target_bindings) value
  ) ORDER BY locked_session.id FOR UPDATE OF locked_session;
  SELECT * INTO v_assignment FROM public.training_program_assignments
    WHERE id=v_proposal.assignment_id FOR UPDATE;
  SELECT * INTO v_subject FROM public.training_subjects
    WHERE id=v_proposal.subject_id FOR UPDATE;
  IF v_assignment.id IS NULL OR v_subject.id IS NULL
    OR v_assignment.subject_id <> v_proposal.subject_id OR v_assignment.status <> 'active'
  THEN RAISE EXCEPTION 'manual recalibration renewal forbidden' USING ERRCODE = '42501'; END IF;
  IF private.is_training_subject_owner(v_proposal.subject_id) THEN
    NULL; -- An athlete may request or renew a coach-assigned offer, but cannot accept it.
  ELSIF v_assignment.program_mode='self_directed'
    OR v_assignment.owning_practitioner_id IS DISTINCT FROM v_actor
    OR NOT private.is_training_subject_coach(v_proposal.subject_id,'program:coach_publish')
    OR (v_assignment.simulation_run_id IS NOT NULL
      AND NOT private.has_training_simulation_control(v_assignment.simulation_run_id))
  THEN RAISE EXCEPTION 'manual recalibration renewal forbidden' USING ERRCODE = '42501'; END IF;

  SELECT GREATEST(v_proposal.expires_at,
    COALESCE(pg_catalog.max(lifetime.expires_at),'-infinity'::timestamptz))
  INTO v_effective_expiry
  FROM public.training_manual_recalibration_proposal_lifetimes lifetime
  WHERE lifetime.proposal_id=v_proposal.id;
  IF EXISTS (SELECT 1 FROM public.training_manual_recalibration_acceptances
    WHERE proposal_id=v_proposal.id) THEN
    RETURN pg_catalog.jsonb_build_object(
      'proposalId',v_proposal.id,'status','accepted',
      'expiresAt',pg_catalog.to_char(v_effective_expiry AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  END IF;

  SELECT * INTO v_program FROM public.training_program_revisions
    WHERE assignment_id=v_assignment.id AND revision_number=v_assignment.active_revision;
  SELECT * INTO v_source FROM public.training_sessions WHERE id=v_proposal.source_session_id;
  IF v_assignment.active_revision IS DISTINCT FROM v_proposal.base_program_revision_number
    OR v_assignment.revision IS DISTINCT FROM v_proposal.base_assignment_revision
    OR v_program.program_hash IS DISTINCT FROM v_proposal.source_program_hash
    OR v_subject.current_profile_revision IS DISTINCT FROM v_proposal.source_profile_revision
    OR v_source.subject_id IS DISTINCT FROM v_proposal.subject_id
    OR v_source.assignment_id IS DISTINCT FROM v_proposal.assignment_id
    OR v_source.revision IS DISTINCT FROM v_proposal.source_session_revision
    OR v_source.state NOT IN ('completed','completed_with_omissions')
    OR v_program.program_json->'executionContext' IS DISTINCT FROM v_proposal.execution_context
  THEN RAISE EXCEPTION 'manual recalibration source changed' USING ERRCODE = 'PT409'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(v_proposal.source_session_revisions) value
    LEFT JOIN public.training_sessions source_session
      ON source_session.id=value->>'sessionId'
      AND source_session.assignment_id=v_proposal.assignment_id
      AND source_session.subject_id=v_proposal.subject_id
    WHERE source_session.id IS NULL
      OR source_session.revision IS DISTINCT FROM (value->>'revision')::bigint
      OR source_session.state NOT IN ('completed','completed_with_omissions')
  ) THEN RAISE EXCEPTION 'manual recalibration evidence changed' USING ERRCODE = 'PT409'; END IF;
  IF v_assignment.simulation_run_id IS NULL
    AND v_subject.current_eligibility_decision_source_revision_id
      IS DISTINCT FROM v_proposal.source_eligibility_revision_id
  THEN RAISE EXCEPTION 'manual recalibration eligibility changed' USING ERRCODE = 'PT409'; END IF;
  PERFORM private.assert_training_program_eligibility(
    v_proposal.subject_id,v_program.program_json,v_assignment.simulation_run_id);
  FOR v_target IN SELECT value FROM pg_catalog.jsonb_array_elements(v_proposal.target_bindings) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.training_sessions target_session
      WHERE target_session.id=v_target->>'sessionId'
        AND target_session.assignment_id=v_proposal.assignment_id
        AND target_session.subject_id=v_proposal.subject_id
        AND target_session.session_kind='strength'
        AND target_session.state='scheduled'
        AND target_session.revision=(v_target->>'sessionRevision')::bigint
        AND NOT EXISTS (SELECT 1 FROM public.training_session_prescriptions prescription
          WHERE prescription.session_id=target_session.id)
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(v_program.program_json->'sessions')
        program_session(value)
      CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(program_session.value->'exercises')
        exercise(value)
      WHERE program_session.value->>'sessionId'=v_target->>'sessionId'
        AND exercise.value->>'exerciseInstanceId'=v_target->>'exerciseInstanceId'
        AND exercise.value#>>'{progression,progressionSeriesId}'
          =v_proposal.offer_json#>>'{seriesIntent,sourceProgressionSeriesId}'
        AND (exercise.value#>>'{progression,loadEpoch}')::bigint
          =(v_proposal.offer_json#>>'{seriesIntent,sourceLoadEpoch}')::bigint
        AND exercise.value#>>'{acceptedInitialLoad,equipmentId}'
          =v_proposal.offer_json#>>'{currentLoad,equipmentId}'
        AND exercise.value#>>'{acceptedInitialLoad,loadBasis}'
          =v_proposal.offer_json#>>'{currentLoad,basis}'
        AND exercise.value#>'{acceptedInitialLoad,quantity}'
          =v_proposal.offer_json#>'{currentLoad,quantity}'
    ) THEN RAISE EXCEPTION 'manual recalibration target changed' USING ERRCODE = 'PT409'; END IF;
  END LOOP;

  IF v_effective_expiry > v_now THEN
    RETURN pg_catalog.jsonb_build_object(
      'proposalId',v_proposal.id,'status','active',
      'expiresAt',pg_catalog.to_char(v_effective_expiry AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  END IF;
  SELECT COALESCE(pg_catalog.max(renewal_number),0)+1 INTO v_renewal_number
  FROM public.training_manual_recalibration_proposal_lifetimes
  WHERE proposal_id=v_proposal.id;
  v_next_expiry := v_now+interval '1 hour';
  INSERT INTO public.training_manual_recalibration_proposal_lifetimes(
    proposal_id,renewal_number,renewed_by_user_id,renewed_at,expires_at
  ) VALUES (v_proposal.id,v_renewal_number,v_actor,v_now,v_next_expiry);
  RETURN pg_catalog.jsonb_build_object(
    'proposalId',v_proposal.id,'status','renewed',
    'expiresAt',pg_catalog.to_char(v_next_expiry AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
END;
$$;

REVOKE ALL ON FUNCTION public.renew_training_active_calibration_proposal(uuid),
  public.renew_training_manual_recalibration_proposal(uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.renew_training_active_calibration_proposal(uuid),
  public.renew_training_manual_recalibration_proposal(uuid) TO authenticated;

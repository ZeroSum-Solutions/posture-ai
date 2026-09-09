-- Retry-safe application conflict SQLSTATEs for training RPCs.
-- PostgreSQL 40001 is reserved for serialization failures and can be retried by
-- PostgREST's transaction layer. PT409 maps a deliberate business conflict to
-- HTTP 409 without transaction retries. Function bodies below are copied from
-- migrations 41000-45000 with only the quoted SQLSTATE literal changed.

CREATE OR REPLACE FUNCTION private.enforce_training_subject_evidence_pointers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.current_profile_revision IS DISTINCT FROM OLD.current_profile_revision
    AND (
      NEW.current_profile_revision IS NULL
      OR NEW.current_profile_revision <> COALESCE(OLD.current_profile_revision, 0) + 1
    )
  THEN
    RAISE EXCEPTION 'current profile pointer must advance exactly once'
      USING ERRCODE = 'PT409';
  END IF;

  IF NEW.current_eligibility_decision_source_revision_id
    IS DISTINCT FROM OLD.current_eligibility_decision_source_revision_id
    AND (
      NEW.current_eligibility_decision_source_revision_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.training_eligibility_decisions decision
        WHERE decision.subject_id = NEW.id
          AND decision.source_revision_id = NEW.current_eligibility_decision_source_revision_id
          AND decision.supersedes_source_revision_id
            IS NOT DISTINCT FROM OLD.current_eligibility_decision_source_revision_id
      )
    )
  THEN
    RAISE EXCEPTION 'current eligibility pointer must follow the supersession chain'
      USING ERRCODE = 'PT409';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_coaching_relationship_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'revoked' THEN
    RAISE EXCEPTION 'revoked coaching relationships cannot be restored'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.id <> OLD.id
    OR NEW.subject_id <> OLD.subject_id
    OR NEW.practitioner_id <> OLD.practitioner_id
    OR NEW.started_at <> OLD.started_at
    OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'coaching relationship identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'coaching relationship revision must advance exactly once'
      USING ERRCODE = 'PT409';
  END IF;
  IF NEW.status = 'revoked' AND NEW.ended_at IS NULL THEN
    RAISE EXCEPTION 'revoked coaching relationship requires an end time'
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.append_training_profile_revision(
  p_subject_id uuid,
  p_expected_revision bigint,
  p_profile_json jsonb
)
RETURNS TABLE (revision bigint, profile_hash text, hash_encoding text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subject public.training_subjects%ROWTYPE;
  v_revision bigint;
  v_profile_hash text;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt()->>'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'current AAL2 user is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_subject
  FROM public.training_subjects
  WHERE id = p_subject_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_subject.status <> 'active'
    OR v_subject.revoked_at IS NOT NULL
    OR v_subject.deleted_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'training subject is unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF v_subject.owner_user_id <> auth.uid()
    AND NOT private.is_training_subject_coach(p_subject_id, 'profile:write')
  THEN
    RAISE EXCEPTION 'profile write is not authorized' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_subject.current_profile_revision, 0) <> p_expected_revision THEN
    RAISE EXCEPTION 'profile revision changed concurrently' USING ERRCODE = 'PT409';
  END IF;

  IF private.is_valid_training_profile(p_profile_json) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'profile does not match athlete-training-profile.v1'
      USING ERRCODE = '22023';
  END IF;

  v_revision := p_expected_revision + 1;
  v_profile_hash := private.training_evidence_sha256(p_profile_json);
  INSERT INTO public.training_profile_revisions (
    subject_id, revision, schema_version, profile_json, profile_hash, hash_encoding,
    created_by_user_id
  ) VALUES (
    p_subject_id,
    v_revision,
    p_profile_json->>'schemaVersion',
    p_profile_json,
    v_profile_hash,
    'postgres-jsonb-text-utf8.v1',
    auth.uid()
  );

  UPDATE public.training_subjects
  SET current_profile_revision = v_revision
  WHERE id = p_subject_id;

  revision := v_revision;
  profile_hash := v_profile_hash;
  hash_encoding := 'postgres-jsonb-text-utf8.v1';
  RETURN NEXT;
END;
$$;

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
    OR v_subject.owner_user_id <> auth.uid()
    OR v_subject.status <> 'active'
    OR v_subject.revoked_at IS NOT NULL
    OR v_subject.deleted_at IS NOT NULL
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

CREATE OR REPLACE FUNCTION public.record_training_eligibility_decision(
  p_subject_id uuid,
  p_expected_current_source_revision_id text,
  p_decision_json jsonb
)
RETURNS TABLE (
  source_revision_id text,
  state public.training_eligibility_state,
  decision_hash text,
  hash_encoding text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subject public.training_subjects%ROWTYPE;
  v_source_kind public.training_eligibility_source_kind;
  v_constraint_set jsonb;
  v_decision_hash text;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'eligibility decision service authority is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_subject
  FROM public.training_subjects
  WHERE id = p_subject_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_subject.status <> 'active'
    OR v_subject.revoked_at IS NOT NULL
    OR v_subject.deleted_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'training subject is unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF v_subject.current_eligibility_decision_source_revision_id
    IS DISTINCT FROM p_expected_current_source_revision_id
  THEN
    RAISE EXCEPTION 'eligibility decision changed concurrently'
      USING ERRCODE = 'PT409';
  END IF;

  IF p_decision_json->>'supersededAt' IS NOT NULL THEN
    RAISE EXCEPTION 'a newly current decision cannot already be superseded'
      USING ERRCODE = '23514';
  END IF;
  IF private.is_valid_training_decision(p_decision_json) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'decision does not match eligibility-decision.v1'
      USING ERRCODE = '22023';
  END IF;

  source_revision_id := p_decision_json->>'sourceRevisionId';
  state := (p_decision_json->>'state')::public.training_eligibility_state;
  v_source_kind := (p_decision_json#>>'{source,kind}')::public.training_eligibility_source_kind;
  v_constraint_set := CASE
    WHEN pg_catalog.jsonb_typeof(p_decision_json->'constraintSet') = 'null' THEN NULL
    ELSE p_decision_json->'constraintSet'
  END;
  v_decision_hash := private.training_evidence_sha256(p_decision_json);

  INSERT INTO public.training_eligibility_decisions (
    subject_id, source_revision_id, answers_revision_id, schema_version,
    answers_schema_version, questionnaire_source_version, policy_version,
    state, scope, source_kind, source_version, reviewer_reference,
    scope_evidence_reference, effective_from, effective_until,
    supersedes_source_revision_id, constraint_set, decision_json, decision_hash,
    hash_encoding
  ) VALUES (
    p_subject_id,
    source_revision_id,
    p_decision_json->>'answersRevisionId',
    p_decision_json->>'schemaVersion',
    p_decision_json->>'answersSchemaVersion',
    p_decision_json->>'questionnaireSourceVersion',
    p_decision_json->>'policyVersion',
    state,
    (p_decision_json->>'scope')::public.training_eligibility_scope,
    v_source_kind,
    p_decision_json#>>'{source,sourceVersion}',
    p_decision_json#>>'{source,reviewerReference}',
    p_decision_json#>>'{source,scopeEvidenceReference}',
    (p_decision_json->>'effectiveFrom')::timestamptz,
    (p_decision_json->>'effectiveUntil')::timestamptz,
    p_expected_current_source_revision_id,
    v_constraint_set,
    p_decision_json,
    v_decision_hash,
    'postgres-jsonb-text-utf8.v1'
  );

  UPDATE public.training_subjects
  SET current_eligibility_decision_source_revision_id = source_revision_id
  WHERE id = p_subject_id;

  decision_hash := v_decision_hash;
  hash_encoding := 'postgres-jsonb-text-utf8.v1';
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_training_coaching_relationship(
  p_relationship_id uuid,
  p_expected_revision bigint
)
RETURNS TABLE (
  status public.training_coaching_relationship_status,
  revision bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_relationship public.coaching_relationships%ROWTYPE;
  v_subject public.training_subjects%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt()->>'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'current AAL2 user is required' USING ERRCODE = '42501';
  END IF;

  SELECT relationship.* INTO v_relationship
  FROM public.coaching_relationships relationship
  WHERE relationship.id = p_relationship_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_relationship.status <> 'active'
    OR v_relationship.ended_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'coaching relationship is unavailable' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_subject
  FROM public.training_subjects
  WHERE id = v_relationship.subject_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_subject.status <> 'active'
    OR v_subject.revoked_at IS NOT NULL
    OR v_subject.deleted_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'training subject is unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF v_subject.owner_user_id <> auth.uid()
    AND (
      v_relationship.practitioner_id <> auth.uid()
      OR NOT private.is_training_subject_coach(
        v_relationship.subject_id,
        'relationship:revoke'
      )
    )
  THEN
    RAISE EXCEPTION 'relationship revocation is not authorized'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_relationship.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'coaching relationship changed concurrently'
      USING ERRCODE = 'PT409';
  END IF;

  UPDATE public.coaching_relationships relationship
  SET status = 'revoked',
      ended_at = pg_catalog.clock_timestamp(),
      revision = relationship.revision + 1
  WHERE relationship.id = p_relationship_id
  RETURNING relationship.status, relationship.revision
  INTO status, revision;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := private.normalize_practitioner_email(NEW.email);
  v_practitioner private.practitioner_invitations%ROWTYPE;
  v_athlete private.athlete_invitations%ROWTYPE;
  v_subject_id uuid;
  v_matches integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 0));
  SELECT * INTO v_practitioner
  FROM private.practitioner_invitations invitation
  WHERE invitation.email_normalized = v_email
    AND invitation.state = 'pending' AND invitation.revoked_at IS NULL
    AND invitation.expires_at > pg_catalog.clock_timestamp()
  FOR UPDATE;
  SELECT * INTO v_athlete
  FROM private.athlete_invitations invitation
  WHERE invitation.email_normalized = v_email
    AND invitation.state = 'pending' AND invitation.revoked_at IS NULL
    AND invitation.expires_at > pg_catalog.clock_timestamp()
  FOR UPDATE;
  v_matches := CASE WHEN v_practitioner.id IS NULL THEN 0 ELSE 1 END
    + CASE WHEN v_athlete.id IS NULL THEN 0 ELSE 1 END;
  IF v_matches <> 1 THEN
    RAISE EXCEPTION 'exactly one current application invitation is required'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_practitioner.id IS NOT NULL THEN
    UPDATE private.practitioner_invitations
    SET state = 'provisioned', provisioned_user_id = NEW.id,
        provisioned_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_practitioner.id AND state = 'pending';
    INSERT INTO public.practitioners (
      id, display_name, role, access_status, invitation_id, created_at, updated_at
    ) VALUES (
      NEW.id,
      COALESCE(v_practitioner.display_name, NEW.raw_user_meta_data->>'full_name', NEW.email),
      'practitioner', 'invited', v_practitioner.id,
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
    );
    INSERT INTO private.practitioner_access_events (
      practitioner_id, invitation_id, event, actor
    ) VALUES (NEW.id, v_practitioner.id, 'invitation_provisioned', 'auth.users trigger');
    RETURN NEW;
  END IF;

  INSERT INTO public.training_subjects (owner_user_id, status, session_valid_after)
  VALUES (NEW.id, 'invited', '-infinity'::timestamptz)
  RETURNING id INTO v_subject_id;
  UPDATE private.athlete_invitations
  SET state = 'provisioned', provisioned_user_id = NEW.id,
      subject_id = v_subject_id, provisioned_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_athlete.id AND state = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'athlete invitation is no longer available' USING ERRCODE = 'PT409';
  END IF;

  IF v_athlete.mode = 'coach_invited' THEN
    PERFORM 1 FROM public.clients client
    WHERE client.id = v_athlete.target_client_id
      AND client.practitioner_id = v_athlete.issuer_practitioner_id
      AND client.deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invited client is unavailable' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.client_accounts(subject_id, client_id)
    VALUES (v_subject_id, v_athlete.target_client_id);
    INSERT INTO public.coaching_relationships(
      subject_id, practitioner_id, status, permissions, started_at, revision
    ) VALUES (
      v_subject_id, v_athlete.issuer_practitioner_id, 'active',
      v_athlete.permissions, pg_catalog.clock_timestamp(), 1
    );
  END IF;
  INSERT INTO private.athlete_access_events(subject_id, invitation_id, event, actor)
  VALUES (v_subject_id, v_athlete.id, 'invitation_provisioned', 'auth.users trigger');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_training_assignment_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
    OR NEW.program_mode IS DISTINCT FROM OLD.program_mode
    OR NEW.owning_practitioner_id IS DISTINCT FROM OLD.owning_practitioner_id
    OR NEW.simulation_run_id IS DISTINCT FROM OLD.simulation_run_id
    OR NEW.source_draft_id IS DISTINCT FROM OLD.source_draft_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'training assignment identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'ended' AND NEW.status <> 'ended' THEN
    RAISE EXCEPTION 'ended training assignment cannot be restored' USING ERRCODE = '55000';
  END IF;
  IF NEW.revision <> OLD.revision + 1 OR NEW.active_revision NOT IN (OLD.active_revision, OLD.active_revision + 1) THEN
    RAISE EXCEPTION 'training assignment changed concurrently' USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.assert_training_program_eligibility(
  p_subject_id uuid, p_program jsonb, p_simulation_run_id uuid, p_check_profile boolean DEFAULT true
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_subject public.training_subjects%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_subject FROM public.training_subjects WHERE id = p_subject_id;
  IF v_subject.status <> 'active' OR v_subject.revoked_at IS NOT NULL OR v_subject.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'training subject is unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF p_check_profile AND p_program->>'profileRevisionId' IS DISTINCT FROM v_subject.current_profile_revision::text THEN
    RAISE EXCEPTION 'training profile changed concurrently' USING ERRCODE = 'PT409';
  END IF;
  IF p_simulation_run_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.training_simulation_runs run
      WHERE run.id = p_simulation_run_id AND run.subject_id = p_subject_id
        AND run.status = 'active' AND run.expires_at > pg_catalog.clock_timestamp()
        AND ((run.created_by_user_id = auth.uid() AND private.has_training_simulation_control(run.id)) OR private.is_training_subject_owner(p_subject_id))
        AND p_program#>>'{executionContext,kind}' = 'synthetic_simulation'
        AND p_program#>>'{executionContext,simulationRunId}' = run.id::text
        AND p_program#>>'{executionContext,fixtureId}' = run.fixture_id
        AND p_program#>>'{executionContext,fixtureHash}' = run.fixture_hash
        AND p_program#>>'{executionContext,label}' IN ('Practice data', 'Simulation')
    ) THEN
      RAISE EXCEPTION 'training simulation is unavailable' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF p_program->'executionContext' IS DISTINCT FROM '{"kind":"live"}'::jsonb
      OR NOT EXISTS (
        SELECT 1 FROM public.training_eligibility_decisions decision
        JOIN public.training_eligibility_responses answers
          ON answers.subject_id = decision.subject_id AND answers.source_revision_id = decision.answers_revision_id
        WHERE decision.subject_id = p_subject_id
          AND decision.source_revision_id = v_subject.current_eligibility_decision_source_revision_id
          AND decision.source_revision_id = p_program->>'eligibilitySourceRevisionId'
          AND decision.source_kind IN ('policy_service', 'qualified_reviewer')
          AND decision.state = 'eligible_general'
          AND decision.scope = 'supported'
          AND answers.answers_json->>'adultScope' = 'confirmed_18_plus'
          AND answers.answers_json->>'requestedProgrammingScope' = 'strength_or_general_fitness'
          AND answers.answers_json#>>'{origin,kind}' = 'athlete_self_report'
          AND decision.effective_from <= pg_catalog.clock_timestamp()
          AND (decision.effective_until IS NULL OR decision.effective_until > pg_catalog.clock_timestamp())
      ) THEN
      -- The constraint vocabulary remains unvalidated. Do not turn a stored
      -- cleared_with_constraints marker into executable permission.
      RAISE EXCEPTION 'current training eligibility is unavailable' USING ERRCODE = 'P0001';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_training_session(p_session_id text, p_expected_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_session public.training_sessions%ROWTYPE;
  v_assignment public.training_program_assignments%ROWTYPE;
  v_program jsonb;
  v_prescription jsonb;
  v_scheduled jsonb;
BEGIN
  SELECT * INTO v_session FROM public.training_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR NOT private.can_read_training_assignment(v_session.assignment_id) THEN
    RAISE EXCEPTION 'training session is unavailable' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO STRICT v_assignment FROM public.training_program_assignments WHERE id = v_session.assignment_id FOR UPDATE;
  IF NOT private.is_training_subject_owner(v_session.subject_id)
    AND NOT (v_assignment.simulation_run_id IS NOT NULL
      AND v_assignment.owning_practitioner_id = auth.uid()
      AND private.has_training_simulation_control(v_assignment.simulation_run_id)
      AND private.is_training_subject_coach(v_session.subject_id, 'set_log:write')) THEN
    RAISE EXCEPTION 'training session start is not authorized' USING ERRCODE = 'P0001';
  END IF;
  SELECT prescription_json INTO v_prescription FROM public.training_session_prescriptions WHERE session_id = p_session_id;
  IF FOUND AND v_session.state = 'in_progress' THEN RETURN v_prescription; END IF;
  IF v_session.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'training session changed concurrently' USING ERRCODE = 'PT409';
  END IF;
  IF v_session.state <> 'scheduled' OR v_assignment.status <> 'active' THEN
    RAISE EXCEPTION 'training session cannot be started' USING ERRCODE = 'P0001';
  END IF;
  IF v_assignment.program_mode = 'coach_assigned' AND NOT EXISTS (
    SELECT 1 FROM public.coaching_relationships relationship
    WHERE relationship.subject_id = v_session.subject_id
      AND relationship.practitioner_id = v_assignment.owning_practitioner_id
      AND relationship.status = 'active' AND relationship.ended_at IS NULL
      AND 'program:coach_publish' = ANY(relationship.permissions::text[])
  ) THEN
    RAISE EXCEPTION 'coaching assignment has ended' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.training_subjects WHERE id = v_session.subject_id FOR UPDATE;
  SELECT program_json INTO STRICT v_program FROM public.training_program_revisions
    WHERE assignment_id = v_assignment.id AND revision_number = v_assignment.active_revision;
  PERFORM private.assert_training_program_eligibility(v_session.subject_id, v_program, v_assignment.simulation_run_id);
  IF v_session.session_kind='conditioning' THEN
    SELECT value INTO STRICT v_scheduled FROM pg_catalog.jsonb_array_elements(v_program->'conditioningBouts')
      WHERE value->>'boutId'=p_session_id;
    v_prescription:=pg_catalog.jsonb_build_object(
      'schemaVersion','training-conditioning-session-prescription.v1','sessionId',p_session_id,
      'assignmentId',v_assignment.id,'programRevisionNumber',v_assignment.active_revision,
      'subjectId',v_session.subject_id,'executionContext',v_program->'executionContext',
      'catalogOrigin',v_program->'catalogOrigin','compiledProgramRevisionId',v_program->>'compiledProgramRevisionId',
      'acceptedBout',v_scheduled
    );
  ELSE
    SELECT value INTO STRICT v_scheduled FROM pg_catalog.jsonb_array_elements(v_program->'sessions')
      WHERE value->>'sessionId' = p_session_id;
    v_prescription := pg_catalog.jsonb_build_object(
    'schemaVersion', 'training-session-prescription.v1', 'sessionId', p_session_id,
    'assignmentId', v_assignment.id, 'programRevisionNumber', v_assignment.active_revision,
    'subjectId', v_session.subject_id, 'executionContext', v_program->'executionContext',
    'scheduledLocalDate', v_scheduled->>'scheduledLocalDate', 'athleteTimezone', v_scheduled->>'athleteTimezone',
    'profileRevisionId', v_program->>'profileRevisionId', 'eligibilitySourceRevisionId', v_program->>'eligibilitySourceRevisionId',
    'compilerPolicyVersion', v_program->>'compilerPolicyVersion', 'catalogVersion', v_program->>'catalogVersion',
    'catalogOrigin', v_program->'catalogOrigin', 'compiledProgramRevisionId', v_program->>'compiledProgramRevisionId',
    'ruleVersion', v_program->>'ruleVersion', 'exercises', v_scheduled->'exercises'
  );
  END IF;
  INSERT INTO public.training_session_prescriptions (
    session_id, subject_id, assignment_id, program_revision_number, prescription_json, started_by_user_id
  ) VALUES (p_session_id, v_session.subject_id, v_assignment.id, v_assignment.active_revision, v_prescription, auth.uid());
  UPDATE public.training_sessions SET state = 'in_progress', revision = revision + 1,
    updated_at = pg_catalog.clock_timestamp() WHERE id = p_session_id;
  RETURN v_prescription;
END;
$$;

CREATE OR REPLACE FUNCTION public.write_training_set_log(
 p_session_id text,p_set_id text,p_expected_revision bigint,p_request_id uuid,p_actual jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_session public.training_sessions%ROWTYPE;
 v_assignment public.training_program_assignments%ROWTYPE;
 v_prescription jsonb;
 v_exercise jsonb;
 v_ordinal integer;
 v_previous public.training_set_log_events%ROWTYPE;
 v_receipt public.training_mutation_receipts%ROWTYPE;
 v_hash text;
 v_id uuid:=gen_random_uuid();
 v_event jsonb;
 v_result jsonb;
 v_now timestamptz:=pg_catalog.clock_timestamp();
BEGIN
 IF p_request_id IS NULL OR NOT private.is_valid_training_set_actual(p_actual) THEN
  RAISE EXCEPTION 'invalid training set actual' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_session FROM public.training_sessions WHERE id=p_session_id FOR UPDATE;
 IF NOT FOUND OR NOT private.can_write_training_session(p_session_id,'set_log:write') THEN
  RAISE EXCEPTION 'training set write is not authorized' USING ERRCODE='P0001';
 END IF;
 -- Lock request identity across sessions too. Exact retries never duplicate
 -- work; reuse with a different aggregate/payload is a visible conflict.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':'||p_request_id::text,0));
 v_hash:=private.training_evidence_sha256(pg_catalog.jsonb_build_object(
  'operation','set_log','sessionId',p_session_id,'setId',p_set_id,'expectedRevision',p_expected_revision,'actual',p_actual));
 SELECT * INTO v_receipt FROM public.training_mutation_receipts WHERE actor_user_id=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN
  IF v_receipt.request_hash<>v_hash THEN RAISE EXCEPTION 'training request ID reused with different content' USING ERRCODE='PT409'; END IF;
  RETURN v_receipt.result_json;
 END IF;
 IF v_session.revision IS DISTINCT FROM p_expected_revision THEN
  RAISE EXCEPTION 'training session changed concurrently' USING ERRCODE='PT409';
 END IF;
 SELECT prescription_json INTO v_prescription FROM public.training_session_prescriptions WHERE session_id=p_session_id;
 IF NOT FOUND OR v_session.state='scheduled' THEN
  RAISE EXCEPTION 'training session has not started' USING ERRCODE='P0001';
 END IF;
 SELECT * INTO STRICT v_assignment FROM public.training_program_assignments WHERE id=v_session.assignment_id FOR UPDATE;
 PERFORM 1 FROM public.training_subjects WHERE id=v_session.subject_id FOR UPDATE;
 PERFORM private.assert_training_program_eligibility(v_session.subject_id,v_prescription,v_assignment.simulation_run_id,false);
 SELECT exercise,ordinality::integer INTO v_exercise,v_ordinal
 FROM pg_catalog.jsonb_array_elements(v_prescription->'exercises') exercise
 CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(exercise->'setIds') WITH ORDINALITY ids(set_id,ordinality)
 WHERE ids.set_id=p_set_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'set is not in the started prescription' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_previous FROM public.training_set_log_events
 WHERE session_id=p_session_id AND set_id=p_set_id ORDER BY event_revision DESC LIMIT 1;
 IF v_previous.id IS NULL AND (v_session.state<>'in_progress' OR v_assignment.status<>'active' OR v_session.stopped_for_symptoms) THEN
  RAISE EXCEPTION 'new set actuals require an active session' USING ERRCODE='P0001';
 END IF;
 v_event:=pg_catalog.jsonb_build_object(
  'schemaVersion','training-set-log-event.v1','eventId',v_id,
  'eventType',CASE WHEN v_previous.id IS NULL THEN 'set_actual_recorded' ELSE 'set_actual_corrected' END,
  'eventRevision',COALESCE(v_previous.event_revision,0)+1,'replacesEventId',v_previous.id,
  'subjectId',v_session.subject_id,'sessionId',p_session_id,'exerciseInstanceId',v_exercise->>'exerciseInstanceId',
  'setId',p_set_id,'setKind','working','workingSetOrdinal',v_ordinal,
  'executionContext',v_prescription->'executionContext',
  'equipmentId',v_exercise#>>'{acceptedInitialLoad,equipmentId}',
  'loadBasis',v_exercise#>>'{acceptedInitialLoad,loadBasis}',
  'quantity',p_actual->'quantity','reps',p_actual->'reps','rir',p_actual->'rir','side',p_actual->>'side',
  'symptomState',p_actual->>'symptomState',
  'actor',pg_catalog.jsonb_build_object('kind',CASE WHEN private.is_training_subject_owner(v_session.subject_id) THEN 'athlete' ELSE 'coach' END,'userId',auth.uid()),
  'occurredAt',p_actual->>'occurredAt','serverAt',v_now
 );
 INSERT INTO public.training_set_log_events(id,subject_id,session_id,set_id,event_revision,replaces_event_id,actor_user_id,event_json)
 VALUES(v_id,v_session.subject_id,p_session_id,p_set_id,COALESCE(v_previous.event_revision,0)+1,v_previous.id,auth.uid(),v_event);
 UPDATE public.training_sessions SET revision=revision+1,updated_at=v_now,
  stopped_for_symptoms=stopped_for_symptoms OR p_actual->>'symptomState'='adverse_reported',
  state=CASE WHEN p_actual->>'symptomState'='adverse_reported' THEN 'aborted' ELSE state END
 WHERE id=p_session_id RETURNING * INTO v_session;
 v_result:=pg_catalog.jsonb_build_object('schemaVersion','training-mutation-ack.v1','requestId',p_request_id,
  'sessionId',p_session_id,'revision',v_session.revision,'state',v_session.state,'event',v_event);
 INSERT INTO public.training_mutation_receipts(actor_user_id,request_id,session_id,request_hash,result_json)
 VALUES(auth.uid(),p_request_id,p_session_id,v_hash,v_result);
 RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.write_training_conditioning_log(
 p_session_id text,p_expected_revision bigint,p_request_id uuid,p_actual jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_session public.training_sessions%ROWTYPE;
 v_assignment public.training_program_assignments%ROWTYPE;
 v_prescription jsonb;
 v_bout jsonb;
 v_previous public.training_conditioning_log_events%ROWTYPE;
 v_receipt public.training_mutation_receipts%ROWTYPE;
 v_hash text;
 v_id uuid:=gen_random_uuid();
 v_event jsonb;
 v_result jsonb;
 v_now timestamptz:=pg_catalog.clock_timestamp();
BEGIN
 IF p_request_id IS NULL OR NOT private.is_valid_training_conditioning_actual(p_actual) THEN
  RAISE EXCEPTION 'invalid conditioning actual' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_session FROM public.training_sessions WHERE id=p_session_id FOR UPDATE;
 IF NOT FOUND OR NOT private.can_write_training_session(p_session_id,'set_log:write') THEN
  RAISE EXCEPTION 'training conditioning write is not authorized' USING ERRCODE='P0001';
 END IF;
 -- Lock request identity across sessions too. Exact retries never duplicate
 -- work; reuse with a different aggregate/payload is a visible conflict.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':'||p_request_id::text,0));
 v_hash:=private.training_evidence_sha256(pg_catalog.jsonb_build_object(
  'operation','conditioning_log','sessionId',p_session_id,'expectedRevision',p_expected_revision,'actual',p_actual));
 SELECT * INTO v_receipt FROM public.training_mutation_receipts WHERE actor_user_id=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN
  IF v_receipt.request_hash<>v_hash THEN RAISE EXCEPTION 'training request ID reused with different content' USING ERRCODE='PT409'; END IF;
  RETURN v_receipt.result_json;
 END IF;
 IF v_session.revision IS DISTINCT FROM p_expected_revision THEN
  RAISE EXCEPTION 'training session changed concurrently' USING ERRCODE='PT409';
 END IF;
 SELECT prescription_json INTO v_prescription FROM public.training_session_prescriptions WHERE session_id=p_session_id;
 IF NOT FOUND OR v_session.state='scheduled' THEN
  RAISE EXCEPTION 'training session has not started' USING ERRCODE='P0001';
 END IF;
 SELECT * INTO STRICT v_assignment FROM public.training_program_assignments WHERE id=v_session.assignment_id FOR UPDATE;
 PERFORM 1 FROM public.training_subjects WHERE id=v_session.subject_id FOR UPDATE;
 PERFORM private.assert_training_program_eligibility(v_session.subject_id,v_prescription,v_assignment.simulation_run_id,false);
 IF v_session.session_kind<>'conditioning' OR v_prescription->>'schemaVersion'<>'training-conditioning-session-prescription.v1' THEN
  RAISE EXCEPTION 'conditioning actual requires a conditioning session' USING ERRCODE='22023';
 END IF;
 v_bout:=v_prescription->'acceptedBout';
 SELECT * INTO v_previous FROM public.training_conditioning_log_events
 WHERE session_id=p_session_id ORDER BY event_revision DESC LIMIT 1;
 IF v_previous.id IS NULL AND (v_session.state<>'in_progress' OR v_assignment.status<>'active' OR v_session.stopped_for_symptoms) THEN
  RAISE EXCEPTION 'new conditioning actuals require an active session' USING ERRCODE='P0001';
 END IF;
 v_event:=pg_catalog.jsonb_build_object(
  'schemaVersion','training-conditioning-log-event.v1','eventId',v_id,
  'eventType',CASE WHEN v_previous.id IS NULL THEN 'conditioning_actual_recorded' ELSE 'conditioning_actual_corrected' END,
  'eventRevision',COALESCE(v_previous.event_revision,0)+1,'replacesEventId',v_previous.id,
  'subjectId',v_session.subject_id,'sessionId',p_session_id,
  'boutId',v_bout->>'boutId','modalityId',v_bout->>'modalityId',
  'executionContext',v_prescription->'executionContext',
  'durationSeconds',p_actual->'durationSeconds','perceivedEffort',p_actual->'perceivedEffort',
  'symptomState',p_actual->>'symptomState',
  'actor',pg_catalog.jsonb_build_object('kind',CASE WHEN private.is_training_subject_owner(v_session.subject_id) THEN 'athlete' ELSE 'coach' END,'userId',auth.uid()),
  'occurredAt',p_actual->>'occurredAt','serverAt',v_now
 );
 INSERT INTO public.training_conditioning_log_events(id,subject_id,session_id,event_revision,replaces_event_id,actor_user_id,event_json)
 VALUES(v_id,v_session.subject_id,p_session_id,COALESCE(v_previous.event_revision,0)+1,v_previous.id,auth.uid(),v_event);
 UPDATE public.training_sessions SET revision=revision+1,updated_at=v_now,
  stopped_for_symptoms=stopped_for_symptoms OR p_actual->>'symptomState'='adverse_reported',
  state=CASE WHEN p_actual->>'symptomState'='adverse_reported' THEN 'aborted' ELSE state END
 WHERE id=p_session_id RETURNING * INTO v_session;
 v_result:=pg_catalog.jsonb_build_object('schemaVersion','training-mutation-ack.v1','requestId',p_request_id,
  'sessionId',p_session_id,'revision',v_session.revision,'state',v_session.state,'conditioningEvent',v_event);
 INSERT INTO public.training_mutation_receipts(actor_user_id,request_id,session_id,request_hash,result_json)
 VALUES(auth.uid(),p_request_id,p_session_id,v_hash,v_result);
 RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_training_session(
 p_session_id text,p_expected_revision bigint,p_request_id uuid,p_finish_mode text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_session public.training_sessions%ROWTYPE;
 v_assignment public.training_program_assignments%ROWTYPE;
 v_prescription jsonb;
 v_receipt public.training_mutation_receipts%ROWTYPE;
 v_hash text;
 v_missing integer;
 v_result jsonb;
BEGIN
 IF p_request_id IS NULL OR p_finish_mode IS NULL OR p_finish_mode NOT IN ('complete','finish_with_omissions','abort') THEN
  RAISE EXCEPTION 'invalid training completion mode' USING ERRCODE='22023';
 END IF;
 SELECT * INTO v_session FROM public.training_sessions WHERE id=p_session_id FOR UPDATE;
 IF NOT FOUND OR NOT private.can_write_training_session(p_session_id,'session:complete') THEN
  RAISE EXCEPTION 'training completion is not authorized' USING ERRCODE='P0001';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':'||p_request_id::text,0));
 v_hash:=private.training_evidence_sha256(pg_catalog.jsonb_build_object(
  'operation','complete','sessionId',p_session_id,'expectedRevision',p_expected_revision,'finishMode',p_finish_mode));
 SELECT * INTO v_receipt FROM public.training_mutation_receipts WHERE actor_user_id=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN
  IF v_receipt.request_hash<>v_hash THEN RAISE EXCEPTION 'training request ID reused with different content' USING ERRCODE='PT409'; END IF;
  RETURN v_receipt.result_json;
 END IF;
 IF v_session.revision IS DISTINCT FROM p_expected_revision THEN
  RAISE EXCEPTION 'training session changed concurrently' USING ERRCODE='PT409';
 END IF;
 IF v_session.state NOT IN ('in_progress','aborted') THEN
  RAISE EXCEPTION 'training session cannot be completed' USING ERRCODE='P0001';
 END IF;
 SELECT * INTO STRICT v_assignment FROM public.training_program_assignments WHERE id=v_session.assignment_id FOR UPDATE;
 SELECT prescription_json INTO STRICT v_prescription FROM public.training_session_prescriptions WHERE session_id=p_session_id;
 IF p_finish_mode<>'abort' AND v_session.state<>'aborted' AND NOT v_session.stopped_for_symptoms THEN
  PERFORM 1 FROM public.training_subjects WHERE id=v_session.subject_id FOR UPDATE;
  PERFORM private.assert_training_program_eligibility(v_session.subject_id,v_prescription,v_assignment.simulation_run_id,false);
 END IF;
 IF v_session.session_kind='conditioning' THEN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM public.training_conditioning_log_events WHERE session_id=p_session_id) THEN 0 ELSE 1 END INTO v_missing;
 ELSE
 SELECT count(*) INTO v_missing FROM pg_catalog.jsonb_array_elements(v_prescription->'exercises') exercise
 CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(exercise->'setIds') ids(set_id)
 WHERE NOT EXISTS (SELECT 1 FROM public.training_set_log_events event WHERE event.session_id=p_session_id AND event.set_id=ids.set_id);
 END IF;
 IF v_missing>0 AND p_finish_mode='complete' AND v_session.state<>'aborted' AND NOT v_session.stopped_for_symptoms THEN
  RAISE EXCEPTION 'training session has unlogged sets' USING ERRCODE='PT409';
 END IF;
 UPDATE public.training_sessions SET revision=revision+1,updated_at=pg_catalog.clock_timestamp(),
  state=CASE WHEN stopped_for_symptoms OR state='aborted' OR p_finish_mode='abort' THEN 'aborted'
    WHEN v_missing>0 THEN 'completed_with_omissions' ELSE 'completed' END
 WHERE id=p_session_id RETURNING * INTO v_session;
 v_result:=pg_catalog.jsonb_build_object('schemaVersion','training-mutation-ack.v1','requestId',p_request_id,
  'sessionId',p_session_id,'revision',v_session.revision,'state',v_session.state,'missingSetCount',v_missing);
 INSERT INTO public.training_mutation_receipts(actor_user_id,request_id,session_id,request_hash,result_json)
 VALUES(auth.uid(),p_request_id,p_session_id,v_hash,v_result);
 RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_training_program_build_source(
  p_subject_id uuid,
  p_profile_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_profile_revision bigint;
  v_source jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_subject_id IS NULL OR p_profile_revision IS NULL THEN
    RAISE EXCEPTION 'authenticated subject and profile revision are required'
      USING ERRCODE = '42501';
  END IF;

  SELECT subject.current_profile_revision
  INTO v_current_profile_revision
  FROM public.training_subjects subject
  WHERE subject.id = p_subject_id
    AND subject.status = 'active'
    AND subject.revoked_at IS NULL
    AND subject.deleted_at IS NULL
    AND (
      private.is_training_subject_owner(subject.id)
      OR EXISTS (
        SELECT 1
        FROM private.training_simulation_identities identity_authorization
        WHERE identity_authorization.subject_id = subject.id
          AND private.has_training_simulation_control(identity_authorization.simulation_run_id)
      )
    );

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_current_profile_revision IS DISTINCT FROM p_profile_revision THEN
    RAISE EXCEPTION 'training profile changed concurrently' USING ERRCODE = 'PT409';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'simulationRunId',simulation_run.id,
    'subjectId',simulation_run.subject_id,
    'createdByUserId',simulation_run.created_by_user_id,
    'fixtureId',simulation_run.fixture_id,
    'fixtureHash',simulation_run.fixture_hash,
    'status',simulation_run.status,
    'createdAt',simulation_run.created_at,
    'expiresAt',simulation_run.expires_at
  )
  INTO v_source
  FROM public.training_simulation_runs simulation_run
  JOIN private.training_simulation_identities identity_record
    ON identity_record.simulation_run_id = simulation_run.id
    AND identity_record.subject_id = simulation_run.subject_id
    AND identity_record.practitioner_id = simulation_run.created_by_user_id
    AND identity_record.fixture_id = simulation_run.fixture_id
    AND identity_record.fixture_hash = simulation_run.fixture_hash
    AND identity_record.expires_at = simulation_run.expires_at
  WHERE simulation_run.subject_id = p_subject_id
    AND simulation_run.fixture_id = 'synthetic-starter-catalog.v1'
    AND simulation_run.fixture_hash = 'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717'
    AND simulation_run.status = 'active'
    AND simulation_run.expires_at > pg_catalog.clock_timestamp()
    AND identity_record.permission = 'simulation:control'
    AND identity_record.state = 'active'
    AND identity_record.ended_at IS NULL
    AND (
      private.is_training_subject_owner(p_subject_id)
      OR private.has_training_simulation_control(simulation_run.id)
    );

  RETURN v_source;
END;
$$;

-- Server-compiled drafts are published by authenticated actors using only their
-- draft ID. Browser callers cannot supply or rewrite prescription JSON.
CREATE TABLE public.training_simulation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.training_subjects(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  fixture_id text NOT NULL CHECK (private.is_stable_training_reference(fixture_id, 128)),
  fixture_hash text NOT NULL CHECK (fixture_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at),
  UNIQUE (id, subject_id)
);

CREATE TABLE public.training_program_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.training_subjects(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  profile_revision bigint NOT NULL,
  simulation_run_id uuid,
  program_revision_id text NOT NULL UNIQUE CHECK (private.is_stable_training_reference(program_revision_id,128)),
  compiler_policy_version text NOT NULL,
  catalog_version text NOT NULL,
  build_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (subject_id,profile_revision)
    REFERENCES public.training_profile_revisions(subject_id,revision) ON DELETE RESTRICT,
  FOREIGN KEY (simulation_run_id,subject_id)
    REFERENCES public.training_simulation_runs(id,subject_id) ON DELETE RESTRICT,
  UNIQUE(id,subject_id),
  CHECK (expires_at>created_at),
  CHECK ((build_json->>'kind'='draft_program') IS TRUE),
  CHECK ((build_json->>'subjectId'=subject_id::text) IS TRUE),
  CHECK ((build_json->>'profileRevisionId'=profile_revision::text) IS TRUE),
  CHECK ((build_json->>'programRevisionId'=program_revision_id) IS TRUE),
  CHECK ((build_json->>'compilerPolicyVersion'=compiler_policy_version) IS TRUE),
  CHECK ((build_json->>'catalogVersion'=catalog_version) IS TRUE),
  CHECK (((simulation_run_id IS NULL AND build_json->'executionContext'='{"kind":"live"}'::jsonb)
    OR (simulation_run_id IS NOT NULL AND build_json#>>'{executionContext,kind}'='synthetic_simulation'
      AND build_json#>>'{executionContext,simulationRunId}'=simulation_run_id::text)) IS TRUE)
);

CREATE TABLE public.training_program_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.training_subjects(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  profile_revision bigint NOT NULL,
  simulation_run_id uuid,
  source_build_id uuid UNIQUE,
  selection_hash text CHECK (selection_hash ~ '^[a-f0-9]{64}$'),
  program_json jsonb NOT NULL,
  program_hash text GENERATED ALWAYS AS (private.training_evidence_sha256(program_json)) STORED,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (subject_id, profile_revision)
    REFERENCES public.training_profile_revisions(subject_id, revision) ON DELETE RESTRICT,
  FOREIGN KEY (simulation_run_id, subject_id)
    REFERENCES public.training_simulation_runs(id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_build_id,subject_id)
    REFERENCES public.training_program_builds(id,subject_id) ON DELETE RESTRICT,
  CHECK ((source_build_id IS NULL) = (selection_hash IS NULL)),
  CHECK (expires_at > created_at),
  CHECK (jsonb_typeof(program_json) = 'object'),
  CHECK ((program_json->>'schemaVersion' = 'training-program-revision.v1') IS TRUE),
  CHECK ((program_json->>'subjectId' = subject_id::text) IS TRUE),
  CHECK ((program_json->>'revisionNumber' = '1') IS TRUE),
  CHECK ((program_json->>'cycleLengthWeeks' = '8') IS TRUE),
  CHECK ((program_json->>'profileRevisionId' = profile_revision::text) IS TRUE),
  CHECK ((jsonb_typeof(program_json->'sessions') = 'array'
    AND jsonb_array_length(program_json->'sessions') BETWEEN 1 AND 64) IS TRUE),
  CHECK ((
    (simulation_run_id IS NULL AND program_json->'executionContext' = '{"kind":"live"}'::jsonb)
    OR (simulation_run_id IS NOT NULL
      AND program_json#>>'{executionContext,kind}' = 'synthetic_simulation'
      AND program_json#>>'{executionContext,simulationRunId}' = simulation_run_id::text)
  ) IS TRUE)
);

CREATE TABLE public.training_program_assignments (
  id text PRIMARY KEY CHECK (private.is_stable_training_reference(id, 128)),
  subject_id uuid NOT NULL REFERENCES public.training_subjects(id) ON DELETE RESTRICT,
  program_mode text NOT NULL CHECK (program_mode IN ('self_directed', 'coach_assigned')),
  owning_practitioner_id uuid REFERENCES public.practitioners(id) ON DELETE RESTRICT,
  simulation_run_id uuid,
  source_draft_id uuid NOT NULL UNIQUE REFERENCES public.training_program_drafts(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  active_revision bigint NOT NULL DEFAULT 1 CHECK (active_revision >= 1),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((program_mode = 'coach_assigned') = (owning_practitioner_id IS NOT NULL)),
  FOREIGN KEY (simulation_run_id, subject_id)
    REFERENCES public.training_simulation_runs(id, subject_id) ON DELETE RESTRICT,
  UNIQUE (id, subject_id)
);

CREATE TABLE public.training_program_revisions (
  assignment_id text NOT NULL,
  subject_id uuid NOT NULL,
  revision_number bigint NOT NULL CHECK (revision_number >= 1),
  program_json jsonb NOT NULL,
  program_hash text GENERATED ALWAYS AS (private.training_evidence_sha256(program_json)) STORED,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (assignment_id, revision_number),
  FOREIGN KEY (assignment_id, subject_id)
    REFERENCES public.training_program_assignments(id, subject_id) ON DELETE RESTRICT,
  CHECK ((program_json->>'assignmentId' = assignment_id) IS TRUE),
  CHECK ((program_json->>'subjectId' = subject_id::text) IS TRUE),
  CHECK ((program_json->>'revisionNumber' = revision_number::text) IS TRUE)
);

ALTER TABLE public.training_program_assignments ADD CONSTRAINT training_assignment_active_revision
  FOREIGN KEY (id, active_revision)
  REFERENCES public.training_program_revisions(assignment_id, revision_number)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.training_sessions (
  id text PRIMARY KEY CHECK (private.is_stable_training_reference(id, 128)),
  assignment_id text NOT NULL,
  subject_id uuid NOT NULL,
  session_kind text NOT NULL DEFAULT 'strength' CHECK (session_kind IN ('strength','conditioning')),
  state text NOT NULL DEFAULT 'scheduled'
    CHECK (state IN ('scheduled', 'in_progress', 'completed', 'completed_with_omissions', 'aborted')),
  scheduled_local_date date NOT NULL,
  athlete_timezone text NOT NULL CHECK (private.is_training_timezone(athlete_timezone)),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (assignment_id, subject_id)
    REFERENCES public.training_program_assignments(id, subject_id) ON DELETE RESTRICT,
  UNIQUE (id, subject_id)
);

CREATE TABLE public.training_session_prescriptions (
  session_id text PRIMARY KEY,
  subject_id uuid NOT NULL,
  assignment_id text NOT NULL,
  program_revision_number bigint NOT NULL,
  prescription_json jsonb NOT NULL,
  prescription_hash text GENERATED ALWAYS AS (private.training_evidence_sha256(prescription_json)) STORED,
  started_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (session_id, subject_id)
    REFERENCES public.training_sessions(id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id, program_revision_number)
    REFERENCES public.training_program_revisions(assignment_id, revision_number) ON DELETE RESTRICT,
  CHECK ((prescription_json->>'sessionId' = session_id) IS TRUE),
  CHECK ((prescription_json->>'subjectId' = subject_id::text) IS TRUE),
  CHECK ((prescription_json->>'assignmentId' = assignment_id) IS TRUE)
);

CREATE INDEX training_assignments_subject ON public.training_program_assignments(subject_id, status);
CREATE INDEX training_sessions_subject_date ON public.training_sessions(subject_id, scheduled_local_date);

CREATE TRIGGER training_program_drafts_immutable BEFORE UPDATE OR DELETE
  ON public.training_program_drafts FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();
CREATE TRIGGER training_program_builds_immutable BEFORE UPDATE OR DELETE
  ON public.training_program_builds FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();
CREATE TRIGGER training_program_revisions_immutable BEFORE UPDATE OR DELETE
  ON public.training_program_revisions FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();
CREATE TRIGGER training_session_prescriptions_immutable BEFORE UPDATE OR DELETE
  ON public.training_session_prescriptions FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();

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
    RAISE EXCEPTION 'training assignment changed concurrently' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER training_assignment_identity BEFORE UPDATE ON public.training_program_assignments
  FOR EACH ROW EXECUTE FUNCTION private.enforce_training_assignment_identity();
REVOKE ALL ON FUNCTION private.enforce_training_assignment_identity() FROM PUBLIC, anon, authenticated, service_role;

-- Coach simulation control is installed by the private-identity migration. Until
-- then, fail closed for coaches; an actual subject owner may use their own run.
CREATE OR REPLACE FUNCTION private.has_training_simulation_control(p_simulation_run_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT false; $$;
REVOKE ALL ON FUNCTION private.has_training_simulation_control(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.has_training_simulation_control(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.can_read_training_assignment(p_assignment_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.training_program_assignments a
    WHERE a.id = p_assignment_id
      AND (private.is_training_subject_owner(a.subject_id)
        OR private.is_training_subject_coach(a.subject_id, 'session:read'))
      AND (a.simulation_run_id IS NULL OR EXISTS (
        SELECT 1 FROM public.training_simulation_runs run
        WHERE run.id = a.simulation_run_id AND run.subject_id = a.subject_id
          AND ((run.created_by_user_id = auth.uid() AND private.has_training_simulation_control(run.id)) OR private.is_training_subject_owner(a.subject_id))
      ))
  );
$$;

ALTER TABLE public.training_simulation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_program_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_program_builds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_program_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_program_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_session_prescriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY training_simulation_runs_read ON public.training_simulation_runs FOR SELECT TO authenticated
  USING (((created_by_user_id = auth.uid() AND private.has_training_simulation_control(id)) OR private.is_training_subject_owner(subject_id))
    AND (private.is_training_subject_owner(subject_id) OR private.is_training_subject_coach(subject_id, 'session:read')));
CREATE POLICY training_program_drafts_read ON public.training_program_drafts FOR SELECT TO authenticated
  USING (created_by_user_id = auth.uid()
    AND (private.is_training_subject_owner(subject_id) OR private.is_training_subject_coach(subject_id, 'program:coach_publish')));
CREATE POLICY training_program_builds_read ON public.training_program_builds FOR SELECT TO authenticated
  USING (created_by_user_id=auth.uid()
    AND (private.is_training_subject_owner(subject_id) OR private.is_training_subject_coach(subject_id,'program:coach_publish')));
CREATE POLICY training_program_assignments_read ON public.training_program_assignments FOR SELECT TO authenticated
  USING (private.can_read_training_assignment(id));
CREATE POLICY training_program_revisions_read ON public.training_program_revisions FOR SELECT TO authenticated
  USING (private.can_read_training_assignment(assignment_id));
CREATE POLICY training_sessions_read ON public.training_sessions FOR SELECT TO authenticated
  USING (private.can_read_training_assignment(assignment_id));
CREATE POLICY training_session_prescriptions_read ON public.training_session_prescriptions FOR SELECT TO authenticated
  USING (private.can_read_training_assignment(assignment_id));

-- Draft provisioning is a trusted compiler boundary. This grant does not allow
-- service-role callers to publish, start, or rewrite athlete history.
REVOKE ALL ON public.training_simulation_runs, public.training_program_drafts,
  public.training_program_assignments, public.training_program_revisions,
  public.training_sessions, public.training_session_prescriptions FROM anon, authenticated, service_role;
GRANT SELECT ON public.training_simulation_runs, public.training_program_drafts,
  public.training_program_assignments, public.training_program_revisions,
  public.training_sessions, public.training_session_prescriptions TO authenticated, service_role;
GRANT INSERT ON public.training_simulation_runs, public.training_program_drafts TO service_role;
REVOKE ALL ON public.training_program_builds FROM anon,authenticated,service_role;
GRANT SELECT ON public.training_program_builds TO authenticated,service_role;
GRANT INSERT ON public.training_program_builds TO service_role;
-- The compiler's INSERTs execute these pure validators/hash expressions in
-- constraints and generated columns. This grants no actor or subject authority.
GRANT EXECUTE ON FUNCTION private.is_stable_training_reference(text,integer),
  private.training_evidence_sha256(jsonb) TO service_role;
REVOKE ALL ON FUNCTION private.can_read_training_assignment(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_read_training_assignment(text) TO authenticated, service_role;

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
    RAISE EXCEPTION 'training profile changed concurrently' USING ERRCODE = '40001';
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

CREATE OR REPLACE FUNCTION public.publish_training_program_draft(p_draft_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_draft public.training_program_drafts%ROWTYPE;
  v_existing text;
  v_assignment text;
  v_mode text;
  v_coach uuid;
  v_session jsonb;
BEGIN
  SELECT * INTO v_draft FROM public.training_program_drafts WHERE id = p_draft_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR v_draft.created_by_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'training draft is unavailable' USING ERRCODE = 'P0001';
  END IF;
  v_mode := v_draft.program_json->>'programMode';
  v_coach := (v_draft.program_json->>'owningPractitionerId')::uuid;
  IF NOT COALESCE((
    (v_mode = 'self_directed' AND v_coach IS NULL AND private.is_training_subject_owner(v_draft.subject_id))
    OR (v_mode = 'coach_assigned' AND v_coach = auth.uid()
      AND private.is_training_subject_coach(v_draft.subject_id, 'program:coach_publish'))
  ), false) OR v_draft.program_json#>>'{author,userId}' IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'training publication is not authorized' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_existing FROM public.training_program_assignments WHERE source_draft_id = p_draft_id;
  IF FOUND THEN RETURN v_existing; END IF;
  PERFORM 1 FROM public.training_subjects WHERE id = v_draft.subject_id FOR UPDATE;
  IF v_draft.expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'training draft expired' USING ERRCODE = 'P0001';
  END IF;
  PERFORM private.assert_training_program_eligibility(v_draft.subject_id, v_draft.program_json, v_draft.simulation_run_id);
  v_assignment := v_draft.program_json->>'assignmentId';
  INSERT INTO public.training_program_assignments (
    id, subject_id, program_mode, owning_practitioner_id, simulation_run_id, source_draft_id
  ) VALUES (v_assignment, v_draft.subject_id, v_mode, v_coach, v_draft.simulation_run_id, p_draft_id);
  INSERT INTO public.training_program_revisions (
    assignment_id, subject_id, revision_number, program_json, created_by_user_id
  ) VALUES (v_assignment, v_draft.subject_id, 1, v_draft.program_json, auth.uid());
  FOR v_session IN SELECT value FROM pg_catalog.jsonb_array_elements(v_draft.program_json->'sessions') LOOP
    INSERT INTO public.training_sessions (id, assignment_id, subject_id, scheduled_local_date, athlete_timezone)
    VALUES (v_session->>'sessionId', v_assignment, v_draft.subject_id,
      (v_session->>'scheduledLocalDate')::date, v_session->>'athleteTimezone');
  END LOOP;
  FOR v_session IN SELECT value FROM pg_catalog.jsonb_array_elements(v_draft.program_json->'conditioningBouts') LOOP
    INSERT INTO public.training_sessions (id,assignment_id,subject_id,session_kind,scheduled_local_date,athlete_timezone)
    VALUES(v_session->>'boutId',v_assignment,v_draft.subject_id,'conditioning',
      (v_session->>'scheduledLocalDate')::date,v_session->>'athleteTimezone');
  END LOOP;
  RETURN v_assignment;
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
    RAISE EXCEPTION 'training session changed concurrently' USING ERRCODE = '40001';
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

REVOKE ALL ON FUNCTION private.assert_training_program_eligibility(uuid,jsonb,uuid,boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.publish_training_program_draft(uuid), public.start_training_session(text,bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_training_program_draft(uuid), public.start_training_session(text,bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.read_training_program_projection(p_assignment_id text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object('assignment',pg_catalog.to_jsonb(assignment),'program',revision.program_json)
 FROM public.training_program_assignments assignment
 JOIN public.training_program_revisions revision
   ON revision.assignment_id=assignment.id AND revision.revision_number=assignment.active_revision
 WHERE assignment.id=p_assignment_id;
$$;
REVOKE ALL ON FUNCTION public.read_training_program_projection(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_training_program_projection(text) TO authenticated;

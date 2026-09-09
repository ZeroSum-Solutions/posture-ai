-- Bind new live compiler builds and accepted drafts to exact current profile
-- and eligibility evidence. Existing rows with neither source column populated
-- remain structurally valid with no invented evidence. Any later publication
-- still revalidates the eligibility revision already carried in program JSON.

ALTER TABLE public.training_program_builds
  ADD COLUMN eligibility_source_revision_id text;

ALTER TABLE public.training_program_drafts
  ADD COLUMN eligibility_source_revision_id text;

ALTER TABLE public.training_program_builds
  ADD CONSTRAINT training_program_builds_eligibility_subject_fkey
  FOREIGN KEY (subject_id, eligibility_source_revision_id)
  REFERENCES public.training_eligibility_decisions(subject_id, source_revision_id)
  ON DELETE RESTRICT;

ALTER TABLE public.training_program_drafts
  ADD CONSTRAINT training_program_drafts_eligibility_subject_fkey
  FOREIGN KEY (subject_id, eligibility_source_revision_id)
  REFERENCES public.training_eligibility_decisions(subject_id, source_revision_id)
  ON DELETE RESTRICT;

ALTER TABLE public.training_program_builds
  ADD CONSTRAINT training_program_builds_source_not_mixed CHECK (
    NOT (simulation_run_id IS NOT NULL AND eligibility_source_revision_id IS NOT NULL)
  ),
  ADD CONSTRAINT training_program_builds_live_source_key UNIQUE (
    id, subject_id, profile_revision, eligibility_source_revision_id
  );

ALTER TABLE public.training_program_drafts
  ADD CONSTRAINT training_program_drafts_source_not_mixed CHECK (
    NOT (simulation_run_id IS NOT NULL AND eligibility_source_revision_id IS NOT NULL)
  ),
  ADD CONSTRAINT training_program_drafts_live_build_fkey
  FOREIGN KEY (
    source_build_id, subject_id, profile_revision, eligibility_source_revision_id
  ) REFERENCES public.training_program_builds (
    id, subject_id, profile_revision, eligibility_source_revision_id
  ) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION private.is_current_live_training_eligibility(
  p_subject_id uuid,
  p_profile_revision bigint,
  p_source_revision_id text,
  p_check_current_profile boolean DEFAULT true
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.training_subjects subject
    JOIN public.training_profile_revisions profile
      ON profile.subject_id = subject.id
      AND profile.revision = p_profile_revision
    JOIN public.training_eligibility_decisions decision
      ON decision.subject_id = subject.id
      AND decision.source_revision_id = p_source_revision_id
    JOIN public.training_eligibility_responses answers
      ON answers.subject_id = decision.subject_id
      AND answers.source_revision_id = decision.answers_revision_id
    WHERE subject.id = p_subject_id
      AND subject.status = 'active'
      AND subject.revoked_at IS NULL
      AND subject.deleted_at IS NULL
      AND (
        NOT p_check_current_profile
        OR subject.current_profile_revision = p_profile_revision
      )
      AND subject.current_eligibility_decision_source_revision_id
        = p_source_revision_id
      AND profile.profile_json#>>'{origin,kind}' = 'athlete_input'
      AND decision.source_kind IN ('policy_service', 'qualified_reviewer')
      AND decision.state = 'eligible_general'
      AND decision.scope = 'supported'
      AND decision.decision_json->>'supersededAt' IS NULL
      AND decision.effective_from <= pg_catalog.clock_timestamp()
      AND (
        decision.effective_until IS NULL
        OR decision.effective_until > pg_catalog.clock_timestamp()
      )
      AND answers.answers_json#>>'{origin,kind}' = 'athlete_self_report'
      AND answers.answers_json->>'adultScope' = 'confirmed_18_plus'
      AND answers.answers_json->>'requestedProgrammingScope'
        = 'strength_or_general_fitness'
      AND NOT EXISTS (
        SELECT 1
        FROM public.training_eligibility_responses later_answers
        WHERE later_answers.subject_id = answers.subject_id
          AND later_answers.revision > answers.revision
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.resolve_training_live_program_build_source(
  p_subject_id uuid,
  p_profile_revision bigint,
  p_expected_eligibility_source_revision_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_kind text;
  v_actor_subject_id uuid;
  v_actor_access_status text;
  v_actor_session_is_current boolean;
  v_subject public.training_subjects%ROWTYPE;
  v_decision public.training_eligibility_decisions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt()->>'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'active AAL2 training actor is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT actor_kind, subject_id, access_status, session_is_current
  INTO v_actor_kind, v_actor_subject_id, v_actor_access_status,
    v_actor_session_is_current
  FROM public.current_application_actor();
  IF NOT FOUND
    OR v_actor_kind NOT IN ('athlete', 'practitioner')
    OR v_actor_access_status <> 'active'
    OR v_actor_session_is_current IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'active AAL2 training actor is required'
      USING ERRCODE = '42501';
  END IF;

  -- Resolve caller scope before loading revision pointers. An unrelated caller
  -- receives NULL regardless of whether the requested revisions are stale.
  IF v_actor_kind = 'athlete' THEN
    IF v_actor_subject_id IS DISTINCT FROM p_subject_id THEN RETURN NULL; END IF;
  ELSIF NOT private.is_training_subject_coach(
    p_subject_id,
    'program:coach_publish'
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_subject
  FROM public.training_subjects subject
  WHERE subject.id = p_subject_id
    AND subject.status = 'active'
    AND subject.revoked_at IS NULL
    AND subject.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_subject.current_profile_revision IS DISTINCT FROM p_profile_revision THEN
    RAISE EXCEPTION 'training profile changed concurrently'
      USING ERRCODE = 'PT409';
  END IF;

  IF p_expected_eligibility_source_revision_id IS NOT NULL
    AND v_subject.current_eligibility_decision_source_revision_id
      IS DISTINCT FROM p_expected_eligibility_source_revision_id
  THEN
    RAISE EXCEPTION 'training eligibility changed concurrently'
      USING ERRCODE = 'PT409';
  END IF;

  IF private.is_current_live_training_eligibility(
    p_subject_id,
    p_profile_revision,
    v_subject.current_eligibility_decision_source_revision_id
  ) IS DISTINCT FROM true
  THEN
    RETURN NULL;
  END IF;

  SELECT * INTO STRICT v_decision
  FROM public.training_eligibility_decisions decision
  WHERE decision.subject_id = p_subject_id
    AND decision.source_revision_id
      = v_subject.current_eligibility_decision_source_revision_id;

  RETURN pg_catalog.jsonb_build_object(
    'kind', 'live',
    'subjectId', p_subject_id,
    'profileRevision', p_profile_revision,
    'eligibilitySourceRevisionId', v_decision.source_revision_id,
    'policyVersion', v_decision.policy_version,
    'effectiveFrom', v_decision.effective_from,
    'effectiveUntil', v_decision.effective_until
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_training_program_source_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_build public.training_program_builds%ROWTYPE;
  v_document jsonb;
  v_row jsonb;
  v_source_build_id uuid;
BEGIN
  v_row := pg_catalog.to_jsonb(NEW);
  v_document := COALESCE(v_row->'build_json', v_row->'program_json');
  v_source_build_id := (v_row->>'source_build_id')::uuid;

  IF NEW.simulation_run_id IS NOT NULL
    AND NEW.eligibility_source_revision_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'training source evidence cannot mix live and simulation'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.simulation_run_id IS NULL
    AND NEW.eligibility_source_revision_id IS NULL
  THEN
    RAISE EXCEPTION 'new training source evidence is required'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'training_program_drafts'
    AND v_source_build_id IS NOT NULL
  THEN
    SELECT * INTO v_build
    FROM public.training_program_builds build
    WHERE build.id = v_source_build_id;
    IF NOT FOUND
      OR v_build.subject_id IS DISTINCT FROM NEW.subject_id
      OR v_build.created_by_user_id IS DISTINCT FROM NEW.created_by_user_id
      OR v_build.profile_revision IS DISTINCT FROM NEW.profile_revision
      OR v_build.simulation_run_id IS DISTINCT FROM NEW.simulation_run_id
      OR v_build.eligibility_source_revision_id
        IS DISTINCT FROM NEW.eligibility_source_revision_id
      OR v_document->>'compiledProgramRevisionId'
        IS DISTINCT FROM v_build.program_revision_id
      OR v_document->>'compilerPolicyVersion'
        IS DISTINCT FROM v_build.compiler_policy_version
      OR v_document->>'catalogVersion' IS DISTINCT FROM v_build.catalog_version
    THEN
      RAISE EXCEPTION 'accepted training draft does not match its source build'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.simulation_run_id IS NOT NULL THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'training_program_drafts' AND v_source_build_id IS NULL THEN
    RAISE EXCEPTION 'live training draft requires its exact source build'
      USING ERRCODE = '23514';
  END IF;

  -- Profile, answer, and decision writers lock this subject FOR UPDATE. Hold a
  -- compatible read lock through this insert so none can become newer between
  -- the evidence check and commit.
  PERFORM 1
  FROM public.training_subjects subject
  WHERE subject.id = NEW.subject_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'training subject is unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF v_document->'executionContext' IS DISTINCT FROM '{"kind":"live"}'::jsonb
    OR (
      TG_TABLE_NAME = 'training_program_drafts'
      AND v_document->>'eligibilitySourceRevisionId'
        IS DISTINCT FROM NEW.eligibility_source_revision_id
    )
    OR v_document#>>'{catalogOrigin,kind}' IS DISTINCT FROM 'authored_catalog'
  THEN
    RAISE EXCEPTION 'live training evidence has invalid provenance'
      USING ERRCODE = '23514';
  END IF;

  IF private.is_current_live_training_eligibility(
    NEW.subject_id,
    NEW.profile_revision,
    NEW.eligibility_source_revision_id
  ) IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'training source evidence changed concurrently'
      USING ERRCODE = 'PT409';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER training_program_builds_source_evidence_insert
  BEFORE INSERT ON public.training_program_builds
  FOR EACH ROW EXECUTE FUNCTION private.enforce_training_program_source_evidence();

CREATE TRIGGER training_program_drafts_source_evidence_insert
  BEFORE INSERT ON public.training_program_drafts
  FOR EACH ROW EXECUTE FUNCTION private.enforce_training_program_source_evidence();

-- Keep historical actual correction semantics: p_check_profile=false accepts an
-- older athlete-input profile, but live authorization always requires the exact
-- current eligibility decision. Build, publish, and start pass true.
CREATE OR REPLACE FUNCTION private.assert_training_program_eligibility(
  p_subject_id uuid,
  p_program jsonb,
  p_simulation_run_id uuid,
  p_check_profile boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subject public.training_subjects%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_subject
  FROM public.training_subjects
  WHERE id = p_subject_id
  FOR SHARE;
  IF v_subject.status <> 'active'
    OR v_subject.revoked_at IS NOT NULL
    OR v_subject.deleted_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'training subject is unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF p_check_profile
    AND p_program->>'profileRevisionId'
      IS DISTINCT FROM v_subject.current_profile_revision::text
  THEN
    RAISE EXCEPTION 'training profile changed concurrently'
      USING ERRCODE = 'PT409';
  END IF;
  IF p_simulation_run_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.training_simulation_runs run
      WHERE run.id = p_simulation_run_id
        AND run.subject_id = p_subject_id
        AND run.status = 'active'
        AND run.expires_at > pg_catalog.clock_timestamp()
        AND (
          (
            run.created_by_user_id = auth.uid()
            AND private.has_training_simulation_control(run.id)
          )
          OR private.is_training_subject_owner(p_subject_id)
        )
        AND p_program#>>'{executionContext,kind}' = 'synthetic_simulation'
        AND p_program#>>'{executionContext,simulationRunId}' = run.id::text
        AND p_program#>>'{executionContext,fixtureId}' = run.fixture_id
        AND p_program#>>'{executionContext,fixtureHash}' = run.fixture_hash
        AND p_program#>>'{executionContext,label}' IN ('Practice data', 'Simulation')
    ) THEN
      RAISE EXCEPTION 'training simulation is unavailable' USING ERRCODE = 'P0001';
    END IF;
  ELSIF p_program->>'eligibilitySourceRevisionId'
    IS DISTINCT FROM v_subject.current_eligibility_decision_source_revision_id
  THEN
    RAISE EXCEPTION 'training eligibility changed concurrently'
      USING ERRCODE = 'PT409';
  ELSIF p_program->'executionContext' IS DISTINCT FROM '{"kind":"live"}'::jsonb
    OR private.is_current_live_training_eligibility(
      p_subject_id,
      (p_program->>'profileRevisionId')::bigint,
      p_program->>'eligibilitySourceRevisionId',
      p_check_profile
    ) IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'current training eligibility is unavailable'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.is_current_live_training_eligibility(
  uuid, bigint, text, boolean
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.enforce_training_program_source_evidence()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_training_live_program_build_source(
  uuid, bigint, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_training_live_program_build_source(
  uuid, bigint, text
) TO authenticated;

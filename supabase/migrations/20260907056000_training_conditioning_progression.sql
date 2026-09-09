-- Deterministic conditioning-duration progression. The server may persist a
-- proposal only after resolving a trusted numeric effort policy. Browser
-- callers can only read candidates and explicitly accept immutable proposals.

CREATE TABLE public.training_conditioning_progression_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_key text NOT NULL UNIQUE CHECK (proposal_key ~ '^[a-f0-9]{64}$'),
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL REFERENCES public.training_subjects(id) ON DELETE RESTRICT,
  assignment_id text NOT NULL,
  base_program_revision_number bigint NOT NULL CHECK (base_program_revision_number > 0),
  base_assignment_revision bigint NOT NULL CHECK (base_assignment_revision > 0),
  source_profile_revision bigint NOT NULL CHECK (source_profile_revision > 0),
  source_eligibility_revision_id text NOT NULL
    CHECK (private.is_stable_training_reference(source_eligibility_revision_id, 160)),
  source_program_hash text NOT NULL CHECK (source_program_hash ~ '^[a-f0-9]{64}$'),
  execution_context jsonb NOT NULL,
  policy_json jsonb NOT NULL,
  source_session_revisions jsonb NOT NULL,
  mutable_target_revisions jsonb NOT NULL,
  decision_json jsonb NOT NULL,
  decision_hash text GENERATED ALWAYS AS (private.training_evidence_sha256(decision_json)) STORED,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  FOREIGN KEY (assignment_id, subject_id)
    REFERENCES public.training_program_assignments(id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id, base_program_revision_number)
    REFERENCES public.training_program_revisions(assignment_id, revision_number) ON DELETE RESTRICT,
  FOREIGN KEY (subject_id, source_profile_revision)
    REFERENCES public.training_profile_revisions(subject_id, revision) ON DELETE RESTRICT,
  CHECK ((execution_context->>'kind' IN ('live', 'synthetic_simulation')) IS TRUE),
  CHECK ((policy_json->>'schemaVersion' = 'conditioning-progression-policy.v1') IS TRUE),
  CHECK ((policy_json->>'policyVersion' = 'conditioning-duration-v1') IS TRUE),
  CHECK ((policy_json->>'modalityId' IS NOT NULL) IS TRUE),
  CHECK ((policy_json->'origin' IS NOT NULL) IS TRUE),
  CHECK ((pg_catalog.jsonb_typeof(source_session_revisions) = 'array'
    AND pg_catalog.jsonb_array_length(source_session_revisions) = 2) IS TRUE),
  CHECK ((pg_catalog.jsonb_typeof(mutable_target_revisions) = 'array'
    AND pg_catalog.jsonb_array_length(mutable_target_revisions) = 2) IS TRUE),
  CHECK ((decision_json->>'kind' = 'duration_proposal') IS TRUE),
  CHECK ((decision_json->>'status' = 'proposed') IS TRUE),
  CHECK ((decision_json->>'subjectId' = subject_id::text) IS TRUE),
  CHECK ((decision_json->>'assignmentId' = assignment_id) IS TRUE),
  CHECK (((decision_json->>'baseProgramRevisionNumber')::bigint
    = base_program_revision_number) IS TRUE),
  CHECK (((decision_json->>'sourceProfileRevision')::bigint
    = source_profile_revision) IS TRUE),
  CHECK ((decision_json->>'sourceEligibilityRevisionId'
    = source_eligibility_revision_id) IS TRUE),
  CHECK ((decision_json->'executionContext' = execution_context) IS TRUE),
  CHECK ((decision_json->'policyOrigin' = policy_json->'origin') IS TRUE),
  CHECK ((decision_json->>'policyVersion' = policy_json->>'policyVersion') IS TRUE),
  CHECK ((decision_json->'sourceSessionRevisions' = source_session_revisions) IS TRUE),
  CHECK ((decision_json->'targetBouts' IS NOT NULL) IS TRUE)
);

CREATE TABLE public.training_conditioning_progression_acceptances (
  proposal_id uuid PRIMARY KEY
    REFERENCES public.training_conditioning_progression_proposals(id) ON DELETE RESTRICT,
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
  CHECK ((result_json->>'schemaVersion' = 'conditioning-progression-acceptance.v1') IS TRUE),
  CHECK ((result_json->>'proposalId' = proposal_id::text) IS TRUE),
  CHECK ((result_json->>'assignmentId' = assignment_id) IS TRUE),
  CHECK (((result_json->>'programRevisionNumber')::bigint
    = result_program_revision_number) IS TRUE),
  CHECK ((result_json->'policyOrigin' IS NOT NULL) IS TRUE)
);

CREATE TRIGGER training_conditioning_progression_proposals_immutable
  BEFORE UPDATE OR DELETE ON public.training_conditioning_progression_proposals
  FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();
CREATE TRIGGER training_conditioning_progression_acceptances_immutable
  BEFORE UPDATE OR DELETE ON public.training_conditioning_progression_acceptances
  FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();

ALTER TABLE public.training_conditioning_progression_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_conditioning_progression_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY training_conditioning_progression_proposals_read
  ON public.training_conditioning_progression_proposals FOR SELECT TO authenticated
  USING (private.can_read_training_assignment(assignment_id));
CREATE POLICY training_conditioning_progression_acceptances_read
  ON public.training_conditioning_progression_acceptances FOR SELECT TO authenticated
  USING (private.can_read_training_assignment(assignment_id));

REVOKE ALL ON public.training_conditioning_progression_proposals,
  public.training_conditioning_progression_acceptances FROM anon, authenticated, service_role;
GRANT SELECT ON public.training_conditioning_progression_proposals,
  public.training_conditioning_progression_acceptances TO authenticated, service_role;
GRANT INSERT ON public.training_conditioning_progression_proposals TO service_role;

-- The candidate reader remains SECURITY INVOKER so all of its projections are
-- constrained by caller RLS. This narrow definer guard derives the eligibility
-- inputs from one assignment that the caller can already read; it does not
-- expose the arbitrary-input eligibility helper to browser roles.
CREATE OR REPLACE FUNCTION private.assert_readable_training_program_eligibility(
  p_assignment_id text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_assignment public.training_program_assignments%ROWTYPE;
  v_program public.training_program_revisions%ROWTYPE;
BEGIN
  IF NOT private.is_stable_training_reference(p_assignment_id, 128)
    OR NOT private.can_read_training_assignment(p_assignment_id)
  THEN
    RAISE EXCEPTION 'training assignment is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_assignment
  FROM public.training_program_assignments
  WHERE id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'training assignment is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_program
  FROM public.training_program_revisions
  WHERE assignment_id = v_assignment.id
    AND revision_number = v_assignment.active_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'training assignment is unavailable' USING ERRCODE = '42501';
  END IF;

  PERFORM private.assert_training_program_eligibility(
    v_assignment.subject_id,
    v_program.program_json,
    v_assignment.simulation_run_id
  );
END;
$$;

REVOKE ALL ON FUNCTION private.assert_readable_training_program_eligibility(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.assert_readable_training_program_eligibility(text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.read_training_conditioning_progression_candidate(
  p_session_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_source public.training_sessions%ROWTYPE;
  v_assignment public.training_program_assignments%ROWTYPE;
  v_program public.training_program_revisions%ROWTYPE;
  v_subject public.training_subjects%ROWTYPE;
  v_source_bouts jsonb;
  v_source_revisions jsonb;
  v_targets jsonb;
  v_modality text;
  v_first_target_date date;
  v_planned_week_seconds integer;
  v_source_count integer;
  v_pending_count integer;
BEGIN
  IF NOT private.is_stable_training_reference(p_session_id, 128) THEN RETURN NULL; END IF;
  SELECT * INTO v_source FROM public.training_sessions
    WHERE id = p_session_id AND session_kind = 'conditioning';
  IF NOT FOUND OR NOT private.can_read_training_assignment(v_source.assignment_id) THEN RETURN NULL; END IF;
  SELECT * INTO STRICT v_assignment FROM public.training_program_assignments
    WHERE id = v_source.assignment_id;
  SELECT * INTO STRICT v_subject FROM public.training_subjects WHERE id = v_source.subject_id;
  SELECT * INTO STRICT v_program FROM public.training_program_revisions
    WHERE assignment_id = v_assignment.id AND revision_number = v_assignment.active_revision;
  IF v_assignment.status <> 'active'
    OR v_subject.current_profile_revision IS DISTINCT FROM
      (v_program.program_json->>'profileRevisionId')::bigint THEN RETURN NULL; END IF;
  PERFORM private.assert_readable_training_program_eligibility(v_assignment.id);

  -- A finished cycle needs no source evidence to keep its targets unchanged.
  SELECT count(*)::integer INTO v_pending_count FROM (
    SELECT 1 FROM public.training_sessions future
    WHERE future.assignment_id = v_assignment.id
      AND future.session_kind = 'conditioning' AND future.state = 'scheduled'
      AND future.scheduled_local_date > v_source.scheduled_local_date
      AND NOT EXISTS (SELECT 1 FROM public.training_session_prescriptions started
        WHERE started.session_id = future.id)
    ORDER BY future.scheduled_local_date, future.id LIMIT 2
  ) pending;
  IF v_pending_count < 2 THEN
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion','conditioning-progression-candidate.v1',
      'status','no_pending_targets'
    );
  END IF;


  WITH recent AS (
    SELECT session.*, prescription.prescription_json,
      event.event_json AS actual_json
    FROM public.training_sessions session
    LEFT JOIN public.training_session_prescriptions prescription ON prescription.session_id = session.id
    LEFT JOIN LATERAL (
      SELECT log.event_json FROM public.training_conditioning_log_events log
      WHERE log.session_id = session.id ORDER BY log.event_revision DESC LIMIT 1
    ) event ON true
    WHERE session.assignment_id = v_assignment.id
      AND session.session_kind = 'conditioning'
      AND session.scheduled_local_date <= v_source.scheduled_local_date
    ORDER BY session.scheduled_local_date DESC, session.id DESC
    LIMIT 2
  ), ordered AS (
    SELECT * FROM recent ORDER BY scheduled_local_date, id
  )
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'sessionId', id, 'sessionRevision', revision,
      'boutId', prescription_json#>>'{acceptedBout,boutId}',
      'modalityId', prescription_json#>>'{acceptedBout,modalityId}',
      'scheduledLocalDate', scheduled_local_date::text, 'sessionState', state,
      'actual', CASE WHEN actual_json IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
        'eventRevision', (actual_json->>'eventRevision')::bigint,
        'durationSeconds', actual_json->'durationSeconds',
        'perceivedEffort', actual_json->'perceivedEffort',
        'symptomState', actual_json->>'symptomState'
      ) END
    ) ORDER BY scheduled_local_date, id),
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'sessionId', id, 'sessionRevision', revision,
      'conditioningEventRevision', (actual_json->>'eventRevision')::bigint
    ) ORDER BY scheduled_local_date, id)
  INTO v_source_bouts, v_source_revisions
  FROM ordered;
  v_source_count := pg_catalog.jsonb_array_length(COALESCE(v_source_bouts, '[]'::jsonb));
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(COALESCE(v_source_bouts, '[]'::jsonb)) item
    WHERE item->>'boutId' IS NULL OR item->>'modalityId' IS NULL) THEN RETURN NULL; END IF;
  IF v_source_count < 2 THEN
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion','conditioning-progression-candidate.v1',
      'status','insufficient_history'
    );
  END IF;
  v_modality := v_source_bouts#>>'{1,modalityId}';


  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'sessionId', session.id, 'sessionRevision', session.revision,
    'boutId', bout.value->>'boutId', 'modalityId', bout.value->>'modalityId',
    'scheduledLocalDate', session.scheduled_local_date::text,
    'acceptedDurationSeconds', (bout.value->>'acceptedDurationSeconds')::integer,
    'authoredMaximumDurationSeconds', 1800
  ) ORDER BY session.scheduled_local_date, session.id), min(session.scheduled_local_date)
  INTO v_targets, v_first_target_date
  FROM (
    SELECT future.* FROM public.training_sessions future
    WHERE future.assignment_id = v_assignment.id
      AND future.session_kind = 'conditioning' AND future.state = 'scheduled'
      AND future.scheduled_local_date > v_source.scheduled_local_date
      AND NOT EXISTS (SELECT 1 FROM public.training_session_prescriptions started
        WHERE started.session_id = future.id)
    ORDER BY future.scheduled_local_date, future.id LIMIT 2
  ) session
  JOIN LATERAL pg_catalog.jsonb_array_elements(v_program.program_json->'conditioningBouts') bout(value)
    ON bout.value->>'boutId' = session.id;
  IF pg_catalog.jsonb_array_length(COALESCE(v_targets, '[]'::jsonb)) <> 2 THEN RETURN NULL; END IF;

  SELECT COALESCE(sum((bout.value->>'acceptedDurationSeconds')::integer), 0)::integer
  INTO v_planned_week_seconds
  FROM pg_catalog.jsonb_array_elements(v_program.program_json->'conditioningBouts') bout(value)
  WHERE pg_catalog.date_trunc('week', (bout.value->>'scheduledLocalDate')::date)
    = pg_catalog.date_trunc('week', v_first_target_date);

  IF EXISTS (
    SELECT 1
    FROM public.training_conditioning_progression_acceptances acceptance
    JOIN public.training_conditioning_progression_proposals proposal
      ON proposal.id = acceptance.proposal_id
    WHERE proposal.assignment_id = v_assignment.id
      AND proposal.source_session_revisions = v_source_revisions
  ) THEN RETURN NULL; END IF;

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 'conditioning-progression-candidate.v1',
    'status', 'ready',
    'subjectId', v_source.subject_id, 'assignmentId', v_assignment.id,
    'assignmentRevision', v_assignment.revision,
    'baseProgramRevisionNumber', v_assignment.active_revision,
    'sourceProfileRevision', (v_program.program_json->>'profileRevisionId')::bigint,
    'sourceEligibilityRevisionId', v_program.program_json->>'eligibilitySourceRevisionId',
    'programHash', v_program.program_hash,
    'executionContext', v_program.program_json->'executionContext',
    'modalityId', v_modality, 'sourceBouts', v_source_bouts,
    'targetBouts', v_targets, 'plannedWeeklyDurationSeconds', v_planned_week_seconds
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.apply_training_conditioning_progression_proposal(
  p_program jsonb,
  p_proposal_id uuid,
  p_actor_user_id uuid,
  p_accepted_at timestamptz,
  p_decision jsonb,
  p_author_kind text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_bouts jsonb;
BEGIN
  SELECT pg_catalog.jsonb_agg(
    CASE WHEN target.value IS NULL THEN bout.value ELSE
      bout.value || pg_catalog.jsonb_build_object(
        'acceptanceId', 'conditioning-progression:' || p_proposal_id::text,
        'acceptedAt', pg_catalog.to_char(p_accepted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'acceptedByUserId', p_actor_user_id::text,
        'acceptedDurationSeconds', (target.value->>'acceptedDurationSeconds')::integer
      )
    END ORDER BY bout.ordinality
  ) INTO v_bouts
  FROM pg_catalog.jsonb_array_elements(p_program->'conditioningBouts')
    WITH ORDINALITY bout(value, ordinality)
  LEFT JOIN LATERAL (
    SELECT item.value FROM pg_catalog.jsonb_array_elements(p_decision->'targetBouts') item(value)
    WHERE item.value->>'boutId' = bout.value->>'boutId'
  ) target ON true;
  IF (SELECT count(*) FROM pg_catalog.jsonb_array_elements(p_decision->'targetBouts') target
    WHERE EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_bouts) bout
      WHERE bout->>'boutId' = target->>'boutId'
        AND bout->>'acceptedDurationSeconds' = target->>'acceptedDurationSeconds')) <> 2 THEN
    RAISE EXCEPTION 'conditioning progression target is invalid' USING ERRCODE = 'PT409';
  END IF;
  RETURN p_program || pg_catalog.jsonb_build_object(
    'revisionNumber', (p_program->>'revisionNumber')::bigint + 1,
    'publishedAt', pg_catalog.to_char(p_accepted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'author', pg_catalog.jsonb_build_object('kind', p_author_kind, 'userId', p_actor_user_id::text),
    'conditioningBouts', v_bouts
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_training_conditioning_progression_proposal(
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
  v_proposal public.training_conditioning_progression_proposals%ROWTYPE;
  v_existing public.training_conditioning_progression_acceptances%ROWTYPE;
  v_assignment public.training_program_assignments%ROWTYPE;
  v_subject public.training_subjects%ROWTYPE;
  v_program public.training_program_revisions%ROWTYPE;
  v_source jsonb;
  v_target jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_next_program jsonb;
  v_next_revision bigint;
  v_author_kind text;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL OR p_request_id IS NULL OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 conditioning progression acceptance required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_existing FROM public.training_conditioning_progression_acceptances
    WHERE actor_user_id = v_actor AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.proposal_id = p_proposal_id THEN RETURN v_existing.result_json; END IF;
    RAISE EXCEPTION 'conditioning progression request ID reused' USING ERRCODE = 'PT409';
  END IF;
  SELECT * INTO v_proposal FROM public.training_conditioning_progression_proposals
    WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'conditioning progression proposal unavailable' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.training_conditioning_progression_acceptances
    WHERE proposal_id = p_proposal_id) THEN
    RAISE EXCEPTION 'conditioning progression proposal already accepted' USING ERRCODE = 'PT409';
  END IF;

  -- Check caller scope before locking subject/session rows that the caller may
  -- not be allowed to observe. Authority is checked again after the locks.
  SELECT * INTO v_assignment FROM public.training_program_assignments
    WHERE id = v_proposal.assignment_id;
  SELECT * INTO v_subject FROM public.training_subjects WHERE id = v_proposal.subject_id;
  IF v_assignment.id IS NULL OR v_subject.id IS NULL OR v_assignment.status <> 'active' THEN
    RAISE EXCEPTION 'conditioning progression assignment unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF v_assignment.program_mode = 'self_directed' THEN
    IF NOT private.is_training_subject_owner(v_proposal.subject_id) THEN
      RAISE EXCEPTION 'conditioning progression acceptance not authorized' USING ERRCODE = '42501';
    END IF;
    v_author_kind := 'athlete';
  ELSE
    IF v_assignment.owning_practitioner_id IS DISTINCT FROM v_actor
      OR NOT private.is_training_subject_coach(v_proposal.subject_id, 'program:coach_publish')
      OR (v_assignment.simulation_run_id IS NOT NULL
        AND NOT private.has_training_simulation_control(v_assignment.simulation_run_id)) THEN
      RAISE EXCEPTION 'conditioning progression acceptance not authorized' USING ERRCODE = '42501';
    END IF;
    v_author_kind := 'coach';
  END IF;

  -- Session mutations lock the session before the assignment. Use the same
  -- order here and sort all four identities so start/log and two acceptance
  -- transactions cannot validate a target while its prescription is freezing.
  PERFORM 1 FROM public.training_sessions session
  WHERE session.id IN (
    SELECT value->>'sessionId'
    FROM pg_catalog.jsonb_array_elements(
      v_proposal.source_session_revisions || v_proposal.mutable_target_revisions
    ) item(value)
  )
  ORDER BY session.id
  FOR UPDATE;
  SELECT * INTO v_assignment FROM public.training_program_assignments
    WHERE id = v_proposal.assignment_id FOR UPDATE;
  SELECT * INTO v_subject FROM public.training_subjects
    WHERE id = v_proposal.subject_id FOR UPDATE;
  IF v_assignment.id IS NULL OR v_subject.id IS NULL OR v_assignment.status <> 'active'
    OR (v_assignment.program_mode = 'self_directed'
      AND NOT private.is_training_subject_owner(v_proposal.subject_id))
    OR (v_assignment.program_mode = 'coach_assigned' AND (
      v_assignment.owning_practitioner_id IS DISTINCT FROM v_actor
      OR NOT private.is_training_subject_coach(v_proposal.subject_id, 'program:coach_publish')
      OR (v_assignment.simulation_run_id IS NOT NULL
        AND NOT private.has_training_simulation_control(v_assignment.simulation_run_id))
    )) THEN
    RAISE EXCEPTION 'conditioning progression acceptance not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_program FROM public.training_program_revisions
    WHERE assignment_id = v_assignment.id AND revision_number = v_assignment.active_revision;
  IF v_assignment.active_revision IS DISTINCT FROM v_proposal.base_program_revision_number
    OR v_assignment.revision IS DISTINCT FROM v_proposal.base_assignment_revision
    OR v_program.program_hash IS DISTINCT FROM v_proposal.source_program_hash
    OR v_subject.current_profile_revision IS DISTINCT FROM v_proposal.source_profile_revision
    OR (v_assignment.simulation_run_id IS NULL AND
      v_subject.current_eligibility_decision_source_revision_id IS DISTINCT FROM
        v_proposal.source_eligibility_revision_id)
    OR v_program.program_json->'executionContext' IS DISTINCT FROM v_proposal.execution_context THEN
    RAISE EXCEPTION 'conditioning progression source changed' USING ERRCODE = 'PT409';
  END IF;
  PERFORM private.assert_training_program_eligibility(
    v_proposal.subject_id, v_program.program_json, v_assignment.simulation_run_id
  );

  -- The only active policy is an explicitly labeled practice fixture. Live
  -- policies require a separate versioned registry entry and are absent here.
  IF v_proposal.execution_context->>'kind' <> 'synthetic_simulation'
    OR v_proposal.execution_context->>'fixtureId' <> 'synthetic-starter-catalog.v1'
    OR v_proposal.execution_context->>'fixtureHash' <>
      'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717'
    OR v_proposal.policy_json <> pg_catalog.jsonb_build_object(
      'schemaVersion','conditioning-progression-policy.v1',
      'policyVersion','conditioning-duration-v1',
      'origin',pg_catalog.jsonb_build_object(
        'kind','synthetic_fixture','sourceVersion','conditioning-duration-policy-fixture.v1',
        'fixtureId','synthetic-conditioning-duration-policy.v1',
        'fixtureHash','bf2e3b7c8705bd50372ebad1f9ec58b2ff3456d5ba22056965311e29008f5e1f',
        'label','Synthetic conditioning duration policy for Practice data'
      ),
      'modalityId','synthetic-continuous-walking.v1','targetEffortMaximum',4,
      'maxIncreasePerBoutSeconds',120,'maxTotalWeeklyIncreaseSeconds',240,
      'maxBoutDurationSeconds',1800,'maxPlannedWeeklyDurationSeconds',3600
    ) THEN RAISE EXCEPTION 'conditioning progression policy unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.training_conditioning_progression_acceptances acceptance
    JOIN public.training_conditioning_progression_proposals prior ON prior.id = acceptance.proposal_id
    WHERE prior.assignment_id = v_assignment.id
      AND prior.source_session_revisions = v_proposal.source_session_revisions
  ) THEN RAISE EXCEPTION 'conditioning progression evidence already applied' USING ERRCODE = 'PT409'; END IF;

  FOR v_source IN SELECT value FROM pg_catalog.jsonb_array_elements(v_proposal.source_session_revisions) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.training_sessions session
      JOIN LATERAL (
        SELECT event_revision FROM public.training_conditioning_log_events event
        WHERE event.session_id = session.id ORDER BY event_revision DESC LIMIT 1
      ) event ON true
      WHERE session.id = v_source->>'sessionId' AND session.assignment_id = v_assignment.id
        AND session.subject_id = v_proposal.subject_id
        AND session.revision = (v_source->>'sessionRevision')::bigint
        AND session.state IN ('completed','completed_with_omissions')
        AND event.event_revision = (v_source->>'conditioningEventRevision')::bigint
    ) THEN RAISE EXCEPTION 'conditioning progression evidence changed' USING ERRCODE = 'PT409'; END IF;
  END LOOP;
  FOR v_target IN SELECT value FROM pg_catalog.jsonb_array_elements(v_proposal.mutable_target_revisions) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.training_sessions session
      JOIN LATERAL pg_catalog.jsonb_array_elements(v_program.program_json->'conditioningBouts') bout(value)
        ON bout.value->>'boutId' = session.id
      WHERE session.id = v_target->>'sessionId' AND session.assignment_id = v_assignment.id
        AND session.subject_id = v_proposal.subject_id AND session.session_kind = 'conditioning'
        AND session.state = 'scheduled' AND session.revision = (v_target->>'sessionRevision')::bigint
        AND bout.value->>'acceptedDurationSeconds' = v_target->>'acceptedDurationSeconds'
        AND NOT EXISTS (SELECT 1 FROM public.training_session_prescriptions prescription
          WHERE prescription.session_id = session.id)
    ) THEN RAISE EXCEPTION 'conditioning progression target changed' USING ERRCODE = 'PT409'; END IF;
  END LOOP;

  v_next_program := private.apply_training_conditioning_progression_proposal(
    v_program.program_json, v_proposal.id, v_actor, v_now, v_proposal.decision_json, v_author_kind
  );
  v_next_revision := v_assignment.active_revision + 1;
  INSERT INTO public.training_program_revisions(
    assignment_id, subject_id, revision_number, program_json, created_by_user_id, published_at
  ) VALUES (v_assignment.id, v_proposal.subject_id, v_next_revision, v_next_program, v_actor, v_now);
  UPDATE public.training_program_assignments SET active_revision = v_next_revision, revision = revision + 1
    WHERE id = v_assignment.id;
  v_result := pg_catalog.jsonb_build_object(
    'schemaVersion','conditioning-progression-acceptance.v1',
    'proposalId',v_proposal.id,'assignmentId',v_assignment.id,
    'programRevisionNumber',v_next_revision,
    'targetBoutIds',(
      SELECT pg_catalog.jsonb_agg(value->>'boutId' ORDER BY ordinality)
      FROM pg_catalog.jsonb_array_elements(v_proposal.decision_json->'targetBouts')
        WITH ORDINALITY item(value, ordinality)
    ),
    'policyVersion',v_proposal.policy_json->>'policyVersion',
    'policyOrigin',v_proposal.policy_json->'origin'
  );
  INSERT INTO public.training_conditioning_progression_acceptances(
    proposal_id, actor_user_id, request_id, request_hash, assignment_id,
    result_program_revision_number, result_json, accepted_at
  ) VALUES (
    v_proposal.id, v_actor, p_request_id,
    private.training_evidence_sha256(pg_catalog.jsonb_build_object(
      'proposalId',v_proposal.id,'requestId',p_request_id
    )), v_assignment.id, v_next_revision, v_result, v_now
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.read_training_conditioning_progression_candidate(text),
  public.accept_training_conditioning_progression_proposal(uuid, uuid),
  private.apply_training_conditioning_progression_proposal(jsonb, uuid, uuid, timestamptz, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_training_conditioning_progression_candidate(text),
  public.accept_training_conditioning_progression_proposal(uuid, uuid) TO authenticated;

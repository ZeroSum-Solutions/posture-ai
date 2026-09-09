-- Explicit conditioning mode, duration, and schedule revisions. Browser actors
-- can preview bounded selections and explicitly accept an immutable proposal;
-- catalog, policy, authority, session state, and eligibility remain server-owned.

CREATE TABLE public.training_conditioning_revision_proposals (
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
  selection_json jsonb NOT NULL,
  revision_json jsonb NOT NULL,
  target_revisions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (assignment_id, subject_id)
    REFERENCES public.training_program_assignments(id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id, base_program_revision_number)
    REFERENCES public.training_program_revisions(assignment_id, revision_number) ON DELETE RESTRICT,
  FOREIGN KEY (subject_id, source_profile_revision)
    REFERENCES public.training_profile_revisions(subject_id, revision) ON DELETE RESTRICT,
  CHECK (expires_at > created_at),
  CHECK ((execution_context->>'kind' IN ('live', 'synthetic_simulation')) IS TRUE),
  CHECK ((selection_json->>'replacementModalityId' IS NOT NULL) IS TRUE),
  CHECK ((pg_catalog.jsonb_typeof(selection_json->'futureBouts') = 'array') IS TRUE),
  CHECK ((revision_json->>'kind' = 'revision_ready') IS TRUE),
  CHECK ((revision_json->>'assignmentId' = assignment_id) IS TRUE),
  CHECK ((revision_json->>'subjectId' = subject_id::text) IS TRUE),
  CHECK (((revision_json->>'baseProgramRevisionNumber')::bigint = base_program_revision_number) IS TRUE),
  CHECK ((revision_json->'executionContext' = execution_context) IS TRUE),
  CHECK ((revision_json->>'status' = 'requires_explicit_revision_acceptance') IS TRUE),
  CHECK ((revision_json->>'frequencyChange' = 'unchanged') IS TRUE),
  CHECK ((revision_json->>'intensityChange' = 'not_automated') IS TRUE),
  CHECK ((pg_catalog.jsonb_typeof(revision_json->'replacements') = 'array'
    AND pg_catalog.jsonb_array_length(revision_json->'replacements') BETWEEN 1 AND 24) IS TRUE),
  CHECK ((pg_catalog.jsonb_typeof(target_revisions) = 'array'
    AND pg_catalog.jsonb_array_length(target_revisions)
      = pg_catalog.jsonb_array_length(revision_json->'replacements')) IS TRUE)
);

CREATE TABLE public.training_conditioning_revision_acceptances (
  proposal_id uuid PRIMARY KEY
    REFERENCES public.training_conditioning_revision_proposals(id) ON DELETE RESTRICT,
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
  CHECK ((result_json->>'schemaVersion' = 'conditioning-revision-acceptance.v1') IS TRUE),
  CHECK ((result_json->>'proposalId' = proposal_id::text) IS TRUE),
  CHECK ((result_json->>'assignmentId' = assignment_id) IS TRUE),
  CHECK (((result_json->>'programRevisionNumber')::bigint
    = result_program_revision_number) IS TRUE),
  CHECK ((result_json->>'evidenceBoundary' IN ('preserved','reset')) IS TRUE)
);

CREATE TRIGGER training_conditioning_revision_proposals_immutable
  BEFORE UPDATE OR DELETE ON public.training_conditioning_revision_proposals
  FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();
CREATE TRIGGER training_conditioning_revision_acceptances_immutable
  BEFORE UPDATE OR DELETE ON public.training_conditioning_revision_acceptances
  FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();

ALTER TABLE public.training_conditioning_revision_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_conditioning_revision_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY training_conditioning_revision_proposals_read
  ON public.training_conditioning_revision_proposals FOR SELECT TO authenticated
  USING (private.can_read_training_assignment(assignment_id));
CREATE POLICY training_conditioning_revision_acceptances_read
  ON public.training_conditioning_revision_acceptances FOR SELECT TO authenticated
  USING (private.can_read_training_assignment(assignment_id));
REVOKE ALL ON public.training_conditioning_revision_proposals,
  public.training_conditioning_revision_acceptances FROM anon, authenticated, service_role;
GRANT SELECT ON public.training_conditioning_revision_proposals,
  public.training_conditioning_revision_acceptances TO authenticated, service_role;
GRANT INSERT ON public.training_conditioning_revision_proposals TO service_role;

CREATE OR REPLACE FUNCTION public.read_training_conditioning_revision_candidate(
  p_assignment_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_assignment public.training_program_assignments%ROWTYPE;
  v_program public.training_program_revisions%ROWTYPE;
  v_subject public.training_subjects%ROWTYPE;
  v_states jsonb;
  v_timezone text;
  v_current_date date;
  v_changeable integer;
BEGIN
  IF NOT private.is_stable_training_reference(p_assignment_id, 128) THEN RETURN NULL; END IF;
  SELECT * INTO v_assignment FROM public.training_program_assignments
    WHERE id=p_assignment_id;
  IF NOT FOUND OR NOT private.can_read_training_assignment(p_assignment_id)
    OR v_assignment.status <> 'active' THEN RETURN NULL; END IF;
  SELECT * INTO STRICT v_subject FROM public.training_subjects WHERE id=v_assignment.subject_id;
  SELECT * INTO STRICT v_program FROM public.training_program_revisions
    WHERE assignment_id=v_assignment.id AND revision_number=v_assignment.active_revision;
  IF v_subject.current_profile_revision IS DISTINCT FROM
    (v_program.program_json->>'profileRevisionId')::bigint THEN RETURN NULL; END IF;
  PERFORM private.assert_readable_training_program_eligibility(v_assignment.id);

  SELECT min(value->>'athleteTimezone'), count(DISTINCT value->>'athleteTimezone')
  INTO v_timezone, v_changeable
  FROM pg_catalog.jsonb_array_elements(v_program.program_json->'conditioningBouts');
  IF v_timezone IS NULL OR v_changeable <> 1 THEN RETURN NULL; END IF;
  BEGIN
    v_current_date := (pg_catalog.clock_timestamp() AT TIME ZONE v_timezone)::date;
  EXCEPTION WHEN invalid_parameter_value THEN RETURN NULL;
  END;

  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'sessionId', session.id, 'state', session.state, 'revision', session.revision,
    'scheduledLocalDate', session.scheduled_local_date::text,
    'hasPrescription', prescription.session_id IS NOT NULL
  ) ORDER BY session.scheduled_local_date, session.id),
  count(*) FILTER (WHERE session.state='scheduled'
    AND session.scheduled_local_date >= v_current_date
    AND prescription.session_id IS NULL)::integer
  INTO v_states, v_changeable
  FROM public.training_sessions session
  LEFT JOIN public.training_session_prescriptions prescription ON prescription.session_id=session.id
  WHERE session.assignment_id=v_assignment.id AND session.session_kind='conditioning';
  IF pg_catalog.jsonb_array_length(COALESCE(v_states,'[]'::jsonb)) <>
    pg_catalog.jsonb_array_length(v_program.program_json->'conditioningBouts') THEN RETURN NULL; END IF;
  IF v_changeable=0 THEN RETURN pg_catalog.jsonb_build_object(
    'schemaVersion','conditioning-revision-candidate.v1','status','no_changeable_bouts'); END IF;

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion','conditioning-revision-candidate.v1','status','ready',
    'assignmentId',v_assignment.id,'assignmentRevision',v_assignment.revision,
    'subjectId',v_assignment.subject_id,'currentLocalDate',v_current_date::text,
    'programHash',v_program.program_hash,
    'currentProfileRevision',v_subject.current_profile_revision,
    'program',v_program.program_json,'sessionStates',v_states
  );
END;
$$;

-- Keep the released 56000 reader's complete RLS/eligibility derivation, then
-- close its evidence comparison over the new optional modality-series epoch.
ALTER FUNCTION public.read_training_conditioning_progression_candidate(text) SET SCHEMA private;
ALTER FUNCTION private.read_training_conditioning_progression_candidate(text)
  RENAME TO read_training_conditioning_progression_candidate_pre_revision_epoch;

CREATE OR REPLACE FUNCTION public.read_training_conditioning_progression_candidate(
  p_session_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  v_candidate jsonb;
  v_distinct_identity_count integer;
  v_evidence_count integer;
BEGIN
  v_candidate := private.read_training_conditioning_progression_candidate_pre_revision_epoch(p_session_id);
  IF v_candidate IS NULL OR v_candidate->>'status' <> 'ready' THEN RETURN v_candidate; END IF;

  WITH active_program AS (
    SELECT revision.program_json
    FROM public.training_program_assignments assignment
    JOIN public.training_program_revisions revision
      ON revision.assignment_id=assignment.id AND revision.revision_number=assignment.active_revision
    WHERE assignment.id=v_candidate->>'assignmentId'
  ), evidence_identity AS (
    SELECT source.value->>'modalityId' AS modality_id,
      prescription.prescription_json#>'{acceptedBout,progressionIdentity}' AS identity
    FROM pg_catalog.jsonb_array_elements(v_candidate->'sourceBouts') source(value)
    JOIN public.training_session_prescriptions prescription
      ON prescription.session_id=source.value->>'sessionId'
    UNION ALL
    SELECT target.value->>'modalityId', bout.value->'progressionIdentity'
    FROM pg_catalog.jsonb_array_elements(v_candidate->'targetBouts') target(value)
    CROSS JOIN active_program program
    JOIN LATERAL pg_catalog.jsonb_array_elements(program.program_json->'conditioningBouts') bout(value)
      ON bout.value->>'boutId'=target.value->>'boutId'
  )
  SELECT count(*), count(DISTINCT pg_catalog.jsonb_build_object(
    'modalityId',modality_id,'progressionIdentity',identity
  )) INTO v_evidence_count, v_distinct_identity_count FROM evidence_identity;
  IF v_evidence_count <> 4 OR v_distinct_identity_count <> 1 THEN
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion','conditioning-progression-candidate.v1',
      'status','insufficient_history'
    );
  END IF;
  RETURN v_candidate;
END;
$$;

CREATE OR REPLACE FUNCTION private.apply_training_conditioning_revision(
  p_program jsonb,
  p_proposal_id uuid,
  p_actor_user_id uuid,
  p_accepted_at timestamptz,
  p_revision jsonb,
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
    CASE WHEN replacement.value IS NULL THEN bout.value ELSE
      bout.value
      || pg_catalog.jsonb_build_object(
        'acceptanceId','conditioning-revision:' || p_proposal_id::text,
        'acceptedAt',pg_catalog.to_char(p_accepted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'acceptedByUserId',p_actor_user_id::text,
        'modalityId',replacement.value->>'modalityId',
        'scheduledLocalDate',replacement.value->>'scheduledLocalDate',
        'athleteTimezone',replacement.value->>'athleteTimezone',
        'acceptedDurationSeconds',(replacement.value->>'acceptedDurationSeconds')::integer,
        'effortCue',replacement.value->>'effortCue',
        'scheduleArrangement',CASE replacement.value->>'arrangement'
          WHEN 'paired_strength_first' THEN pg_catalog.jsonb_build_object(
            'kind','paired_strength_first','pairingPolicy',replacement.value->'pairingPolicy')
          ELSE pg_catalog.jsonb_build_object('kind','separate') END
      )
      || CASE WHEN replacement.value ? 'progressionIdentity'
        THEN pg_catalog.jsonb_build_object('progressionIdentity',replacement.value->'progressionIdentity')
        ELSE '{}'::jsonb END
    END ORDER BY bout.ordinality
  ) INTO v_bouts
  FROM pg_catalog.jsonb_array_elements(p_program->'conditioningBouts')
    WITH ORDINALITY bout(value,ordinality)
  LEFT JOIN LATERAL (
    SELECT item.value FROM pg_catalog.jsonb_array_elements(p_revision->'replacements') item(value)
    WHERE item.value->>'sourceBoutId'=bout.value->>'boutId'
  ) replacement ON true;
  IF (SELECT count(*) FROM pg_catalog.jsonb_array_elements(p_revision->'replacements')) <>
    (SELECT count(*) FROM pg_catalog.jsonb_array_elements(v_bouts) bout
      WHERE bout->>'acceptanceId'='conditioning-revision:' || p_proposal_id::text) THEN
    RAISE EXCEPTION 'conditioning revision target is invalid' USING ERRCODE='PT409';
  END IF;
  RETURN p_program || pg_catalog.jsonb_build_object(
    'revisionNumber',(p_program->>'revisionNumber')::bigint+1,
    'publishedAt',pg_catalog.to_char(p_accepted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'author',pg_catalog.jsonb_build_object('kind',p_author_kind,'userId',p_actor_user_id::text),
    'conditioningBouts',v_bouts
  );
END;
$$;

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
BEGIN
  IF v_actor IS NULL OR p_request_id IS NULL OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN
    RAISE EXCEPTION 'AAL2 conditioning revision acceptance required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_existing FROM public.training_conditioning_revision_acceptances
    WHERE actor_user_id=v_actor AND request_id=p_request_id;
  IF FOUND THEN
    IF v_existing.proposal_id=p_proposal_id THEN RETURN v_existing.result_json; END IF;
    RAISE EXCEPTION 'conditioning revision request ID reused' USING ERRCODE='PT409';
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

-- Erasure cleanup is attached to the existing transactional erasure context,
-- avoiding a duplicated copy of the owner-only erasure function.
CREATE OR REPLACE FUNCTION private.cleanup_training_conditioning_revisions_on_erasure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
    AND private.training_subject_erasure_context()=NEW.id THEN
    DELETE FROM public.training_conditioning_revision_acceptances acceptance
      USING public.training_conditioning_revision_proposals proposal
      WHERE acceptance.proposal_id=proposal.id AND proposal.subject_id=NEW.id;
    DELETE FROM public.training_conditioning_revision_proposals WHERE subject_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER training_conditioning_revisions_erasure_cleanup
  AFTER UPDATE OF deleted_at ON public.training_subjects
  FOR EACH ROW EXECUTE FUNCTION private.cleanup_training_conditioning_revisions_on_erasure();

REVOKE ALL ON FUNCTION public.read_training_conditioning_revision_candidate(text),
  public.read_training_conditioning_progression_candidate(text),
  public.accept_training_conditioning_revision_proposal(uuid,uuid),
  private.apply_training_conditioning_revision(jsonb,uuid,uuid,timestamptz,jsonb,text),
  private.cleanup_training_conditioning_revisions_on_erasure()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_training_conditioning_revision_candidate(text),
  public.read_training_conditioning_progression_candidate(text),
  public.accept_training_conditioning_revision_proposal(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.read_training_conditioning_progression_candidate_pre_revision_epoch(text)
  TO authenticated;

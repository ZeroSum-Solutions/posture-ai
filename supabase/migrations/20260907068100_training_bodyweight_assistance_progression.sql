-- Store and accept the dedicated rep-only progression decision for bodyweight
-- external load and machine assistance. The existing acceptance RPC remains
-- authoritative for AAL2, ownership, idempotency, locking, eligibility and
-- source/session revision checks.

CREATE OR REPLACE FUNCTION private.is_valid_training_progression_decision(
  p_decision jsonb,
  p_subject_id uuid,
  p_profile_revision bigint,
  p_eligibility_revision text,
  p_execution_context jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_load jsonb;
  v_quantity jsonb;
  v_rep jsonb;
BEGIN
  IF p_decision->>'schemaVersion'
    IS DISTINCT FROM 'bodyweight-assistance-progression-decision.v1' THEN
    RETURN COALESCE(
      p_decision->>'status' = 'proposed'
      AND p_decision->>'kind' IN ('rep_proposal','load_proposal')
      AND p_decision->>'decisionKey' IS NOT NULL
      AND p_decision->>'subjectId' = p_subject_id::text
      AND p_decision->>'sourceProfileRevisionId' = p_profile_revision::text
      AND p_decision->>'sourceEligibilityRevisionId' = p_eligibility_revision
      AND p_decision->'executionContext' = p_execution_context
      AND p_decision#>>'{proposal,load,equipmentId}' IS NOT NULL
      AND pg_catalog.jsonb_typeof(p_decision#>'{proposal,targetReps}') = 'array',
      false
    );
  END IF;

  IF COALESCE(
    NOT private.jsonb_has_exact_keys(p_decision, ARRAY[
      'schemaVersion','kind','status','reason','loadChange','preservedLoad',
      'targetReps','policyId','policyVersion','sourceExposureRevisionId'
    ])
    OR p_decision->>'kind' <> 'rep_proposal'
    OR p_decision->>'status' <> 'proposed'
    OR p_decision->>'reason' <> 'one_rep_progression'
    OR p_decision->>'loadChange' <> 'none'
    OR NOT private.is_stable_training_reference(p_decision->>'policyId',128)
    OR NOT private.is_stable_training_reference(p_decision->>'policyVersion',128)
    OR NOT private.is_stable_training_reference(p_decision->>'sourceExposureRevisionId',128)
    OR pg_catalog.jsonb_typeof(p_decision->'targetReps') <> 'array'
    OR pg_catalog.jsonb_array_length(p_decision->'targetReps') NOT BETWEEN 1 AND 20,
    true
  ) THEN RETURN false; END IF;

  FOR v_rep IN SELECT value FROM pg_catalog.jsonb_array_elements(p_decision->'targetReps') LOOP
    IF pg_catalog.jsonb_typeof(v_rep) <> 'number'
      OR (v_rep#>>'{}')::numeric <> pg_catalog.trunc((v_rep#>>'{}')::numeric)
      OR (v_rep#>>'{}')::numeric NOT BETWEEN 1 AND 100 THEN
      RETURN false;
    END IF;
  END LOOP;

  v_load := p_decision->'preservedLoad';
  IF v_load->>'loadBasis' = 'bodyweight_external' THEN
    IF NOT private.jsonb_has_exact_keys(v_load,ARRAY[
      'loadBasis','equipmentId','externalLoad'
    ]) THEN RETURN false; END IF;
    v_quantity := v_load->'externalLoad';
  ELSIF v_load->>'loadBasis' = 'machine_assistance' THEN
    IF NOT private.jsonb_has_exact_keys(v_load,ARRAY[
      'loadBasis','equipmentId','assistance'
    ]) THEN RETURN false; END IF;
    v_quantity := v_load->'assistance';
  ELSE
    RETURN false;
  END IF;

  RETURN private.is_stable_training_reference(v_load->>'equipmentId',128)
    AND private.is_exact_training_quantity(v_quantity);
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN false;
END;
$$;

DO $$
DECLARE
  v_constraints name[];
  v_name name;
BEGIN
  SELECT pg_catalog.array_agg(c.conname ORDER BY c.conname)
  INTO v_constraints
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = 'public.training_progression_proposals'::pg_catalog.regclass
    AND c.contype = 'c'
    AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%decision_json%';

  IF pg_catalog.cardinality(v_constraints) IS DISTINCT FROM 9 THEN
    RAISE EXCEPTION 'expected exactly nine legacy progression decision constraints';
  END IF;
  FOREACH v_name IN ARRAY v_constraints LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.training_progression_proposals DROP CONSTRAINT %I', v_name
    );
  END LOOP;
END;
$$;

ALTER TABLE public.training_progression_proposals
  ADD CONSTRAINT training_progression_proposals_decision_v2 CHECK (
    private.is_valid_training_progression_decision(
      decision_json,subject_id,source_profile_revision,
      source_eligibility_revision_id,execution_context
    ) IS TRUE
  ) NOT VALID;
ALTER TABLE public.training_progression_proposals
  VALIDATE CONSTRAINT training_progression_proposals_decision_v2;

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
  v_is_dedicated boolean := COALESCE(
    p_decision->>'schemaVersion' = 'bodyweight-assistance-progression-decision.v1',
    false
  );
  v_target_reps jsonb;
  v_preserved_quantity jsonb;
BEGIN
  v_target_reps := CASE WHEN v_is_dedicated THEN p_decision->'targetReps'
    ELSE p_decision#>'{proposal,targetReps}' END;
  SELECT exercise.value INTO v_target
  FROM pg_catalog.jsonb_array_elements(p_program->'sessions') program_session(value)
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(program_session.value->'exercises') exercise(value)
  WHERE program_session.value->>'sessionId' = p_target_session_id
    AND exercise.value->>'exerciseInstanceId' = p_target_exercise_instance_id;

  IF v_is_dedicated THEN
    v_preserved_quantity := CASE p_decision#>>'{preservedLoad,loadBasis}'
      WHEN 'bodyweight_external' THEN p_decision#>'{preservedLoad,externalLoad}'
      WHEN 'machine_assistance' THEN p_decision#>'{preservedLoad,assistance}'
      ELSE NULL END;
  END IF;

  IF v_target IS NULL
    OR v_target#>>'{progression,progressionSeriesId}' IS DISTINCT FROM p_progression_series_id
    OR pg_catalog.jsonb_array_length(v_target_reps)
      <> pg_catalog.jsonb_array_length(v_target->'setIds')
    OR (v_is_dedicated AND (
      p_decision#>>'{preservedLoad,equipmentId}'
        IS DISTINCT FROM v_target#>>'{acceptedInitialLoad,equipmentId}'
      OR p_decision#>>'{preservedLoad,loadBasis}'
        IS DISTINCT FROM v_target#>>'{acceptedInitialLoad,loadBasis}'
      OR v_preserved_quantity IS DISTINCT FROM v_target#>'{acceptedInitialLoad,quantity}'
      OR p_decision->>'policyId'
        IS DISTINCT FROM v_target#>>'{acceptedInitialLoad,bodyweightAssistancePolicy,policyId}'
      OR p_decision->>'policyVersion'
        IS DISTINCT FROM v_target#>>'{acceptedInitialLoad,bodyweightAssistancePolicy,policyVersion}'
    ))
    OR (NOT v_is_dedicated AND (
      p_decision#>>'{proposal,load,equipmentId}'
        IS DISTINCT FROM v_target#>>'{acceptedInitialLoad,equipmentId}'
      OR p_decision#>>'{proposal,load,basis}'
        IS DISTINCT FROM v_target#>>'{acceptedInitialLoad,loadBasis}'
    )) THEN
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
        AND (NOT v_is_dedicated OR (
          exercise.value#>'{acceptedInitialLoad,quantity}' = v_target#>'{acceptedInitialLoad,quantity}'
          AND exercise.value#>'{acceptedInitialLoad,bodyweightAssistancePolicy}'
            = v_target#>'{acceptedInitialLoad,bodyweightAssistancePolicy}'
        ))
        THEN exercise.value
          || pg_catalog.jsonb_build_object('targetReps', v_target_reps)
          || CASE WHEN v_is_dedicated THEN '{}'::jsonb ELSE pg_catalog.jsonb_build_object(
            'progression', exercise.value->'progression' || pg_catalog.jsonb_build_object(
              'loadEpoch', (exercise.value#>>'{progression,loadEpoch}')::bigint
                + CASE WHEN p_decision->>'kind' = 'load_proposal' THEN 1 ELSE 0 END
            )
          ) END
          || CASE WHEN NOT v_is_dedicated AND p_decision->>'kind' = 'load_proposal' THEN
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

  RETURN p_program || pg_catalog.jsonb_build_object(
    'revisionNumber', (p_program->>'revisionNumber')::bigint + 1,
    'publishedAt', pg_catalog.to_char(p_accepted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'author', pg_catalog.jsonb_build_object('kind', p_author_kind, 'userId', p_actor_user_id::text),
    'sessions', v_sessions
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.expected_training_bodyweight_assistance_reps(
  p_proposal public.training_progression_proposals
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_program jsonb;
  v_target jsonb;
  v_source_session_id text;
  v_source_session_state text;
  v_source_stopped boolean;
  v_source_exercise jsonb;
  v_source_prescription jsonb;
  v_set_ids jsonb;
  v_event record;
  v_expected jsonb := '[]'::jsonb;
  v_ordinal integer := 0;
  v_incremented boolean := false;
  v_rep integer;
  v_max integer;
  v_min integer;
  v_min_rir integer;
  v_quantity jsonb;
BEGIN
  IF p_proposal.decision_json->>'schemaVersion'
    <> 'bodyweight-assistance-progression-decision.v1' THEN RETURN NULL; END IF;

  SELECT revision.program_json INTO v_program
  FROM public.training_program_revisions revision
  WHERE revision.assignment_id = p_proposal.assignment_id
    AND revision.revision_number = p_proposal.base_program_revision_number;
  SELECT exercise.value INTO v_target
  FROM pg_catalog.jsonb_array_elements(v_program->'sessions') session(value)
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(session.value->'exercises') exercise(value)
  WHERE session.value->>'sessionId' = p_proposal.target_session_id
    AND exercise.value->>'exerciseInstanceId' = p_proposal.target_exercise_instance_id;
  IF v_target IS NULL THEN RETURN NULL; END IF;

  SELECT source_session.id, source_session.state, source_session.stopped_for_symptoms,
    prescription.prescription_json, source_exercise.value
  INTO v_source_session_id, v_source_session_state, v_source_stopped,
    v_source_prescription, v_source_exercise
  FROM pg_catalog.jsonb_array_elements(p_proposal.source_session_revisions) source_binding(value)
  JOIN public.training_sessions source_session
    ON source_session.id = source_binding.value->>'sessionId'
    AND source_session.assignment_id = p_proposal.assignment_id
    AND source_session.subject_id = p_proposal.subject_id
    AND source_session.revision = (source_binding.value->>'revision')::bigint
  JOIN public.training_session_prescriptions prescription
    ON prescription.session_id = source_session.id
  JOIN public.training_session_progression_metadata metadata
    ON metadata.session_id = source_session.id
    AND metadata.progression_series_id = p_proposal.progression_series_id
  JOIN LATERAL pg_catalog.jsonb_array_elements(prescription.prescription_json->'exercises')
    source_exercise(value)
    ON source_exercise.value->>'exerciseInstanceId' = metadata.exercise_instance_id
  ORDER BY prescription.started_at DESC, source_session.id DESC
  LIMIT 1;

  IF v_source_session_id IS NULL
    OR v_source_session_state NOT IN ('completed','completed_with_omissions')
    OR v_source_stopped
    OR v_source_exercise->>'exerciseVersionId' IS DISTINCT FROM v_target->>'exerciseVersionId'
    OR v_source_exercise#>>'{acceptedInitialLoad,equipmentId}'
      IS DISTINCT FROM v_target#>>'{acceptedInitialLoad,equipmentId}'
    OR v_source_exercise#>>'{acceptedInitialLoad,loadBasis}'
      IS DISTINCT FROM v_target#>>'{acceptedInitialLoad,loadBasis}'
    OR v_source_exercise#>'{acceptedInitialLoad,quantity}'
      IS DISTINCT FROM v_target#>'{acceptedInitialLoad,quantity}'
    OR v_source_exercise#>'{acceptedInitialLoad,bodyweightAssistancePolicy}'
      IS DISTINCT FROM v_target#>'{acceptedInitialLoad,bodyweightAssistancePolicy}'
    OR v_source_exercise->'progression' IS DISTINCT FROM v_target->'progression'
    OR v_source_exercise->'repRange' IS DISTINCT FROM v_target->'repRange'
    OR v_source_exercise->'targetRir' IS DISTINCT FROM v_target->'targetRir'
    OR pg_catalog.jsonb_array_length(v_source_exercise->'setIds')
      IS DISTINCT FROM pg_catalog.jsonb_array_length(v_target->'setIds') THEN
    RETURN NULL;
  END IF;

  v_set_ids := v_source_exercise->'setIds';
  v_min := (v_target#>>'{repRange,minimum}')::integer;
  v_max := (v_target#>>'{repRange,maximum}')::integer;
  v_min_rir := (v_target#>>'{targetRir,minimum}')::integer;
  v_quantity := v_target#>'{acceptedInitialLoad,quantity}';

  FOR v_event IN
    SELECT actual.set_id, actual.event_json
    FROM public.training_current_set_actuals actual
    WHERE actual.session_id = v_source_session_id
      AND actual.event_json->>'exerciseInstanceId'
        = v_source_exercise->>'exerciseInstanceId'
    ORDER BY (actual.event_json->>'workingSetOrdinal')::integer
  LOOP
    v_ordinal := v_ordinal + 1;
    IF v_event.set_id IS DISTINCT FROM v_set_ids->>(v_ordinal - 1)
      OR v_event.event_json->>'setKind' <> 'working'
      OR (v_event.event_json->>'workingSetOrdinal')::integer <> v_ordinal
      OR v_event.event_json->>'symptomState' <> 'none'
      OR pg_catalog.jsonb_typeof(v_event.event_json->'rir') <> 'number'
      OR (v_event.event_json->>'rir')::integer < v_min_rir
      OR v_event.event_json->'quantity' IS DISTINCT FROM v_quantity
      OR v_event.event_json->>'equipmentId'
        IS DISTINCT FROM v_target#>>'{acceptedInitialLoad,equipmentId}'
      OR v_event.event_json->>'loadBasis'
        IS DISTINCT FROM v_target#>>'{acceptedInitialLoad,loadBasis}'
      OR v_event.event_json->'executionContext' IS DISTINCT FROM p_proposal.execution_context
      OR v_event.event_json->>'side' IS DISTINCT FROM v_target#>>'{progression,side}'
      OR pg_catalog.jsonb_typeof(v_event.event_json->'reps') <> 'number' THEN
      RETURN NULL;
    END IF;
    v_rep := (v_event.event_json->>'reps')::integer;
    IF v_rep NOT BETWEEN v_min AND v_max THEN RETURN NULL; END IF;
    IF NOT v_incremented AND v_rep < v_max THEN
      v_rep := v_rep + 1;
      v_incremented := true;
    END IF;
    v_expected := v_expected || pg_catalog.jsonb_build_array(v_rep);
  END LOOP;

  IF v_ordinal <> pg_catalog.jsonb_array_length(v_set_ids) OR NOT v_incremented THEN
    RETURN NULL;
  END IF;
  RETURN v_expected;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_training_bodyweight_assistance_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_proposal public.training_progression_proposals%ROWTYPE;
  v_expected jsonb;
BEGIN
  SELECT * INTO v_proposal FROM public.training_progression_proposals
  WHERE id = NEW.proposal_id;
  IF NOT FOUND OR v_proposal.decision_json->>'schemaVersion'
    IS DISTINCT FROM 'bodyweight-assistance-progression-decision.v1' THEN
    RETURN NEW;
  END IF;
  v_expected := private.expected_training_bodyweight_assistance_reps(v_proposal);
  IF v_expected IS NULL OR v_expected IS DISTINCT FROM v_proposal.decision_json->'targetReps' THEN
    RAISE EXCEPTION 'bodyweight or assistance progression evidence changed'
      USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER training_progression_acceptance_bodyweight_assistance
  BEFORE INSERT ON public.training_progression_acceptances
  FOR EACH ROW EXECUTE FUNCTION private.enforce_training_bodyweight_assistance_acceptance();

REVOKE ALL ON FUNCTION private.is_valid_training_progression_decision(jsonb,uuid,bigint,text,jsonb),
  private.expected_training_bodyweight_assistance_reps(public.training_progression_proposals),
  private.enforce_training_bodyweight_assistance_acceptance()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
-- The proposal table grants INSERT only to service_role. Its CHECK constraint
-- therefore needs this validator callable by that writer, without exposing the
-- evidence/apply helpers or proposal insertion to browser roles.
GRANT EXECUTE ON FUNCTION private.is_valid_training_progression_decision(
  jsonb,uuid,bigint,text,jsonb
) TO service_role;

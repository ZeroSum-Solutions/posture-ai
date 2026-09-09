-- Explicit harder-setting recalibration after a server-derived too-easy decision for an active immutable program.
-- Offers are server-built. Acceptance changes only future scheduled,
-- unprescribed targets and starts a new progression series/load epoch.

CREATE OR REPLACE FUNCTION private.is_valid_training_manual_recalibration_offer(
  p_targets jsonb,
  p_offer jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target jsonb;
  v_option jsonb;
  v_current jsonb := p_offer->'currentLoad';
  v_basis text := p_offer#>>'{currentLoad,basis}';
  v_current_kg numeric;
  v_option_kg numeric;
BEGIN
  IF COALESCE(
    pg_catalog.jsonb_typeof(p_targets) <> 'array'
    OR pg_catalog.jsonb_array_length(p_targets) NOT BETWEEN 1 AND 64
    OR pg_catalog.jsonb_typeof(p_offer) <> 'object'
    OR NOT private.jsonb_has_exact_keys(p_offer - 'bodyweightAssistancePolicy', ARRAY[
      'schemaVersion','kind','status','sourceBindings','currentLoad','seriesIntent','options'
    ])
    OR p_offer->>'schemaVersion' <> 'manual-recalibration-offer.v1'
    OR p_offer->>'kind' <> 'options'
    OR p_offer->>'status' <> 'requires_explicit_selection'
    OR NOT private.jsonb_has_exact_keys(v_current, ARRAY['equipmentId','basis','quantity'])
    OR NOT private.is_stable_training_reference(v_current->>'equipmentId',128)
    OR v_basis NOT IN (
      'barbell_total','dumbbell_per_hand','dumbbell_single_implement',
      'machine_stack','bodyweight_external','machine_assistance'
    )
    OR NOT private.is_exact_training_quantity(v_current->'quantity')
    OR pg_catalog.jsonb_typeof(p_offer->'options') <> 'array'
    OR pg_catalog.jsonb_array_length(p_offer->'options') NOT BETWEEN 1 AND 50000
    OR NOT private.jsonb_has_exact_keys(p_offer->'seriesIntent', ARRAY[
      'kind','reason','sourceProgressionSeriesId','sourceLoadEpoch','nextLoadEpoch'
    ])
    OR p_offer#>>'{seriesIntent,kind}' <> 'new_series_on_acceptance'
    OR p_offer#>>'{seriesIntent,reason}' <> 'explicit_too_easy_recalibration'
    OR NOT private.is_stable_training_reference(
      p_offer#>>'{seriesIntent,sourceProgressionSeriesId}',128)
    OR pg_catalog.jsonb_typeof(p_offer#>'{seriesIntent,sourceLoadEpoch}') <> 'number'
    OR pg_catalog.jsonb_typeof(p_offer#>'{seriesIntent,nextLoadEpoch}') <> 'number'
    OR (p_offer#>>'{seriesIntent,sourceLoadEpoch}')::numeric
      <> pg_catalog.trunc((p_offer#>>'{seriesIntent,sourceLoadEpoch}')::numeric)
    OR (p_offer#>>'{seriesIntent,nextLoadEpoch}')::numeric
      <> pg_catalog.trunc((p_offer#>>'{seriesIntent,nextLoadEpoch}')::numeric)
    OR (p_offer#>>'{seriesIntent,sourceLoadEpoch}')::bigint NOT BETWEEN 0 AND 9007199254740990
    OR (p_offer#>>'{seriesIntent,nextLoadEpoch}')::bigint
      <> (p_offer#>>'{seriesIntent,sourceLoadEpoch}')::bigint + 1,
    true
  ) THEN RETURN false; END IF;

  IF (v_basis IN ('bodyweight_external','machine_assistance'))
      IS DISTINCT FROM (p_offer ? 'bodyweightAssistancePolicy')
    OR (p_offer ? 'bodyweightAssistancePolicy' AND COALESCE(
      NOT private.jsonb_has_exact_keys(p_offer->'bodyweightAssistancePolicy',ARRAY[
        'policyId','policyVersion'
      ])
      OR NOT private.is_stable_training_reference(
        p_offer#>>'{bodyweightAssistancePolicy,policyId}',128)
      OR NOT private.is_stable_training_reference(
        p_offer#>>'{bodyweightAssistancePolicy,policyVersion}',128),
      true
    ))
  THEN RETURN false; END IF;

  IF COALESCE(
    NOT private.jsonb_has_exact_keys(p_offer->'sourceBindings', ARRAY[
      'subjectId','assignmentId','sourceProgramRevisionNumber','sourceProgramHash',
      'sourceProfileRevisionId','sourceEligibilityRevisionId','executionContext',
      'catalogVersion','catalogOrigin','target','exerciseVersionId',
      'priorProgressionSeriesId','priorLoadEpoch','sourceDecision'
    ])
    OR NOT private.jsonb_has_exact_keys(p_offer#>'{sourceBindings,target}', ARRAY[
      'sessionId','exerciseInstanceId','sessionState','prescriptionState'
    ])
    OR p_offer#>>'{sourceBindings,target,sessionState}' <> 'scheduled'
    OR p_offer#>>'{sourceBindings,target,prescriptionState}' <> 'unprescribed'
    OR NOT private.is_stable_training_reference(
      p_offer#>>'{sourceBindings,target,sessionId}',128)
    OR NOT private.is_stable_training_reference(
      p_offer#>>'{sourceBindings,target,exerciseInstanceId}',128)
    OR NOT private.is_stable_training_reference(
      p_offer#>>'{sourceBindings,exerciseVersionId}',128)
    OR p_offer#>>'{sourceBindings,priorProgressionSeriesId}'
      <> p_offer#>>'{seriesIntent,sourceProgressionSeriesId}'
    OR p_offer#>>'{sourceBindings,priorLoadEpoch}'
      <> p_offer#>>'{seriesIntent,sourceLoadEpoch}'
    OR p_targets->0->>'sessionId'
      <> p_offer#>>'{sourceBindings,target,sessionId}'
    OR p_targets->0->>'exerciseInstanceId'
      <> p_offer#>>'{sourceBindings,target,exerciseInstanceId}',
    true
  ) THEN RETURN false; END IF;

  IF COALESCE(
    NOT private.jsonb_has_exact_keys(p_offer#>'{sourceBindings,sourceDecision}', ARRAY[
      'decisionIdentity','reason','sourceSessionId','sourceExerciseInstanceId',
      'sourceSessionRevision','sourceSessionState','sourceExposureRevisionIds',
      'lastComparableActualLoad'
    ])
    OR NOT private.is_stable_training_reference(
      p_offer#>>'{sourceBindings,sourceDecision,decisionIdentity}',160)
    OR p_offer#>>'{sourceBindings,sourceDecision,reason}' <> 'effort_too_easy_recalibration'
    OR NOT private.is_stable_training_reference(
      p_offer#>>'{sourceBindings,sourceDecision,sourceSessionId}',128)
    OR NOT private.is_stable_training_reference(
      p_offer#>>'{sourceBindings,sourceDecision,sourceExerciseInstanceId}',128)
    OR pg_catalog.jsonb_typeof(p_offer#>'{sourceBindings,sourceDecision,sourceSessionRevision}') <> 'number'
    OR (p_offer#>>'{sourceBindings,sourceDecision,sourceSessionRevision}')::numeric
      <> pg_catalog.trunc((p_offer#>>'{sourceBindings,sourceDecision,sourceSessionRevision}')::numeric)
    OR (p_offer#>>'{sourceBindings,sourceDecision,sourceSessionRevision}')::bigint <= 0
    OR p_offer#>>'{sourceBindings,sourceDecision,sourceSessionState}'
      NOT IN ('completed','completed_with_omissions')
    OR pg_catalog.jsonb_typeof(p_offer#>'{sourceBindings,sourceDecision,sourceExposureRevisionIds}') <> 'array'
    OR pg_catalog.jsonb_array_length(p_offer#>'{sourceBindings,sourceDecision,sourceExposureRevisionIds}') NOT BETWEEN 1 AND 64
    OR EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements_text(
        p_offer#>'{sourceBindings,sourceDecision,sourceExposureRevisionIds}'
      ) revision_id WHERE NOT private.is_stable_training_reference(revision_id,160)
    )
    OR NOT private.jsonb_has_exact_keys(
      p_offer#>'{sourceBindings,sourceDecision,lastComparableActualLoad}',
      ARRAY['equipmentId','basis','quantity']
    )
    OR p_offer#>>'{sourceBindings,sourceDecision,lastComparableActualLoad,equipmentId}'
      <> v_current->>'equipmentId'
    OR p_offer#>>'{sourceBindings,sourceDecision,lastComparableActualLoad,basis}' <> v_basis
    OR NOT private.is_exact_training_quantity(
      p_offer#>'{sourceBindings,sourceDecision,lastComparableActualLoad,quantity}')
    OR p_offer#>>'{sourceBindings,sourceDecision,lastComparableActualLoad,quantity,entered,unit}'
      <> v_current#>>'{quantity,entered,unit}',
    true
  ) THEN RETURN false; END IF;

  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(p_targets))
      <> (SELECT pg_catalog.count(DISTINCT (value->>'sessionId',value->>'exerciseInstanceId'))
          FROM pg_catalog.jsonb_array_elements(p_targets))
    OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(p_offer->'options'))
      <> (SELECT pg_catalog.count(DISTINCT value->>'optionIndex')
          FROM pg_catalog.jsonb_array_elements(p_offer->'options'))
  THEN RETURN false; END IF;

  FOR v_target IN SELECT value FROM pg_catalog.jsonb_array_elements(p_targets) LOOP
    IF COALESCE(
      NOT private.jsonb_has_exact_keys(v_target,ARRAY[
        'sessionId','sessionRevision','exerciseInstanceId','scheduledLocalDate'
      ])
      OR NOT private.is_stable_training_reference(v_target->>'sessionId',128)
      OR NOT private.is_stable_training_reference(v_target->>'exerciseInstanceId',128)
      OR pg_catalog.jsonb_typeof(v_target->'sessionRevision') <> 'number'
      OR (v_target->>'sessionRevision')::numeric
        <> pg_catalog.trunc((v_target->>'sessionRevision')::numeric)
      OR (v_target->>'sessionRevision')::bigint <= 0
      OR (v_target->>'scheduledLocalDate')::date::text
        IS DISTINCT FROM v_target->>'scheduledLocalDate',
      true
    ) THEN RETURN false; END IF;
  END LOOP;

  v_current_kg := (v_current#>>'{quantity,canonicalKg}')::numeric;
  FOR v_option IN SELECT value FROM pg_catalog.jsonb_array_elements(p_offer->'options') LOOP
    IF COALESCE(
      NOT private.jsonb_has_exact_keys(v_option,ARRAY[
        'equipmentId','basis','quantity','optionIndex','harderDirection','confirmation'
      ])
      OR v_option->>'equipmentId' <> v_current->>'equipmentId'
      OR v_option->>'basis' <> v_basis
      OR NOT private.is_exact_training_quantity(v_option->'quantity')
      OR pg_catalog.jsonb_typeof(v_option->'optionIndex') <> 'number'
      OR (v_option->>'optionIndex')::numeric
        <> pg_catalog.trunc((v_option->>'optionIndex')::numeric)
      OR (v_option->>'optionIndex')::integer NOT BETWEEN 0 AND 49999
      OR v_option->>'harderDirection' <> CASE v_basis
        WHEN 'machine_assistance' THEN 'lower_machine_assistance'
        ELSE 'higher_resistance_or_external_load' END,
      true
    ) THEN RETURN false; END IF;
    v_option_kg := (v_option#>>'{quantity,canonicalKg}')::numeric;
    IF COALESCE(
      NOT private.jsonb_has_exact_keys(v_option->'confirmation',ARRAY[
        'explicitSelectionRequired','outlierDisposition'
      ])
      OR v_option#>'{confirmation,explicitSelectionRequired}' <> 'true'::jsonb
      OR v_option#>>'{confirmation,outlierDisposition}' <> CASE
        WHEN v_basis = 'machine_assistance' THEN 'not_applicable_to_assistance'
        WHEN (p_offer#>>'{sourceBindings,sourceDecision,lastComparableActualLoad,quantity,canonicalKg}')::numeric = 0
          THEN 'zero_prior_requires_calibration_confirmation'
        WHEN v_option_kg >
          (p_offer#>>'{sourceBindings,sourceDecision,lastComparableActualLoad,quantity,canonicalKg}')::numeric * 1.2
          THEN 'greater_than_20_percent_acknowledgement_required'
        ELSE 'within_20_percent' END,
      true
    ) THEN RETURN false; END IF;
    IF (v_basis = 'machine_assistance' AND v_option_kg >= v_current_kg)
      OR (v_basis <> 'machine_assistance' AND v_option_kg <= v_current_kg)
    THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN data_exception OR invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION private.is_valid_training_manual_recalibration_offer(jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.is_valid_training_manual_recalibration_offer(jsonb,jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION private.is_valid_training_manual_recalibration_sources(p_sources jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    pg_catalog.jsonb_typeof(p_sources) = 'array'
    AND pg_catalog.jsonb_array_length(p_sources) BETWEEN 1 AND 64
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(p_sources))
      = (SELECT pg_catalog.count(DISTINCT value->>'sessionId')
        FROM pg_catalog.jsonb_array_elements(p_sources))
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p_sources) value
      WHERE NOT private.jsonb_has_exact_keys(value,ARRAY['sessionId','revision'])
        OR NOT private.is_stable_training_reference(value->>'sessionId',128)
        OR pg_catalog.jsonb_typeof(value->'revision') <> 'number'
        OR (value->>'revision')::numeric <> pg_catalog.trunc((value->>'revision')::numeric)
        OR (value->>'revision')::bigint <= 0
    ), false)
$$;
REVOKE ALL ON FUNCTION private.is_valid_training_manual_recalibration_sources(jsonb)
  FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.is_valid_training_manual_recalibration_sources(jsonb) TO service_role;

CREATE TABLE public.training_manual_recalibration_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_key text NOT NULL UNIQUE CHECK (proposal_key ~ '^[a-f0-9]{64}$'),
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL REFERENCES public.training_subjects(id) ON DELETE RESTRICT,
  assignment_id text NOT NULL,
  base_program_revision_number bigint NOT NULL CHECK (base_program_revision_number > 0),
  base_assignment_revision bigint NOT NULL CHECK (base_assignment_revision > 0),
  source_session_id text NOT NULL,
  source_exercise_instance_id text NOT NULL
    CHECK (private.is_stable_training_reference(source_exercise_instance_id, 128)),
  source_session_revision bigint NOT NULL CHECK (source_session_revision > 0),
  source_session_revisions jsonb NOT NULL,
  source_profile_revision bigint NOT NULL CHECK (source_profile_revision > 0),
  source_eligibility_revision_id text NOT NULL
    CHECK (private.is_stable_training_reference(source_eligibility_revision_id, 160)),
  source_program_hash text NOT NULL CHECK (source_program_hash ~ '^[a-f0-9]{64}$'),
  execution_context jsonb NOT NULL,
  catalog_version text NOT NULL CHECK (private.is_stable_training_reference(catalog_version, 128)),
  catalog_origin jsonb NOT NULL,
  target_bindings jsonb NOT NULL,
  offer_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (assignment_id, subject_id)
    REFERENCES public.training_program_assignments(id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id, base_program_revision_number)
    REFERENCES public.training_program_revisions(assignment_id, revision_number) ON DELETE RESTRICT,
  FOREIGN KEY (source_session_id, subject_id)
    REFERENCES public.training_sessions(id, subject_id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id, source_profile_revision)
    REFERENCES public.training_profile_revisions(subject_id, revision) ON DELETE RESTRICT,
  CHECK (expires_at > created_at),
  CHECK ((private.is_valid_training_manual_recalibration_sources(source_session_revisions)) IS TRUE),
  CHECK ((execution_context->>'kind' IN ('live', 'synthetic_simulation')) IS TRUE),
  CHECK ((private.is_valid_training_manual_recalibration_offer(target_bindings,offer_json)) IS TRUE),
  CHECK ((offer_json->>'schemaVersion' = 'manual-recalibration-offer.v1'
    AND offer_json#>>'{sourceBindings,subjectId}' = subject_id::text
    AND offer_json#>>'{sourceBindings,assignmentId}' = assignment_id
    AND (offer_json#>>'{sourceBindings,sourceProgramRevisionNumber}')::bigint = base_program_revision_number
    AND offer_json#>>'{sourceBindings,sourceProgramHash}' = source_program_hash
    AND offer_json#>>'{sourceBindings,sourceProfileRevisionId}' = source_profile_revision::text
    AND offer_json#>>'{sourceBindings,sourceEligibilityRevisionId}' = source_eligibility_revision_id
    AND offer_json#>'{sourceBindings,executionContext}' = execution_context
    AND offer_json#>>'{sourceBindings,catalogVersion}' = catalog_version
    AND offer_json#>'{sourceBindings,catalogOrigin}' = catalog_origin
    AND offer_json#>>'{sourceBindings,sourceDecision,sourceSessionId}' = source_session_id
    AND offer_json#>>'{sourceBindings,sourceDecision,sourceExerciseInstanceId}' = source_exercise_instance_id
    AND (offer_json#>>'{sourceBindings,sourceDecision,sourceSessionRevision}')::bigint = source_session_revision
    AND offer_json#>>'{sourceBindings,priorProgressionSeriesId}'
      = offer_json#>>'{seriesIntent,sourceProgressionSeriesId}'
    AND (offer_json#>>'{seriesIntent,nextLoadEpoch}')::bigint
      = (offer_json#>>'{seriesIntent,sourceLoadEpoch}')::bigint + 1) IS TRUE)
);

CREATE TABLE public.training_manual_recalibration_acceptances (
  proposal_id uuid PRIMARY KEY
    REFERENCES public.training_manual_recalibration_proposals(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  option_index integer NOT NULL CHECK (option_index BETWEEN 0 AND 49999),
  outlier_acknowledged boolean NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  assignment_id text NOT NULL,
  result_program_revision_number bigint NOT NULL CHECK (result_program_revision_number > 1),
  result_json jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (actor_user_id, request_id),
  FOREIGN KEY (assignment_id, result_program_revision_number)
    REFERENCES public.training_program_revisions(assignment_id, revision_number) ON DELETE RESTRICT,
  CHECK ((result_json->>'schemaVersion' = 'manual-recalibration-acceptance.v1'
    AND result_json->>'proposalId' = proposal_id::text
    AND result_json->>'assignmentId' = assignment_id
    AND (result_json->>'programRevisionNumber')::bigint = result_program_revision_number) IS TRUE)
);

CREATE INDEX training_manual_recalibration_proposals_assignment_created
  ON public.training_manual_recalibration_proposals(assignment_id, created_at DESC);

CREATE TRIGGER training_manual_recalibration_proposals_immutable
  BEFORE UPDATE OR DELETE ON public.training_manual_recalibration_proposals
  FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();
CREATE TRIGGER training_manual_recalibration_acceptances_immutable
  BEFORE UPDATE OR DELETE ON public.training_manual_recalibration_acceptances
  FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();

ALTER TABLE public.training_manual_recalibration_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_manual_recalibration_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY training_manual_recalibration_proposals_read
  ON public.training_manual_recalibration_proposals FOR SELECT TO authenticated
  USING (private.can_read_training_assignment(assignment_id));
CREATE POLICY training_manual_recalibration_acceptances_read
  ON public.training_manual_recalibration_acceptances FOR SELECT TO authenticated
  USING (private.can_read_training_assignment(assignment_id));

REVOKE ALL ON public.training_manual_recalibration_proposals,
  public.training_manual_recalibration_acceptances FROM anon, authenticated, service_role;
GRANT SELECT ON public.training_manual_recalibration_proposals,
  public.training_manual_recalibration_acceptances TO authenticated, service_role;
GRANT INSERT ON public.training_manual_recalibration_proposals TO service_role;

CREATE OR REPLACE FUNCTION private.apply_training_manual_recalibration(
  p_program jsonb,
  p_proposal_id uuid,
  p_actor_user_id uuid,
  p_accepted_at timestamptz,
  p_selected jsonb,
  p_targets jsonb,
  p_source_series_id text,
  p_source_load_epoch bigint,
  p_next_load_epoch bigint,
  p_new_series_id text,
  p_author_kind text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_sessions jsonb;
BEGIN
  IF p_next_load_epoch IS DISTINCT FROM p_source_load_epoch + 1
    OR NOT private.is_stable_training_reference(p_new_series_id, 128)
    OR p_new_series_id = p_source_series_id
  THEN RAISE EXCEPTION 'manual recalibration series is invalid' USING ERRCODE = 'PT409'; END IF;

  SELECT pg_catalog.jsonb_agg(
    program_session.value || pg_catalog.jsonb_build_object('exercises', (
      SELECT pg_catalog.jsonb_agg(
        CASE WHEN EXISTS (
          SELECT 1 FROM pg_catalog.jsonb_array_elements(p_targets) target(value)
          WHERE target.value->>'sessionId' = program_session.value->>'sessionId'
            AND target.value->>'exerciseInstanceId' = exercise.value->>'exerciseInstanceId'
        ) THEN exercise.value
          || pg_catalog.jsonb_build_object('progression',
            exercise.value->'progression' || pg_catalog.jsonb_build_object(
              'progressionSeriesId', p_new_series_id,
              'loadEpoch', p_next_load_epoch
            )
          )
          || pg_catalog.jsonb_build_object('acceptedInitialLoad',
            exercise.value->'acceptedInitialLoad' || pg_catalog.jsonb_build_object(
              'acceptanceId', 'manual-recalibration:' || p_proposal_id::text,
              'acceptedAt', pg_catalog.to_char(p_accepted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
              'acceptedByUserId', p_actor_user_id::text,
              'quantity', p_selected->'quantity'
            )
          )
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

CREATE OR REPLACE FUNCTION public.accept_training_manual_recalibration_proposal(
  p_proposal_id uuid,
  p_request_id uuid,
  p_option_index integer,
  p_outlier_acknowledged boolean
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
  v_existing public.training_manual_recalibration_acceptances%ROWTYPE;
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
    OR p_outlier_acknowledged IS NULL
  THEN RAISE EXCEPTION 'invalid manual recalibration acceptance' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_proposal FROM public.training_manual_recalibration_proposals
    WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'manual recalibration proposal unavailable' USING ERRCODE = 'P0001'; END IF;

  PERFORM 1 FROM public.training_sessions locked_session
  WHERE locked_session.id IN (
    SELECT value->>'sessionId' FROM pg_catalog.jsonb_array_elements(v_proposal.source_session_revisions) value
    UNION
    SELECT value->>'sessionId' FROM pg_catalog.jsonb_array_elements(v_proposal.target_bindings) value
  ) ORDER BY locked_session.id FOR UPDATE OF locked_session;
  SELECT * INTO v_assignment FROM public.training_program_assignments
    WHERE id = v_proposal.assignment_id FOR UPDATE;
  SELECT * INTO v_subject FROM public.training_subjects
    WHERE id = v_proposal.subject_id FOR UPDATE;
  IF v_assignment.id IS NULL OR v_subject.id IS NULL
    OR v_assignment.subject_id <> v_proposal.subject_id OR v_assignment.status <> 'active'
  THEN RAISE EXCEPTION 'manual recalibration acceptance forbidden' USING ERRCODE = '42501'; END IF;
  IF v_assignment.program_mode = 'self_directed' THEN
    IF NOT private.is_training_subject_owner(v_proposal.subject_id) THEN
      RAISE EXCEPTION 'manual recalibration acceptance forbidden' USING ERRCODE = '42501';
    END IF;
    v_author_kind := 'athlete';
  ELSE
    IF v_assignment.owning_practitioner_id IS DISTINCT FROM v_actor
      OR NOT private.is_training_subject_coach(v_proposal.subject_id, 'program:coach_publish')
      OR (v_assignment.simulation_run_id IS NOT NULL
        AND NOT private.has_training_simulation_control(v_assignment.simulation_run_id))
    THEN RAISE EXCEPTION 'manual recalibration acceptance forbidden' USING ERRCODE = '42501'; END IF;
    v_author_kind := 'coach';
  END IF;
  v_request_hash := private.training_evidence_sha256(pg_catalog.jsonb_build_object(
    'proposalId', p_proposal_id, 'requestId', p_request_id, 'optionIndex', p_option_index,
    'outlierAcknowledged', p_outlier_acknowledged
  ));
  SELECT * INTO v_existing FROM public.training_manual_recalibration_acceptances
    WHERE actor_user_id = v_actor AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash = v_request_hash THEN RETURN v_existing.result_json; END IF;
    RAISE EXCEPTION 'manual recalibration request ID reused with different selection' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (SELECT 1 FROM public.training_manual_recalibration_acceptances
    WHERE proposal_id = p_proposal_id) THEN
    RAISE EXCEPTION 'manual recalibration proposal already accepted' USING ERRCODE = 'PT409';
  END IF;

  IF v_proposal.expires_at <= v_now THEN
    RAISE EXCEPTION 'manual recalibration proposal expired' USING ERRCODE = 'PT409';
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
  THEN RAISE EXCEPTION 'manual recalibration source changed' USING ERRCODE = 'PT409'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(v_proposal.source_session_revisions) value
    LEFT JOIN public.training_sessions source_session
      ON source_session.id = value->>'sessionId'
      AND source_session.assignment_id = v_proposal.assignment_id
      AND source_session.subject_id = v_proposal.subject_id
    WHERE source_session.id IS NULL
      OR source_session.revision IS DISTINCT FROM (value->>'revision')::bigint
      OR source_session.state NOT IN ('completed','completed_with_omissions')
  ) THEN RAISE EXCEPTION 'manual recalibration evidence changed' USING ERRCODE = 'PT409'; END IF;
  IF v_assignment.simulation_run_id IS NULL
    AND v_subject.current_eligibility_decision_source_revision_id
      IS DISTINCT FROM v_proposal.source_eligibility_revision_id
  THEN RAISE EXCEPTION 'manual recalibration eligibility changed' USING ERRCODE = 'PT409'; END IF;
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
  THEN RAISE EXCEPTION 'manual recalibration option unavailable' USING ERRCODE = 'PT409'; END IF;
  IF v_selected#>>'{confirmation,outlierDisposition}'
      = 'greater_than_20_percent_acknowledgement_required'
      AND NOT p_outlier_acknowledged
  THEN RAISE EXCEPTION 'manual recalibration outlier acknowledgement required' USING ERRCODE = 'PT409'; END IF;

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
    ) THEN RAISE EXCEPTION 'manual recalibration target changed' USING ERRCODE = 'PT409'; END IF;
  END LOOP;

  v_new_series_id := 'manual-recalibration:' || p_proposal_id::text;
  v_next_program := private.apply_training_manual_recalibration(
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
    'schemaVersion','manual-recalibration-acceptance.v1',
    'proposalId',v_proposal.id,'assignmentId',v_assignment.id,
    'programRevisionNumber',v_next_revision,'executionContext',v_proposal.execution_context,
    'selectedLoad',pg_catalog.jsonb_build_object(
      'equipmentId',v_selected->>'equipmentId','basis',v_selected->>'basis','quantity',v_selected->'quantity'
    ),
    'sourceDecision',v_proposal.offer_json#>'{sourceBindings,sourceDecision}',
    'outlierAcknowledged',p_outlier_acknowledged,
    'seriesIntent',v_proposal.offer_json->'seriesIntent','newProgressionSeriesId',v_new_series_id,
    'affectedTargets',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'sessionId',value->>'sessionId','exerciseInstanceId',value->>'exerciseInstanceId'
    ) ORDER BY value->>'scheduledLocalDate',value->>'sessionId',value->>'exerciseInstanceId')
      FROM pg_catalog.jsonb_array_elements(v_proposal.target_bindings) value)
  );
  INSERT INTO public.training_manual_recalibration_acceptances(
    proposal_id,actor_user_id,request_id,option_index,outlier_acknowledged,request_hash,
    assignment_id,result_program_revision_number,result_json,accepted_at
  ) VALUES (v_proposal.id,v_actor,p_request_id,p_option_index,p_outlier_acknowledged,v_request_hash,
    v_assignment.id,v_next_revision,v_result,v_now);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_training_manual_recalibration_proposal(uuid,uuid,integer,boolean),
  private.apply_training_manual_recalibration(jsonb,uuid,uuid,timestamptz,jsonb,jsonb,text,bigint,bigint,text,text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.accept_training_manual_recalibration_proposal(uuid,uuid,integer,boolean) TO authenticated;

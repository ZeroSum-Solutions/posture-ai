-- Warm-up set kind and ordinal are server projections from the immutable
-- started prescription. The caller supplies only the set ID and actual work.
CREATE OR REPLACE FUNCTION private.resolve_training_prescribed_set(
  p_prescription jsonb,
  p_set_id text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_set_id IS NULL OR pg_catalog.jsonb_typeof(p_prescription->'exercises') <> 'array' THEN
    RETURN NULL;
  END IF;

  WITH candidates AS (
    SELECT
      exercise.value AS exercise,
      'working'::text AS set_kind,
      working.ordinality::integer AS working_set_ordinal
    FROM pg_catalog.jsonb_array_elements(p_prescription->'exercises') exercise(value)
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(
      CASE WHEN pg_catalog.jsonb_typeof(exercise.value->'setIds') = 'array'
        THEN exercise.value->'setIds' ELSE '[]'::jsonb END
    ) WITH ORDINALITY working(set_id, ordinality)
    WHERE working.set_id = p_set_id

    UNION ALL

    SELECT
      exercise.value AS exercise,
      'warmup'::text AS set_kind,
      NULL::integer AS working_set_ordinal
    FROM pg_catalog.jsonb_array_elements(p_prescription->'exercises') exercise(value)
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(
      CASE WHEN pg_catalog.jsonb_typeof(exercise.value->'warmupSets') = 'array'
        THEN exercise.value->'warmupSets' ELSE '[]'::jsonb END
    ) warmup(value)
    WHERE warmup.value->>'setId' = p_set_id
  )
  SELECT CASE WHEN pg_catalog.count(*) = 1
    THEN (pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'exercise', exercise,
      'setKind', set_kind,
      'workingSetOrdinal', working_set_ordinal
    )))->0
    ELSE NULL
  END
  INTO v_result
  FROM candidates;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION private.resolve_training_prescribed_set(jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION public.write_training_set_log(
 p_session_id text,p_set_id text,p_expected_revision bigint,p_request_id uuid,p_actual jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 v_session public.training_sessions%ROWTYPE;
 v_assignment public.training_program_assignments%ROWTYPE;
 v_prescription jsonb;
 v_exercise jsonb;
 v_resolution jsonb;
 v_set_kind text;
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
 v_resolution := private.resolve_training_prescribed_set(v_prescription, p_set_id);
 IF v_resolution IS NULL THEN
  RAISE EXCEPTION 'set is not uniquely authored in the started prescription' USING ERRCODE='22023';
 END IF;
 v_exercise := v_resolution->'exercise';
 v_set_kind := v_resolution->>'setKind';
 v_ordinal := (v_resolution->>'workingSetOrdinal')::integer;
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
  'setId',p_set_id,'setKind',v_set_kind,'workingSetOrdinal',v_ordinal,
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

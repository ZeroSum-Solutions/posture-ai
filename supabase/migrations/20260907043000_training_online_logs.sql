-- Online writes use authenticated, subject-scoped RPCs. Identity, context,
-- event revisions and server time are derived inside the transaction.
ALTER TABLE public.training_sessions ADD COLUMN stopped_for_symptoms boolean NOT NULL DEFAULT false;

CREATE TABLE public.training_set_log_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL,
  session_id text NOT NULL,
  set_id text NOT NULL CHECK (private.is_stable_training_reference(set_id,128)),
  event_revision bigint NOT NULL CHECK (event_revision >= 1),
  replaces_event_id uuid UNIQUE REFERENCES public.training_set_log_events(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  event_json jsonb NOT NULL,
  event_hash text GENERATED ALWAYS AS (private.training_evidence_sha256(event_json)) STORED,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (session_id,subject_id) REFERENCES public.training_sessions(id,subject_id) ON DELETE RESTRICT,
  UNIQUE(session_id,set_id,event_revision),
  CHECK ((event_json->>'schemaVersion' = 'training-set-log-event.v1') IS TRUE),
  CHECK ((event_json->>'eventId' = id::text) IS TRUE),
  CHECK ((event_json->>'subjectId' = subject_id::text) IS TRUE),
  CHECK ((event_json->>'sessionId' = session_id) IS TRUE),
  CHECK ((event_json->>'setId' = set_id) IS TRUE),
  CHECK ((event_json->>'eventRevision' = event_revision::text) IS TRUE),
  CHECK ((event_json#>>'{actor,userId}' = actor_user_id::text) IS TRUE)
);

CREATE TABLE public.training_conditioning_log_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL,
  session_id text NOT NULL,
  event_revision bigint NOT NULL CHECK (event_revision >= 1),
  replaces_event_id uuid UNIQUE REFERENCES public.training_conditioning_log_events(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  event_json jsonb NOT NULL,
  event_hash text GENERATED ALWAYS AS (private.training_evidence_sha256(event_json)) STORED,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (session_id,subject_id) REFERENCES public.training_sessions(id,subject_id) ON DELETE RESTRICT,
  UNIQUE(session_id,event_revision),
  CHECK ((event_json->>'schemaVersion' = 'training-conditioning-log-event.v1') IS TRUE),
  CHECK ((event_json->>'eventId' = id::text) IS TRUE),
  CHECK ((event_json->>'subjectId' = subject_id::text) IS TRUE),
  CHECK ((event_json->>'sessionId' = session_id) IS TRUE),
  CHECK ((event_json->>'eventRevision' = event_revision::text) IS TRUE),
  CHECK ((event_json#>>'{actor,userId}' = actor_user_id::text) IS TRUE)
);

CREATE TRIGGER training_conditioning_log_append_only BEFORE UPDATE OR DELETE ON public.training_conditioning_log_events
 FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();
ALTER TABLE public.training_conditioning_log_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY training_conditioning_log_read ON public.training_conditioning_log_events FOR SELECT TO authenticated USING (EXISTS (
 SELECT 1 FROM public.training_sessions session
 WHERE session.id=session_id AND private.can_read_training_assignment(session.assignment_id)
));
REVOKE ALL ON public.training_conditioning_log_events FROM anon,authenticated,service_role;
GRANT SELECT ON public.training_conditioning_log_events TO authenticated,service_role;

CREATE TABLE public.training_mutation_receipts (
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  session_id text NOT NULL REFERENCES public.training_sessions(id) ON DELETE RESTRICT,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_user_id,request_id)
);
CREATE INDEX training_log_session_set ON public.training_set_log_events(session_id,set_id,event_revision DESC);
CREATE TRIGGER training_log_append_only BEFORE UPDATE OR DELETE ON public.training_set_log_events
  FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();
CREATE TRIGGER training_receipts_append_only BEFORE UPDATE OR DELETE ON public.training_mutation_receipts
  FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();

ALTER TABLE public.training_set_log_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_mutation_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY training_log_read ON public.training_set_log_events FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.training_sessions session
  WHERE session.id=session_id AND private.can_read_training_assignment(session.assignment_id)
));
CREATE POLICY training_receipt_read ON public.training_mutation_receipts FOR SELECT TO authenticated
  USING (actor_user_id=auth.uid() AND EXISTS (
    SELECT 1 FROM public.training_sessions session
    WHERE session.id=session_id AND private.can_read_training_assignment(session.assignment_id)
  ));
REVOKE ALL ON public.training_set_log_events,public.training_mutation_receipts FROM anon,authenticated,service_role;
GRANT SELECT ON public.training_set_log_events,public.training_mutation_receipts TO authenticated,service_role;

CREATE VIEW public.training_current_set_actuals WITH (security_invoker=true) AS
 SELECT DISTINCT ON (session_id,set_id) session_id,set_id,event_revision,event_json
 FROM public.training_set_log_events ORDER BY session_id,set_id,event_revision DESC;
REVOKE ALL ON public.training_current_set_actuals FROM anon,authenticated,service_role;
GRANT SELECT ON public.training_current_set_actuals TO authenticated,service_role;

-- One SQL snapshot binds the revision displayed by the client to its actuals.
-- SECURITY INVOKER preserves table RLS, including the current AAL2/actor checks.
CREATE OR REPLACE FUNCTION public.read_training_session_projection(p_session_id text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT pg_catalog.jsonb_build_object(
  'session',pg_catalog.to_jsonb(session),
  'prescription',(SELECT prescription_json FROM public.training_session_prescriptions WHERE session_id=session.id),
  'currentActuals',COALESCE((SELECT pg_catalog.jsonb_agg(actual.event_json ORDER BY actual.set_id)
    FROM public.training_current_set_actuals actual WHERE actual.session_id=session.id),'[]'::jsonb),
  'currentConditioningActual',(SELECT event_json FROM public.training_conditioning_log_events
    WHERE session_id=session.id ORDER BY event_revision DESC LIMIT 1)
 ) FROM public.training_sessions session WHERE session.id=p_session_id;
$$;
REVOKE ALL ON FUNCTION public.read_training_session_projection(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_training_session_projection(text) TO authenticated;

CREATE OR REPLACE FUNCTION private.can_write_training_session(p_session_id text,p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.training_sessions session
  JOIN public.training_program_assignments assignment ON assignment.id=session.assignment_id
  WHERE session.id=p_session_id AND private.can_read_training_assignment(assignment.id)
   AND (private.is_training_subject_owner(session.subject_id)
     OR (assignment.owning_practitioner_id=auth.uid()
       AND private.is_training_subject_coach(session.subject_id,p_permission)))
 );
$$;

CREATE OR REPLACE FUNCTION private.is_valid_training_set_actual(p_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 RETURN COALESCE(
  private.jsonb_has_exact_keys(p_value,ARRAY['quantity','reps','rir','side','symptomState','occurredAt'])
  AND private.is_exact_training_quantity(p_value->'quantity')
  AND pg_catalog.jsonb_typeof(p_value->'reps')='number'
  AND (p_value->>'reps')::numeric=pg_catalog.trunc((p_value->>'reps')::numeric)
  AND (p_value->>'reps')::numeric BETWEEN 0 AND 100
  AND CASE WHEN pg_catalog.jsonb_typeof(p_value->'rir')='number' THEN
    (p_value->>'rir')::numeric=pg_catalog.trunc((p_value->>'rir')::numeric)
    AND (p_value->>'rir')::numeric BETWEEN 0 AND 5
   ELSE pg_catalog.jsonb_typeof(p_value->'rir')='string' AND p_value->>'rir' IN ('6_plus','unknown') END
  AND p_value->>'side' IN ('bilateral','left','right','not_applicable')
  AND p_value->>'symptomState' IN ('none','adverse_reported')
  AND private.is_iso_datetime(p_value->>'occurredAt'),false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
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
  IF v_receipt.request_hash<>v_hash THEN RAISE EXCEPTION 'training request ID reused with different content' USING ERRCODE='40001'; END IF;
  RETURN v_receipt.result_json;
 END IF;
 IF v_session.revision IS DISTINCT FROM p_expected_revision THEN
  RAISE EXCEPTION 'training session changed concurrently' USING ERRCODE='40001';
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

CREATE OR REPLACE FUNCTION private.is_valid_training_conditioning_actual(p_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 RETURN COALESCE(
  private.jsonb_has_exact_keys(p_value,ARRAY['durationSeconds','perceivedEffort','symptomState','occurredAt'])
  AND pg_catalog.jsonb_typeof(p_value->'durationSeconds')='number'
  AND (p_value->>'durationSeconds')::numeric=pg_catalog.trunc((p_value->>'durationSeconds')::numeric)
  AND (p_value->>'durationSeconds')::numeric BETWEEN 0 AND 86400
  AND CASE WHEN pg_catalog.jsonb_typeof(p_value->'perceivedEffort')='number' THEN
   (p_value->>'perceivedEffort')::numeric=pg_catalog.trunc((p_value->>'perceivedEffort')::numeric)
   AND (p_value->>'perceivedEffort')::numeric BETWEEN 0 AND 10
   ELSE p_value->>'perceivedEffort'='unknown' END
  AND p_value->>'symptomState' IN ('none','adverse_reported')
  AND private.is_iso_datetime(p_value->>'occurredAt'),false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
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
  IF v_receipt.request_hash<>v_hash THEN RAISE EXCEPTION 'training request ID reused with different content' USING ERRCODE='40001'; END IF;
  RETURN v_receipt.result_json;
 END IF;
 IF v_session.revision IS DISTINCT FROM p_expected_revision THEN
  RAISE EXCEPTION 'training session changed concurrently' USING ERRCODE='40001';
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
  IF v_receipt.request_hash<>v_hash THEN RAISE EXCEPTION 'training request ID reused with different content' USING ERRCODE='40001'; END IF;
  RETURN v_receipt.result_json;
 END IF;
 IF v_session.revision IS DISTINCT FROM p_expected_revision THEN
  RAISE EXCEPTION 'training session changed concurrently' USING ERRCODE='40001';
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
  RAISE EXCEPTION 'training session has unlogged sets' USING ERRCODE='40001';
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

REVOKE ALL ON FUNCTION private.can_write_training_session(text,text),private.is_valid_training_set_actual(jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.write_training_set_log(text,text,bigint,uuid,jsonb),
 public.complete_training_session(text,bigint,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.write_training_set_log(text,text,bigint,uuid,jsonb),
 public.complete_training_session(text,bigint,uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION private.is_valid_training_conditioning_actual(jsonb),
 public.write_training_conditioning_log(text,bigint,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.write_training_conditioning_log(text,bigint,uuid,jsonb) TO authenticated;

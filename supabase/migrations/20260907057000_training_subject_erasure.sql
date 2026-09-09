-- Athlete-owned training erasure. The legacy practitioner client is deliberately
-- outside this lifecycle; only its optional training bridge is removed.

CREATE TABLE private.training_subject_erasure_receipts (
  owner_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL UNIQUE,
  request_id uuid NOT NULL UNIQUE,
  erased_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

REVOKE ALL ON private.training_subject_erasure_receipts FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.training_subject_erasure_context()
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT receipt.subject_id
  FROM private.training_subject_erasure_receipts receipt
  WHERE auth.uid() IS NOT NULL
    AND receipt.owner_user_id = auth.uid()
    AND receipt.subject_id = NULLIF(pg_catalog.current_setting('posture.training_subject_erasure_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION private.reject_training_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND private.training_subject_erasure_context() IS NOT NULL THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'training evidence is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_training_subject_evidence_pointers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF private.training_subject_erasure_context() = NEW.id
    AND NEW.status = 'revoked'
    AND NEW.deleted_at IS NOT NULL
    AND NEW.current_profile_revision IS NULL
    AND NEW.current_eligibility_decision_source_revision_id IS NULL
  THEN
    RETURN NEW;
  END IF;

  IF NEW.current_profile_revision IS DISTINCT FROM OLD.current_profile_revision
    AND (NEW.current_profile_revision IS NULL
      OR NEW.current_profile_revision <> COALESCE(OLD.current_profile_revision, 0) + 1)
  THEN
    RAISE EXCEPTION 'current profile pointer must advance exactly once' USING ERRCODE = 'PT409';
  END IF;
  IF NEW.current_eligibility_decision_source_revision_id IS DISTINCT FROM OLD.current_eligibility_decision_source_revision_id
    AND (NEW.current_eligibility_decision_source_revision_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.training_eligibility_decisions decision
      WHERE decision.subject_id = NEW.id
        AND decision.source_revision_id = NEW.current_eligibility_decision_source_revision_id
        AND decision.supersedes_source_revision_id IS NOT DISTINCT FROM OLD.current_eligibility_decision_source_revision_id
    ))
  THEN
    RAISE EXCEPTION 'current eligibility pointer must follow the supersession chain' USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.erase_training_subject_transactional(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subject public.training_subjects%ROWTYPE;
  v_receipt private.training_subject_erasure_receipts%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt()->>'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'current AAL2 athlete is required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'erasure request ID is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_receipt FROM private.training_subject_erasure_receipts
  WHERE owner_user_id = auth.uid() FOR UPDATE;
  IF FOUND THEN
    IF v_receipt.request_id <> p_request_id THEN
      RAISE EXCEPTION 'owned training subject is unavailable' USING ERRCODE = 'P0001';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion','training-subject-erasure.v1','status','already_erased',
      'subjectId',v_receipt.subject_id,'requestId',v_receipt.request_id
    );
  END IF;

  SELECT * INTO v_subject FROM public.training_subjects
  WHERE owner_user_id = auth.uid() AND status = 'active' AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    -- A concurrent identical request may have committed while this caller
    -- waited for the now-deleted subject row. Re-read its user-bound receipt.
    SELECT * INTO v_receipt FROM private.training_subject_erasure_receipts
    WHERE owner_user_id = auth.uid() AND request_id = p_request_id;
    IF FOUND THEN
      RETURN pg_catalog.jsonb_build_object(
        'schemaVersion','training-subject-erasure.v1','status','already_erased',
        'subjectId',v_receipt.subject_id,'requestId',v_receipt.request_id
      );
    END IF;
    RAISE EXCEPTION 'owned training subject is unavailable' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.set_config('posture.training_subject_erasure_id', v_subject.id::text, true);
  INSERT INTO private.training_subject_erasure_receipts(owner_user_id,subject_id,request_id,erased_at)
  VALUES(auth.uid(),v_subject.id,p_request_id,v_now);

  UPDATE public.training_subjects SET status='revoked',revoked_at=COALESCE(revoked_at,v_now),deleted_at=v_now,
    current_profile_revision=NULL,current_eligibility_decision_source_revision_id=NULL
  WHERE id=v_subject.id;

  -- Accepted/provisioned invitations require their subject pointer by schema.
  -- End that access lifecycle explicitly and clear both identity pointers before
  -- deleting the subject; weakening the global invitation shape would permit
  -- malformed live invitations and leave an old admission path attached.
  UPDATE private.athlete_invitations
  SET state='revoked', revoked_at=COALESCE(revoked_at,v_now),
    subject_id=NULL, provisioned_user_id=NULL, updated_at=v_now
  WHERE subject_id=v_subject.id;

  SET CONSTRAINTS ALL DEFERRED;

  IF pg_catalog.to_regclass('public.training_exercise_swap_proposals') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.training_exercise_swap_acceptances a USING public.training_exercise_swap_proposals p WHERE a.proposal_id=p.id AND p.subject_id=$1' USING v_subject.id;
    EXECUTE 'DELETE FROM public.training_exercise_swap_proposals WHERE subject_id=$1' USING v_subject.id;
  END IF;
  IF pg_catalog.to_regclass('public.training_conditioning_progression_proposals') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.training_conditioning_progression_acceptances a USING public.training_conditioning_progression_proposals p WHERE a.proposal_id=p.id AND p.subject_id=$1' USING v_subject.id;
    EXECUTE 'DELETE FROM public.training_conditioning_progression_proposals WHERE subject_id=$1' USING v_subject.id;
  END IF;
  DELETE FROM public.training_progression_acceptances a USING public.training_progression_proposals p
    WHERE a.proposal_id=p.id AND p.subject_id=v_subject.id;
  DELETE FROM public.training_progression_proposals WHERE subject_id=v_subject.id;
  DELETE FROM public.training_mutation_receipts r USING public.training_sessions s
    WHERE r.session_id=s.id AND s.subject_id=v_subject.id;
  DELETE FROM public.training_set_log_events WHERE subject_id=v_subject.id
    AND NOT EXISTS (SELECT 1 FROM public.training_set_log_events child WHERE child.replaces_event_id=training_set_log_events.id);
  WHILE FOUND LOOP
    DELETE FROM public.training_set_log_events WHERE subject_id=v_subject.id
      AND NOT EXISTS (SELECT 1 FROM public.training_set_log_events child WHERE child.replaces_event_id=training_set_log_events.id);
  END LOOP;
  DELETE FROM public.training_conditioning_log_events WHERE subject_id=v_subject.id
    AND NOT EXISTS (SELECT 1 FROM public.training_conditioning_log_events child WHERE child.replaces_event_id=training_conditioning_log_events.id);
  WHILE FOUND LOOP
    DELETE FROM public.training_conditioning_log_events WHERE subject_id=v_subject.id
      AND NOT EXISTS (SELECT 1 FROM public.training_conditioning_log_events child WHERE child.replaces_event_id=training_conditioning_log_events.id);
  END LOOP;
  DELETE FROM public.training_session_progression_metadata WHERE subject_id=v_subject.id;
  DELETE FROM public.training_session_prescriptions WHERE subject_id=v_subject.id;
  DELETE FROM public.training_sessions WHERE subject_id=v_subject.id;
  DELETE FROM public.training_program_revisions WHERE subject_id=v_subject.id;
  DELETE FROM public.training_program_assignments WHERE subject_id=v_subject.id;
  DELETE FROM public.training_program_drafts WHERE subject_id=v_subject.id;
  DELETE FROM public.training_program_builds WHERE subject_id=v_subject.id;
  DELETE FROM public.training_simulation_runs WHERE subject_id=v_subject.id;

  IF pg_catalog.to_regclass('public.training_manual_reference_routine_create_receipts') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.training_manual_reference_routine_create_receipts WHERE subject_id=$1' USING v_subject.id;
    EXECUTE 'DELETE FROM public.training_manual_reference_routine_revisions r USING public.training_manual_reference_routines routine WHERE r.routine_id=routine.id AND routine.subject_id=$1' USING v_subject.id;
    EXECUTE 'DELETE FROM public.training_manual_reference_routines WHERE subject_id=$1' USING v_subject.id;
  END IF;

  DELETE FROM public.coaching_relationships WHERE subject_id=v_subject.id;
  DELETE FROM public.training_eligibility_decisions WHERE subject_id=v_subject.id
    AND NOT EXISTS (SELECT 1 FROM public.training_eligibility_decisions child
      WHERE child.subject_id=v_subject.id AND child.supersedes_source_revision_id=training_eligibility_decisions.source_revision_id);
  WHILE FOUND LOOP
    DELETE FROM public.training_eligibility_decisions WHERE subject_id=v_subject.id
      AND NOT EXISTS (SELECT 1 FROM public.training_eligibility_decisions child
        WHERE child.subject_id=v_subject.id AND child.supersedes_source_revision_id=training_eligibility_decisions.source_revision_id);
  END LOOP;
  DELETE FROM public.training_eligibility_responses WHERE subject_id=v_subject.id;
  DELETE FROM public.training_profile_revisions WHERE subject_id=v_subject.id;
  DELETE FROM public.client_accounts WHERE subject_id=v_subject.id;
  DELETE FROM public.training_subjects WHERE id=v_subject.id;
  PERFORM pg_catalog.set_config('posture.training_subject_erasure_id','',true);

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion','training-subject-erasure.v1','status','erased',
    'subjectId',v_subject.id,'requestId',p_request_id
  );
END;
$$;

REVOKE ALL ON FUNCTION private.training_subject_erasure_context() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.erase_training_subject_transactional(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.erase_training_subject_transactional(uuid) TO authenticated;

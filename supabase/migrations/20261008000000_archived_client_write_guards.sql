-- Archive hides a present client. Only new records or public exposure are guarded.
-- Definitions below are copied from each function's latest defining migration.
-- Existing resolver, withdrawal, revocation and erasure functions are unchanged.

-- Latest definition: 20260720010000_privacy_lifecycle.sql
CREATE OR REPLACE FUNCTION private.enforce_workout_share_monotonicity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.session_token_hash IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.expires_at IS NULL OR NEW.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'active workout shares require an expiry and cannot be revoked'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- A session update already holds its row lock. Do not take a client row
    -- lock here: rotation locks client before session. Clearing a token exits
    -- above, so revocation, withdrawal and erasure remain available.
    IF NEW.session_token_hash IS DISTINCT FROM OLD.session_token_hash
      OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
      OR NEW.share_generation IS DISTINCT FROM OLD.share_generation
    THEN
      PERFORM 1 FROM public.clients c
      WHERE c.id = NEW.client_id
        AND c.practitioner_id = NEW.practitioner_id
        AND c.deleted_at IS NULL
        AND c.archived_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'cannot share for a deleted, unknown, or mismatched client'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF OLD.session_token_hash IS NULL OR OLD.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'a revoked or inactive workout share cannot be restored'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.client_id IS DISTINCT FROM OLD.client_id
      OR NEW.practitioner_id IS DISTINCT FROM OLD.practitioner_id
    THEN
      RAISE EXCEPTION 'an active workout share cannot change ownership'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.share_generation < OLD.share_generation
      OR (
        NEW.session_token_hash IS DISTINCT FROM OLD.session_token_hash
        AND NEW.share_generation <= OLD.share_generation
      )
    THEN
      RAISE EXCEPTION 'workout share generations must increase with credential changes'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    PERFORM 1
    FROM public.clients c
    WHERE c.id = NEW.client_id
      AND c.practitioner_id = NEW.practitioner_id
      AND c.deleted_at IS NULL
      AND c.archived_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'cannot share for a deleted, unknown, or mismatched client'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM (
      SELECT cr.kind, cr.revoked_at
      FROM public.consent_records cr
      WHERE cr.client_id = NEW.client_id
        AND cr.practitioner_id = NEW.practitioner_id
      ORDER BY cr.recorded_at DESC, cr.id DESC
      LIMIT 1
    ) latest
    WHERE latest.kind <> 'revocation' AND latest.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'active subject consent is required for a workout share'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Latest definition: 20260720010000_privacy_lifecycle.sql
CREATE OR REPLACE FUNCTION public.reject_insert_for_deleted_client()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM public.clients c
  WHERE c.id = NEW.client_id AND c.deleted_at IS NULL AND c.archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cannot create a record for a deleted or unknown client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Latest definition: 20260720010000_privacy_lifecycle.sql
CREATE OR REPLACE FUNCTION public.reject_report_for_deleted_client()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM public.assessments a
  JOIN public.clients c ON c.id = a.client_id
  WHERE a.id = NEW.assessment_id AND c.deleted_at IS NULL AND c.archived_at IS NULL
  FOR UPDATE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cannot create a report for a deleted or unknown client'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.compared_to_assessment_id IS NOT NULL THEN
    PERFORM 1
    FROM public.assessments a
    JOIN public.clients c ON c.id = a.client_id
    WHERE a.id = NEW.compared_to_assessment_id AND c.deleted_at IS NULL AND c.archived_at IS NULL
    FOR UPDATE OF c;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'cannot create a report comparing against a deleted or unknown client'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Latest definition: 20260907030000_prototype_operation.sql
CREATE OR REPLACE FUNCTION public.create_assessment_prototype(
  p_client_id uuid,
  p_practitioner_id uuid,
  p_submission_id uuid,
  p_submission_digest text,
  p_captures jsonb,
  p_findings jsonb,
  p_overall_score numeric,
  p_overall_grade text,
  p_scoring_engine_version text,
  p_tilt_corrected boolean,
  p_level_verified boolean,
  p_capture_stability numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_assessment_id uuid;
  v_existing record;
BEGIN
  IF p_client_id IS NULL OR p_practitioner_id IS NULL OR p_submission_id IS NULL
    OR p_submission_digest !~ '^[0-9a-f]{64}$'
    OR pg_catalog.jsonb_typeof(p_captures) IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(p_captures) NOT BETWEEN 1 AND 24
    OR pg_catalog.jsonb_typeof(p_findings) IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(p_findings) > 64
    OR p_overall_score IS NULL
    OR p_overall_grade IS NULL OR p_overall_grade NOT IN ('S', 'A', 'B', 'C', 'D', 'E')
    OR p_scoring_engine_version IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(p_scoring_engine_version)) NOT BETWEEN 1 AND 64
    OR p_capture_stability < 0 OR p_capture_stability > 1
  THEN RETURN pg_catalog.jsonb_build_object('status', 'invalid_input'); END IF;

  PERFORM 1 FROM public.practitioners practitioner
  WHERE practitioner.id = p_practitioner_id
    AND practitioner.access_status = 'active'
    AND practitioner.role = 'practitioner'
  FOR SHARE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'practitioner_unavailable'); END IF;

  PERFORM 1 FROM public.clients client
  WHERE client.id = p_client_id
    AND client.practitioner_id = p_practitioner_id
    AND client.deleted_at IS NULL
    AND client.archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_found'); END IF;

  SELECT assessment.id, assessment.client_id, assessment.status,
    assessment.submission_digest, assessment.operation_mode
  INTO v_existing
  FROM public.assessments assessment
  WHERE assessment.practitioner_id = p_practitioner_id
    AND assessment.submission_id = p_submission_id;
  IF FOUND THEN
    IF v_existing.client_id IS DISTINCT FROM p_client_id
      OR v_existing.submission_digest IS DISTINCT FROM p_submission_digest
      OR v_existing.operation_mode IS DISTINCT FROM 'prototype'
    THEN
      RETURN pg_catalog.jsonb_build_object('status', 'submission_conflict', 'assessment_id', v_existing.id);
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'status', v_existing.status::text,
      'assessment_id', v_existing.id,
      'replayed', true
    );
  END IF;

  INSERT INTO public.assessments (
    client_id, practitioner_id, submission_id, submission_digest, status,
    assessment_type, overall_score, overall_grade, scoring_engine_version,
    tilt_corrected, level_verified, capture_stability, operation_mode,
    legal_provenance_state
  ) VALUES (
    p_client_id, p_practitioner_id, p_submission_id, p_submission_digest, 'complete',
    'static', p_overall_score, p_overall_grade::public.overall_grade_enum,
    pg_catalog.btrim(p_scoring_engine_version), p_tilt_corrected,
    p_level_verified, p_capture_stability, 'prototype', 'prototype'
  )
  ON CONFLICT (practitioner_id, submission_id) WHERE submission_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_assessment_id;

  IF v_assessment_id IS NULL THEN
    SELECT assessment.id, assessment.client_id, assessment.status,
      assessment.submission_digest, assessment.operation_mode
    INTO STRICT v_existing
    FROM public.assessments assessment
    WHERE assessment.practitioner_id = p_practitioner_id
      AND assessment.submission_id = p_submission_id;
    IF v_existing.client_id IS DISTINCT FROM p_client_id
      OR v_existing.submission_digest IS DISTINCT FROM p_submission_digest
      OR v_existing.operation_mode IS DISTINCT FROM 'prototype'
    THEN
      RETURN pg_catalog.jsonb_build_object('status', 'submission_conflict', 'assessment_id', v_existing.id);
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'status', v_existing.status::text,
      'assessment_id', v_existing.id,
      'replayed', true
    );
  END IF;

  INSERT INTO public.captures (
    assessment_id, practitioner_id, view, source, profile_side, pose_frame
  )
  SELECT
    v_assessment_id, p_practitioner_id, capture.view::public.view_enum,
    capture.source, capture.profile_side, capture.pose_frame
  FROM pg_catalog.jsonb_to_recordset(p_captures) AS capture(
    view text, source text, profile_side text, pose_frame jsonb
  );

  INSERT INTO public.assessment_findings (
    assessment_id, practitioner_id, imbalance_key, region, label, deviation,
    standard, unit, direction, severity_pct, zone, view_used, confidence,
    metric_validity, stability_score, uncertainty_deg, borderline, observations
  )
  SELECT
    v_assessment_id, p_practitioner_id, finding.imbalance_key, finding.region,
    finding.label, finding.deviation, finding.standard, finding.unit,
    finding.direction, finding.severity_pct, finding.zone::public.zone_enum,
    finding.view_used::public.view_enum, finding.confidence,
    finding.metric_validity, finding.stability_score, finding.uncertainty_deg,
    finding.borderline, finding.observations
  FROM pg_catalog.jsonb_to_recordset(p_findings) AS finding(
    imbalance_key text, region text, label text, deviation numeric,
    standard numeric, unit text, direction text, severity_pct numeric,
    zone text, view_used text, confidence numeric, metric_validity text,
    stability_score numeric, uncertainty_deg numeric, borderline boolean,
    observations jsonb
  );

  RETURN pg_catalog.jsonb_build_object(
    'status', 'complete',
    'assessment_id', v_assessment_id,
    'replayed', false
  );
END;
$$;

-- Latest definition: 20260907030000_prototype_operation.sql
CREATE OR REPLACE FUNCTION public.create_workout_session_prototype(
  p_assessment_id uuid,
  p_client_id uuid,
  p_practitioner_id uuid,
  p_week int,
  p_capability text,
  p_program_snapshot jsonb,
  p_estimated_duration_sec int,
  p_operation_id uuid,
  p_name text,
  p_preferences jsonb,
  p_generation_source text,
  p_clinical_content_version text,
  p_clinical_inventory_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session_id uuid;
BEGIN
  IF p_assessment_id IS NULL OR p_client_id IS NULL OR p_practitioner_id IS NULL
    OR p_week NOT BETWEEN 1 AND 3
    OR p_capability NOT IN ('regression', 'standard', 'progression')
    OR p_program_snapshot IS NULL
    OR p_estimated_duration_sec IS NULL OR p_estimated_duration_sec < 0
    OR p_operation_id IS NULL
    OR p_name IS NULL OR p_name <> pg_catalog.btrim(p_name)
    OR pg_catalog.char_length(p_name) NOT BETWEEN 1 AND 80
    OR NOT private.valid_workout_preferences(p_preferences)
    OR p_preferences->>'capability' <> p_capability
    OR p_generation_source NOT IN ('scan', 'ai')
    OR p_clinical_content_version IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(p_clinical_content_version)) NOT BETWEEN 1 AND 128
    OR p_clinical_inventory_sha256 !~ '^[0-9a-f]{64}$'
    OR p_program_snapshot->>'version' IS DISTINCT FROM '4'
    OR p_program_snapshot->>'operationMode' IS DISTINCT FROM 'prototype'
    OR p_program_snapshot->>'contentState' IS DISTINCT FROM 'prototype_unreviewed'
    OR p_program_snapshot ? 'legalNotice'
    OR p_program_snapshot#>>'{clinicalContent,version}' IS DISTINCT FROM p_clinical_content_version
    OR p_program_snapshot#>>'{clinicalContent,inventorySha256}' IS DISTINCT FROM p_clinical_inventory_sha256
  THEN RETURN pg_catalog.jsonb_build_object('status', 'invalid_input'); END IF;

  PERFORM 1 FROM public.practitioners practitioner
  WHERE practitioner.id = p_practitioner_id
    AND practitioner.access_status = 'active'
    AND practitioner.role = 'practitioner'
  FOR SHARE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'practitioner_unavailable'); END IF;

  PERFORM 1
  FROM public.assessments assessment
  JOIN public.clients client ON client.id = assessment.client_id
  WHERE assessment.id = p_assessment_id
    AND assessment.client_id = p_client_id
    AND assessment.practitioner_id = p_practitioner_id
    AND assessment.practitioner_approved = true
    AND client.practitioner_id = p_practitioner_id
    AND client.deleted_at IS NULL
    AND client.archived_at IS NULL
  FOR UPDATE OF client;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_found'); END IF;

  INSERT INTO public.workout_sessions (
    assessment_id, client_id, practitioner_id, week, capability,
    program_snapshot, estimated_duration_sec, name, preferences,
    generation_source, operation_mode, legal_provenance_state,
    clinical_content_version, clinical_inventory_sha256,
    clinical_review_receipt_sha256, session_token_hash, expires_at
  ) VALUES (
    p_assessment_id, p_client_id, p_practitioner_id, p_week, p_capability,
    p_program_snapshot, p_estimated_duration_sec, p_name, p_preferences,
    p_generation_source, 'prototype', 'prototype',
    pg_catalog.btrim(p_clinical_content_version), p_clinical_inventory_sha256,
    NULL, NULL, NULL
  ) RETURNING id INTO v_session_id;

  INSERT INTO public.session_runs (workout_session_id, practitioner_id, status)
  VALUES (v_session_id, p_practitioner_id, 'started');

  RETURN pg_catalog.jsonb_build_object('status', 'created', 'session_id', v_session_id);
END;
$$;

-- Latest definition: 20260720020000_clinical_content_governance.sql
CREATE OR REPLACE FUNCTION public.create_workout_session_clinical_governed(
  p_assessment_id uuid,
  p_client_id uuid,
  p_practitioner_id uuid,
  p_week int,
  p_capability text,
  p_program_snapshot jsonb,
  p_estimated_duration_sec int,
  p_token_hash text,
  p_expires_at timestamptz,
  p_operation_id uuid,
  p_ip_hash text,
  p_document_id text,
  p_document_version text,
  p_document_body_sha256 text,
  p_document_effective_at timestamptz,
  p_jurisdiction text,
  p_product_scope text,
  p_clinical_content_version text,
  p_clinical_inventory_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session_id uuid;
  v_clinical_receipt text;
BEGIN
  IF p_assessment_id IS NULL OR p_client_id IS NULL OR p_practitioner_id IS NULL
    OR p_week NOT BETWEEN 1 AND 3
    OR p_capability NOT IN ('regression', 'standard', 'progression')
    OR p_program_snapshot IS NULL OR p_estimated_duration_sec IS NULL
    OR p_estimated_duration_sec < 0
    OR p_operation_id IS NULL
    OR (p_token_hash IS NULL) <> (p_expires_at IS NULL)
    OR (p_token_hash IS NOT NULL AND p_token_hash !~ '^[0-9a-f]{64}$')
    OR (p_expires_at IS NOT NULL AND p_expires_at <= pg_catalog.clock_timestamp())
    OR (p_ip_hash IS NOT NULL AND p_ip_hash !~ '^[0-9a-f]{64}$')
    OR p_document_id IS NULL OR p_document_version IS NULL
    OR p_document_body_sha256 !~ '^[0-9a-f]{64}$'
    OR p_document_effective_at IS NULL OR p_jurisdiction IS NULL OR p_product_scope IS NULL
    OR p_clinical_content_version IS NULL
    OR p_clinical_inventory_sha256 !~ '^[0-9a-f]{64}$'
    OR p_program_snapshot->>'version' <> '3'
    OR p_program_snapshot#>>'{clinicalContent,version}' <> p_clinical_content_version
    OR p_program_snapshot#>>'{clinicalContent,inventorySha256}' <> p_clinical_inventory_sha256
  THEN RETURN pg_catalog.jsonb_build_object('status', 'invalid_input'); END IF;

  v_clinical_receipt := private.active_clinical_receipt(
    p_clinical_content_version,
    p_clinical_inventory_sha256,
    'workouts'
  );
  IF v_clinical_receipt IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'clinical_content_unavailable');
  END IF;

  PERFORM 1
  FROM public.practitioners practitioner
  WHERE practitioner.id = p_practitioner_id
    AND practitioner.access_status = 'active'
    AND practitioner.role = 'practitioner'
  FOR SHARE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'practitioner_unavailable'); END IF;

  PERFORM 1
  FROM public.assessments assessment
  JOIN public.clients client ON client.id = assessment.client_id
  WHERE assessment.id = p_assessment_id
    AND assessment.client_id = p_client_id
    AND assessment.practitioner_id = p_practitioner_id
    AND assessment.practitioner_approved = true
    AND client.practitioner_id = p_practitioner_id
    AND client.deleted_at IS NULL
    AND client.archived_at IS NULL
  FOR UPDATE OF client;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_found'); END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM (
      SELECT consent.kind, consent.revoked_at
      FROM public.consent_records consent
      WHERE consent.client_id = p_client_id
        AND consent.practitioner_id = p_practitioner_id
      ORDER BY consent.recorded_at DESC, consent.id DESC
      LIMIT 1
    ) latest
    WHERE latest.kind <> 'revocation' AND latest.revoked_at IS NULL
  ) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'consent_unavailable');
  END IF;

  INSERT INTO public.workout_sessions (
    assessment_id, client_id, practitioner_id, week, capability,
    program_snapshot, estimated_duration_sec, session_token_hash, expires_at,
    legal_document_id, legal_document_version, legal_document_body_sha256,
    legal_document_effective_at, legal_jurisdiction, legal_product_scope,
    legal_provenance_state, share_generation, clinical_content_version,
    clinical_inventory_sha256, clinical_review_receipt_sha256
  ) VALUES (
    p_assessment_id, p_client_id, p_practitioner_id, p_week, p_capability,
    p_program_snapshot, p_estimated_duration_sec, p_token_hash, p_expires_at,
    p_document_id, p_document_version, p_document_body_sha256,
    p_document_effective_at, p_jurisdiction, p_product_scope,
    'governed', 1, p_clinical_content_version,
    p_clinical_inventory_sha256, v_clinical_receipt
  ) RETURNING id INTO v_session_id;

  INSERT INTO public.session_runs (workout_session_id, practitioner_id, status)
  VALUES (v_session_id, p_practitioner_id, 'started');

  IF p_token_hash IS NOT NULL THEN
    INSERT INTO public.workout_share_events (
      workout_session_id, practitioner_id, event, actor, actor_code, ip_hash,
      reason_code, operation_id, share_generation
    ) VALUES (
      v_session_id, p_practitioner_id, 'minted', NULL, 'practitioner', p_ip_hash,
      'practitioner_action', p_operation_id, 1
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object('status', 'created', 'session_id', v_session_id);
END;
$$;

-- Latest definition: 20260720020000_clinical_content_governance.sql
CREATE OR REPLACE FUNCTION public.rotate_workout_share(
  p_session_id uuid,
  p_practitioner_id uuid,
  p_new_token_hash text,
  p_new_expires_at timestamptz,
  p_operation_id uuid,
  p_rotated_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_generation int;
  v_client_id uuid;
  v_release_id text;
  v_inventory_sha256 text;
  v_receipt_sha256 text;
BEGIN
  IF p_session_id IS NULL OR p_practitioner_id IS NULL OR p_operation_id IS NULL
    OR p_new_token_hash !~ '^[0-9a-f]{64}$'
    OR p_new_expires_at IS NULL OR p_rotated_at IS NULL
    OR p_new_expires_at <= p_rotated_at
    OR p_rotated_at > pg_catalog.clock_timestamp() + interval '5 minutes'
  THEN RETURN pg_catalog.jsonb_build_object('status', 'invalid_input'); END IF;

  SELECT client.id, session.clinical_content_version,
         session.clinical_inventory_sha256, session.clinical_review_receipt_sha256
    INTO v_client_id, v_release_id, v_inventory_sha256, v_receipt_sha256
  FROM public.clients client
  JOIN public.workout_sessions session ON session.client_id = client.id
  WHERE session.id = p_session_id
    AND session.practitioner_id = p_practitioner_id
    AND client.practitioner_id = p_practitioner_id
    AND client.deleted_at IS NULL
    AND client.archived_at IS NULL
  FOR UPDATE OF client;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_found'); END IF;

  IF v_release_id IS NULL
    OR v_inventory_sha256 IS NULL
    OR v_receipt_sha256 IS NULL
    OR private.active_clinical_receipt(v_release_id, v_inventory_sha256, 'workouts')
      IS DISTINCT FROM v_receipt_sha256
  THEN
    RETURN pg_catalog.jsonb_build_object('status', 'clinical_content_unavailable');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM (
      SELECT consent.kind, consent.revoked_at
      FROM public.consent_records consent
      WHERE consent.client_id = v_client_id
        AND consent.practitioner_id = p_practitioner_id
      ORDER BY consent.recorded_at DESC, consent.id DESC
      LIMIT 1
    ) latest
    WHERE latest.kind <> 'revocation' AND latest.revoked_at IS NULL
  ) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'consent_unavailable');
  END IF;

  SELECT session.share_generation + 1 INTO v_generation
  FROM public.workout_sessions session
  WHERE session.id = p_session_id
    AND session.practitioner_id = p_practitioner_id
    AND session.status = 'active'
    AND session.session_token_hash IS NOT NULL
    AND session.revoked_at IS NULL
    AND session.expires_at > pg_catalog.clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_rotatable'); END IF;

  UPDATE public.workout_sessions
  SET session_token_hash = p_new_token_hash,
      expires_at = p_new_expires_at,
      revoked_at = NULL,
      share_generation = v_generation
  WHERE id = p_session_id;

  INSERT INTO public.workout_share_events (
    workout_session_id, practitioner_id, event, actor, actor_code, ip_hash,
    reason_code, operation_id, share_generation
  ) VALUES (
    p_session_id, p_practitioner_id, 'rotated', NULL, 'practitioner', NULL,
    'practitioner_action', p_operation_id, v_generation
  );

  RETURN pg_catalog.jsonb_build_object('status', 'rotated', 'share_generation', v_generation);
END;
$$;

-- Latest definition: 20260907052000_capture_upload_retry.sql
CREATE OR REPLACE FUNCTION public.prepare_capture_image_upload(
  p_assessment_id uuid,
  p_capture_id uuid,
  p_practitioner_id uuid,
  p_slot text,
  p_storage_path text,
  p_image_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_capture public.captures%ROWTYPE;
  v_intent public.privacy_storage_deletion_outbox%ROWTYPE;
BEGIN
  IF p_assessment_id IS NULL OR p_capture_id IS NULL OR p_practitioner_id IS NULL
    OR p_slot IS NULL OR p_slot NOT IN ('front', 'side-left', 'side-right', 'back')
    OR p_image_sha256 IS NULL OR p_image_sha256 !~ '^[0-9a-f]{64}$'
    OR p_storage_path IS DISTINCT FROM (
      p_practitioner_id::text || '/' || p_assessment_id::text || '/'
      || p_capture_id::text || '/' || p_image_sha256 || '.jpg'
    )
  THEN
    RETURN pg_catalog.jsonb_build_object('status', 'invalid_input');
  END IF;

  SELECT capture.* INTO v_capture
  FROM public.captures capture
  JOIN public.assessments assessment ON assessment.id = capture.assessment_id
  JOIN public.clients client ON client.id = assessment.client_id
  WHERE capture.id = p_capture_id
    AND capture.assessment_id = p_assessment_id
    AND capture.practitioner_id = p_practitioner_id
    AND assessment.practitioner_id = p_practitioner_id
    AND assessment.status = 'complete'
    AND client.practitioner_id = p_practitioner_id
    AND client.deleted_at IS NULL
    AND client.archived_at IS NULL
    AND private.capture_slot_matches(capture.view, capture.profile_side, p_slot)
  FOR UPDATE OF capture;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_found');
  END IF;

  IF v_capture.storage_path IS NOT NULL THEN
    IF v_capture.storage_path = p_storage_path
      AND v_capture.image_sha256 = p_image_sha256
    THEN
      DELETE FROM public.privacy_storage_deletion_outbox job
      WHERE job.deletion_receipt_id IS NULL
        AND job.source_code = 'capture_upload_compensation'
        AND job.bucket = 'posture-captures'
        AND job.object_path = p_storage_path
        AND job.status IN ('pending', 'retry', 'complete');
      RETURN pg_catalog.jsonb_build_object(
        'status', 'already_saved', 'captureId', v_capture.id
      );
    END IF;
    RETURN pg_catalog.jsonb_build_object('status', 'conflict');
  END IF;

  SELECT job.* INTO v_intent
  FROM public.privacy_storage_deletion_outbox job
  WHERE job.bucket = 'posture-captures'
    AND job.object_path = p_storage_path
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.privacy_storage_deletion_outbox (
      deletion_receipt_id, source_code, bucket, object_path, next_attempt_at
    ) VALUES (
      NULL, 'capture_upload_compensation', 'posture-captures', p_storage_path,
      pg_catalog.clock_timestamp() + interval '15 minutes'
    );
    RETURN pg_catalog.jsonb_build_object('status', 'ready');
  END IF;

  IF v_intent.deletion_receipt_id IS NOT NULL
    OR v_intent.source_code <> 'capture_upload_compensation'
    OR v_intent.status = 'processing'
  THEN
    RETURN pg_catalog.jsonb_build_object('status', 'in_progress');
  END IF;

  UPDATE public.privacy_storage_deletion_outbox job
  SET status = 'pending',
      next_attempt_at = pg_catalog.clock_timestamp() + interval '15 minutes',
      locked_at = NULL,
      completed_at = NULL,
      last_error_code = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE job.id = v_intent.id;

  RETURN pg_catalog.jsonb_build_object('status', 'ready');
END;
$$;

-- Latest definition: 20260907052000_capture_upload_retry.sql
CREATE OR REPLACE FUNCTION public.finalize_capture_image_upload(
  p_assessment_id uuid,
  p_capture_id uuid,
  p_practitioner_id uuid,
  p_slot text,
  p_storage_path text,
  p_image_sha256 text,
  p_image_byte_size integer,
  p_image_width_px integer,
  p_image_height_px integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_capture public.captures%ROWTYPE;
  v_intent_id uuid;
BEGIN
  IF p_assessment_id IS NULL OR p_capture_id IS NULL OR p_practitioner_id IS NULL
    OR p_slot IS NULL OR p_slot NOT IN ('front', 'side-left', 'side-right', 'back')
    OR p_storage_path IS NULL
    OR p_image_sha256 IS NULL OR p_image_sha256 !~ '^[0-9a-f]{64}$'
    OR p_storage_path IS DISTINCT FROM (
      p_practitioner_id::text || '/' || p_assessment_id::text || '/'
      || p_capture_id::text || '/' || p_image_sha256 || '.jpg'
    )
    OR p_image_byte_size IS NULL OR p_image_byte_size NOT BETWEEN 1 AND 4194304
    OR p_image_width_px IS NULL OR p_image_width_px NOT BETWEEN 1 AND 16000000
    OR p_image_height_px IS NULL OR p_image_height_px NOT BETWEEN 1 AND 16000000
    OR p_image_width_px::bigint * p_image_height_px::bigint > 16000000
  THEN
    RETURN pg_catalog.jsonb_build_object('status', 'invalid_input');
  END IF;

  SELECT capture.* INTO v_capture
  FROM public.captures capture
  JOIN public.assessments assessment ON assessment.id = capture.assessment_id
  JOIN public.clients client ON client.id = assessment.client_id
  WHERE capture.id = p_capture_id
    AND capture.assessment_id = p_assessment_id
    AND capture.practitioner_id = p_practitioner_id
    AND assessment.practitioner_id = p_practitioner_id
    AND assessment.status = 'complete'
    AND client.practitioner_id = p_practitioner_id
    AND client.deleted_at IS NULL
    AND client.archived_at IS NULL
    AND private.capture_slot_matches(capture.view, capture.profile_side, p_slot)
  FOR UPDATE OF capture;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_found');
  END IF;

  IF v_capture.storage_path IS NOT NULL THEN
    IF v_capture.storage_path = p_storage_path
      AND v_capture.image_sha256 = p_image_sha256
    THEN
      DELETE FROM public.privacy_storage_deletion_outbox job
      WHERE job.deletion_receipt_id IS NULL
        AND job.source_code = 'capture_upload_compensation'
        AND job.bucket = 'posture-captures'
        AND job.object_path = p_storage_path
        AND job.status IN ('pending', 'retry', 'complete');
      RETURN pg_catalog.jsonb_build_object(
        'status', 'already_saved', 'captureId', v_capture.id
      );
    END IF;
    RETURN pg_catalog.jsonb_build_object('status', 'conflict');
  END IF;

  SELECT job.id INTO v_intent_id
  FROM public.privacy_storage_deletion_outbox job
  WHERE job.deletion_receipt_id IS NULL
    AND job.source_code = 'capture_upload_compensation'
    AND job.bucket = 'posture-captures'
    AND job.object_path = p_storage_path
    AND job.status IN ('pending', 'retry')
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'intent_missing');
  END IF;

  UPDATE public.captures
  SET storage_path = p_storage_path,
      image_sha256 = p_image_sha256,
      image_byte_size = p_image_byte_size,
      image_mime_type = 'image/jpeg',
      image_width_px = p_image_width_px,
      image_height_px = p_image_height_px
  WHERE id = v_capture.id;

  DELETE FROM public.privacy_storage_deletion_outbox WHERE id = v_intent_id;
  RETURN pg_catalog.jsonb_build_object('status', 'saved', 'captureId', v_capture.id);
END;
$$;

-- Latest definition: 20260907030000_prototype_operation.sql
CREATE OR REPLACE FUNCTION public.finalize_report_upload_prototype(
  p_assessment_id uuid,
  p_practitioner_id uuid,
  p_storage_path text,
  p_compared_to_assessment_id uuid,
  p_report_scope text,
  p_clinical_content_version text,
  p_clinical_inventory_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_client_id uuid;
  v_intent_id uuid;
  v_report public.reports%ROWTYPE;
BEGIN
  IF p_assessment_id IS NULL OR p_practitioner_id IS NULL
    OR p_storage_path IS NULL OR pg_catalog.char_length(p_storage_path) NOT BETWEEN 1 AND 1024
    OR NOT pg_catalog.starts_with(p_storage_path, p_practitioner_id::text || '/' || p_assessment_id::text || '/')
    OR p_report_scope NOT IN ('assessment_only', 'clinical_practitioner', 'clinical_client')
    OR (
      p_report_scope = 'assessment_only'
      AND (p_clinical_content_version IS NOT NULL OR p_clinical_inventory_sha256 IS NOT NULL)
    )
    OR (
      p_report_scope <> 'assessment_only'
      AND (
        p_clinical_content_version IS NULL
        OR p_clinical_inventory_sha256 !~ '^[0-9a-f]{64}$'
      )
    )
  THEN RETURN pg_catalog.jsonb_build_object('status', 'invalid_input'); END IF;

  PERFORM 1 FROM public.practitioners practitioner
  WHERE practitioner.id = p_practitioner_id
    AND practitioner.access_status = 'active'
    AND practitioner.role = 'practitioner'
  FOR SHARE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'practitioner_unavailable'); END IF;

  SELECT assessment.client_id INTO v_client_id
  FROM public.assessments assessment
  JOIN public.clients client ON client.id = assessment.client_id
  WHERE assessment.id = p_assessment_id
    AND assessment.practitioner_id = p_practitioner_id
    AND assessment.practitioner_approved = true
    AND client.practitioner_id = p_practitioner_id
    AND client.deleted_at IS NULL
    AND client.archived_at IS NULL
  FOR UPDATE OF client;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_found'); END IF;

  IF p_compared_to_assessment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.assessments prior
    WHERE prior.id = p_compared_to_assessment_id
      AND prior.practitioner_id = p_practitioner_id
      AND prior.client_id = v_client_id
      AND prior.practitioner_approved = true
  ) THEN RETURN pg_catalog.jsonb_build_object('status', 'invalid_comparison'); END IF;

  SELECT report.* INTO v_report
  FROM public.reports report
  WHERE report.practitioner_id = p_practitioner_id
    AND report.storage_path = p_storage_path
  ORDER BY report.generated_at, report.id
  LIMIT 1;
  IF FOUND THEN
    IF v_report.assessment_id = p_assessment_id
      AND v_report.compared_to_assessment_id IS NOT DISTINCT FROM p_compared_to_assessment_id
      AND v_report.operation_mode = 'prototype'
      AND v_report.legal_provenance_state = 'prototype'
      AND v_report.report_scope = p_report_scope
      AND v_report.clinical_content_version IS NOT DISTINCT FROM p_clinical_content_version
      AND v_report.clinical_inventory_sha256 IS NOT DISTINCT FROM p_clinical_inventory_sha256
      AND v_report.clinical_review_receipt_sha256 IS NULL
    THEN RETURN pg_catalog.jsonb_build_object('status', 'created', 'report_id', v_report.id); END IF;
    RETURN pg_catalog.jsonb_build_object('status', 'provenance_conflict');
  END IF;

  SELECT job.id INTO v_intent_id
  FROM public.privacy_storage_deletion_outbox job
  WHERE job.deletion_receipt_id IS NULL
    AND job.source_code = 'report_insert_compensation'
    AND job.bucket = 'posture-reports'
    AND job.object_path = p_storage_path
    AND job.status IN ('pending', 'retry')
  FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'intent_missing'); END IF;

  INSERT INTO public.reports (
    assessment_id, practitioner_id, storage_path, compared_to_assessment_id,
    operation_mode, legal_provenance_state, report_scope,
    clinical_content_version, clinical_inventory_sha256,
    clinical_review_receipt_sha256
  ) VALUES (
    p_assessment_id, p_practitioner_id, p_storage_path, p_compared_to_assessment_id,
    'prototype', 'prototype', p_report_scope,
    p_clinical_content_version, p_clinical_inventory_sha256, NULL
  ) RETURNING * INTO v_report;

  DELETE FROM public.privacy_storage_deletion_outbox WHERE id = v_intent_id;
  RETURN pg_catalog.jsonb_build_object('status', 'created', 'report_id', v_report.id);
END;
$$;

-- Latest definition: 20260720020000_clinical_content_governance.sql
CREATE OR REPLACE FUNCTION public.finalize_report_upload_v2(
  p_assessment_id uuid,
  p_practitioner_id uuid,
  p_storage_path text,
  p_compared_to_assessment_id uuid,
  p_document_id text,
  p_document_version text,
  p_document_body_sha256 text,
  p_document_effective_at timestamptz,
  p_jurisdiction text,
  p_product_scope text,
  p_report_scope text,
  p_clinical_content_version text,
  p_clinical_inventory_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_client_id uuid;
  v_intent_id uuid;
  v_report public.reports%ROWTYPE;
  v_clinical_receipt text;
BEGIN
  IF p_assessment_id IS NULL OR p_practitioner_id IS NULL
    OR p_storage_path IS NULL OR pg_catalog.char_length(p_storage_path) NOT BETWEEN 1 AND 1024
    OR NOT pg_catalog.starts_with(
      p_storage_path,
      p_practitioner_id::text || '/' || p_assessment_id::text || '/'
    )
    OR p_document_id IS NULL OR p_document_version IS NULL
    OR p_document_body_sha256 !~ '^[0-9a-f]{64}$'
    OR p_document_effective_at IS NULL OR p_jurisdiction IS NULL OR p_product_scope IS NULL
    OR p_report_scope NOT IN ('assessment_only', 'clinical_practitioner', 'clinical_client')
    OR (
      p_report_scope = 'assessment_only'
      AND (p_clinical_content_version IS NOT NULL OR p_clinical_inventory_sha256 IS NOT NULL)
    )
    OR (
      p_report_scope <> 'assessment_only'
      AND (
        p_clinical_content_version IS NULL
        OR p_clinical_inventory_sha256 !~ '^[0-9a-f]{64}$'
      )
    )
  THEN RETURN pg_catalog.jsonb_build_object('status', 'invalid_input'); END IF;

  IF p_report_scope <> 'assessment_only' THEN
    v_clinical_receipt := private.active_clinical_receipt(
      p_clinical_content_version,
      p_clinical_inventory_sha256,
      CASE p_report_scope
        WHEN 'clinical_practitioner' THEN 'clinical_practitioner_report'
        ELSE 'clinical_client_report'
      END
    );
    IF v_clinical_receipt IS NULL THEN
      RETURN pg_catalog.jsonb_build_object('status', 'clinical_content_unavailable');
    END IF;
  END IF;

  SELECT a.client_id INTO v_client_id
  FROM public.assessments a
  JOIN public.clients c ON c.id = a.client_id
  WHERE a.id = p_assessment_id
    AND a.practitioner_id = p_practitioner_id
    AND a.practitioner_approved = true
    AND c.practitioner_id = p_practitioner_id
    AND c.deleted_at IS NULL
    AND c.archived_at IS NULL
  FOR UPDATE OF c;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_found'); END IF;

  IF p_compared_to_assessment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.assessments prior
    WHERE prior.id = p_compared_to_assessment_id
      AND prior.practitioner_id = p_practitioner_id
      AND prior.client_id = v_client_id
      AND prior.practitioner_approved = true
  ) THEN RETURN pg_catalog.jsonb_build_object('status', 'invalid_comparison'); END IF;

  SELECT report.* INTO v_report
  FROM public.reports report
  WHERE report.practitioner_id = p_practitioner_id
    AND report.storage_path = p_storage_path
  ORDER BY report.generated_at, report.id
  LIMIT 1;
  IF FOUND THEN
    IF v_report.assessment_id = p_assessment_id
      AND v_report.compared_to_assessment_id IS NOT DISTINCT FROM p_compared_to_assessment_id
      AND v_report.report_scope = p_report_scope
      AND v_report.clinical_content_version IS NOT DISTINCT FROM p_clinical_content_version
      AND v_report.clinical_inventory_sha256 IS NOT DISTINCT FROM p_clinical_inventory_sha256
      AND v_report.clinical_review_receipt_sha256 IS NOT DISTINCT FROM v_clinical_receipt
    THEN
      RETURN pg_catalog.jsonb_build_object('status', 'created', 'report_id', v_report.id);
    END IF;
    RETURN pg_catalog.jsonb_build_object('status', 'provenance_conflict');
  END IF;

  SELECT job.id INTO v_intent_id
  FROM public.privacy_storage_deletion_outbox job
  WHERE job.deletion_receipt_id IS NULL
    AND job.source_code = 'report_insert_compensation'
    AND job.bucket = 'posture-reports'
    AND job.object_path = p_storage_path
    AND job.status IN ('pending', 'retry')
  FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'intent_missing'); END IF;

  INSERT INTO public.reports (
    assessment_id, practitioner_id, storage_path, compared_to_assessment_id,
    legal_document_id, legal_document_version, legal_document_body_sha256,
    legal_document_effective_at, legal_jurisdiction, legal_product_scope,
    legal_provenance_state, report_scope, clinical_content_version,
    clinical_inventory_sha256, clinical_review_receipt_sha256
  ) VALUES (
    p_assessment_id, p_practitioner_id, p_storage_path, p_compared_to_assessment_id,
    p_document_id, p_document_version, p_document_body_sha256,
    p_document_effective_at, p_jurisdiction, p_product_scope,
    'governed', p_report_scope, p_clinical_content_version,
    p_clinical_inventory_sha256, v_clinical_receipt
  ) RETURNING * INTO v_report;

  DELETE FROM public.privacy_storage_deletion_outbox WHERE id = v_intent_id;
  RETURN pg_catalog.jsonb_build_object('status', 'created', 'report_id', v_report.id);
END;
$$;

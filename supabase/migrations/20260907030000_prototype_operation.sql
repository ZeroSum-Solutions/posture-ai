-- Explicit prototype operation for the original persistent application.
-- Historical rows retain the value `legacy`; new ordinary writes default to
-- `governed`. Prototype writers must opt in row by row and carry no legal
-- document, signature, clinical-review receipt, or public share token.

ALTER TABLE public.clients
  ADD COLUMN operation_mode text NOT NULL DEFAULT 'legacy';
ALTER TABLE public.assessments
  ADD COLUMN operation_mode text NOT NULL DEFAULT 'legacy';
ALTER TABLE public.reports
  ADD COLUMN operation_mode text NOT NULL DEFAULT 'legacy';
ALTER TABLE public.workout_sessions
  ADD COLUMN operation_mode text NOT NULL DEFAULT 'legacy';

ALTER TABLE public.clients ALTER COLUMN operation_mode SET DEFAULT 'governed';
ALTER TABLE public.assessments ALTER COLUMN operation_mode SET DEFAULT 'governed';
ALTER TABLE public.reports ALTER COLUMN operation_mode SET DEFAULT 'governed';
ALTER TABLE public.workout_sessions ALTER COLUMN operation_mode SET DEFAULT 'governed';

ALTER TABLE public.clients
  ADD CONSTRAINT clients_operation_mode CHECK (operation_mode IN ('legacy', 'governed', 'prototype')) NOT VALID;
ALTER TABLE public.assessments
  ADD CONSTRAINT assessments_operation_mode CHECK (operation_mode IN ('legacy', 'governed', 'prototype')) NOT VALID;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_operation_mode CHECK (operation_mode IN ('legacy', 'governed', 'prototype')) NOT VALID;
ALTER TABLE public.workout_sessions
  ADD CONSTRAINT workout_sessions_operation_mode CHECK (operation_mode IN ('legacy', 'governed', 'prototype')) NOT VALID;

ALTER TABLE public.clients VALIDATE CONSTRAINT clients_operation_mode;
ALTER TABLE public.assessments VALIDATE CONSTRAINT assessments_operation_mode;
ALTER TABLE public.reports VALIDATE CONSTRAINT reports_operation_mode;
ALTER TABLE public.workout_sessions VALIDATE CONSTRAINT workout_sessions_operation_mode;

COMMENT ON COLUMN public.clients.operation_mode IS
  'legacy preserves pre-operation-mode rows; governed is the default; prototype is an explicit server-authorized workflow.';
COMMENT ON COLUMN public.assessments.operation_mode IS
  'Prototype assessments contain no subject-consent document provenance.';
COMMENT ON COLUMN public.reports.operation_mode IS
  'Prototype reports contain no legal-document or clinical-review receipt provenance.';
COMMENT ON COLUMN public.workout_sessions.operation_mode IS
  'Prototype workouts are authenticated in-clinic artifacts and cannot be shared by bearer token.';

-- Prototype is a separate truthful legal state: all document fields are null.
-- Consent tables stay governed-only; prototype operation creates no consent
-- token or record.
ALTER TABLE public.assessments DROP CONSTRAINT assessments_legal_provenance_shape;
ALTER TABLE public.assessments
  ADD CONSTRAINT assessments_legal_provenance_shape CHECK (
    (
      operation_mode <> 'prototype'
      AND
      legal_provenance_state = 'legacy_unverified'
      AND legal_document_id IS NULL
      AND legal_document_version IS NULL
      AND legal_document_body_sha256 IS NULL
      AND legal_document_effective_at IS NULL
      AND legal_jurisdiction IS NULL
      AND legal_product_scope IS NULL
    ) OR (
      operation_mode <> 'prototype'
      AND
      legal_provenance_state = 'governed'
      AND legal_document_id IS NOT NULL
      AND pg_catalog.char_length(pg_catalog.btrim(legal_document_id)) BETWEEN 1 AND 128
      AND legal_document_version IS NOT NULL
      AND pg_catalog.char_length(pg_catalog.btrim(legal_document_version)) BETWEEN 1 AND 128
      AND legal_document_body_sha256 ~ '^[0-9a-f]{64}$'
      AND legal_document_effective_at IS NOT NULL
      AND legal_jurisdiction IS NOT NULL
      AND pg_catalog.char_length(pg_catalog.btrim(legal_jurisdiction)) BETWEEN 1 AND 32
      AND legal_product_scope IS NOT NULL
      AND pg_catalog.char_length(pg_catalog.btrim(legal_product_scope)) BETWEEN 1 AND 128
    ) OR (
      operation_mode = 'prototype'
      AND legal_provenance_state = 'prototype'
      AND legal_document_id IS NULL
      AND legal_document_version IS NULL
      AND legal_document_body_sha256 IS NULL
      AND legal_document_effective_at IS NULL
      AND legal_jurisdiction IS NULL
      AND legal_product_scope IS NULL
    )
  ) NOT VALID;

ALTER TABLE public.reports DROP CONSTRAINT reports_legal_provenance_shape;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_legal_provenance_shape CHECK (
    (
      operation_mode <> 'prototype'
      AND
      legal_provenance_state = 'legacy_unverified'
      AND legal_document_id IS NULL
      AND legal_document_version IS NULL
      AND legal_document_body_sha256 IS NULL
      AND legal_document_effective_at IS NULL
      AND legal_jurisdiction IS NULL
      AND legal_product_scope IS NULL
    ) OR (
      operation_mode <> 'prototype'
      AND
      legal_provenance_state = 'governed'
      AND legal_document_id IS NOT NULL
      AND pg_catalog.char_length(pg_catalog.btrim(legal_document_id)) BETWEEN 1 AND 128
      AND legal_document_version IS NOT NULL
      AND pg_catalog.char_length(pg_catalog.btrim(legal_document_version)) BETWEEN 1 AND 128
      AND legal_document_body_sha256 ~ '^[0-9a-f]{64}$'
      AND legal_document_effective_at IS NOT NULL
      AND legal_jurisdiction IS NOT NULL
      AND pg_catalog.char_length(pg_catalog.btrim(legal_jurisdiction)) BETWEEN 1 AND 32
      AND legal_product_scope IS NOT NULL
      AND pg_catalog.char_length(pg_catalog.btrim(legal_product_scope)) BETWEEN 1 AND 128
    ) OR (
      operation_mode = 'prototype'
      AND legal_provenance_state = 'prototype'
      AND legal_document_id IS NULL
      AND legal_document_version IS NULL
      AND legal_document_body_sha256 IS NULL
      AND legal_document_effective_at IS NULL
      AND legal_jurisdiction IS NULL
      AND legal_product_scope IS NULL
    )
  ) NOT VALID;

ALTER TABLE public.workout_sessions DROP CONSTRAINT workout_sessions_legal_provenance_shape;
ALTER TABLE public.workout_sessions
  ADD CONSTRAINT workout_sessions_legal_provenance_shape CHECK (
    (
      operation_mode <> 'prototype'
      AND
      legal_provenance_state = 'legacy_unverified'
      AND legal_document_id IS NULL
      AND legal_document_version IS NULL
      AND legal_document_body_sha256 IS NULL
      AND legal_document_effective_at IS NULL
      AND legal_jurisdiction IS NULL
      AND legal_product_scope IS NULL
    ) OR (
      operation_mode <> 'prototype'
      AND
      legal_provenance_state = 'governed'
      AND legal_document_id IS NOT NULL
      AND pg_catalog.char_length(pg_catalog.btrim(legal_document_id)) BETWEEN 1 AND 128
      AND legal_document_version IS NOT NULL
      AND pg_catalog.char_length(pg_catalog.btrim(legal_document_version)) BETWEEN 1 AND 128
      AND legal_document_body_sha256 ~ '^[0-9a-f]{64}$'
      AND legal_document_effective_at IS NOT NULL
      AND legal_jurisdiction IS NOT NULL
      AND pg_catalog.char_length(pg_catalog.btrim(legal_jurisdiction)) BETWEEN 1 AND 32
      AND legal_product_scope IS NOT NULL
      AND pg_catalog.char_length(pg_catalog.btrim(legal_product_scope)) BETWEEN 1 AND 128
    ) OR (
      operation_mode = 'prototype'
      AND legal_provenance_state = 'prototype'
      AND legal_document_id IS NULL
      AND legal_document_version IS NULL
      AND legal_document_body_sha256 IS NULL
      AND legal_document_effective_at IS NULL
      AND legal_jurisdiction IS NULL
      AND legal_product_scope IS NULL
    )
  ) NOT VALID;

ALTER TABLE public.assessments VALIDATE CONSTRAINT assessments_legal_provenance_shape;
ALTER TABLE public.reports VALIDATE CONSTRAINT reports_legal_provenance_shape;
ALTER TABLE public.workout_sessions VALIDATE CONSTRAINT workout_sessions_legal_provenance_shape;

CREATE FUNCTION private.reject_operation_mode_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.operation_mode IS DISTINCT FROM OLD.operation_mode THEN
    RAISE EXCEPTION 'operation mode is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER clients_operation_mode_immutable
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION private.reject_operation_mode_update();
CREATE TRIGGER assessments_operation_mode_immutable
  BEFORE UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION private.reject_operation_mode_update();
CREATE TRIGGER reports_operation_mode_immutable
  BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION private.reject_operation_mode_update();
CREATE TRIGGER workout_sessions_operation_mode_immutable
  BEFORE UPDATE ON public.workout_sessions
  FOR EACH ROW EXECUTE FUNCTION private.reject_operation_mode_update();
REVOKE ALL ON FUNCTION private.reject_operation_mode_update()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- A prototype report may carry the exact catalog identity used to render its
-- content, but never an HG-03 receipt. Historical and governed shapes remain
-- unchanged.
ALTER TABLE public.reports DROP CONSTRAINT reports_clinical_scope_shape;
ALTER TABLE public.reports
  ADD CONSTRAINT reports_clinical_scope_shape CHECK (
    (
      operation_mode <> 'prototype'
      AND report_scope IN ('legacy_unversioned', 'assessment_only')
      AND clinical_content_version IS NULL
      AND clinical_inventory_sha256 IS NULL
      AND clinical_review_receipt_sha256 IS NULL
    ) OR (
      operation_mode <> 'prototype'
      AND report_scope IN ('clinical_practitioner', 'clinical_client')
      AND clinical_content_version IS NOT NULL
      AND clinical_inventory_sha256 ~ '^[0-9a-f]{64}$'
      AND clinical_review_receipt_sha256 ~ '^[0-9a-f]{64}$'
    ) OR (
      operation_mode = 'prototype'
      AND report_scope = 'assessment_only'
      AND clinical_content_version IS NULL
      AND clinical_inventory_sha256 IS NULL
      AND clinical_review_receipt_sha256 IS NULL
    ) OR (
      operation_mode = 'prototype'
      AND report_scope IN ('clinical_practitioner', 'clinical_client')
      AND clinical_content_version IS NOT NULL
      AND clinical_inventory_sha256 ~ '^[0-9a-f]{64}$'
      AND clinical_review_receipt_sha256 IS NULL
    )
  ) NOT VALID;
ALTER TABLE public.reports VALIDATE CONSTRAINT reports_clinical_scope_shape;

CREATE OR REPLACE FUNCTION private.enforce_report_clinical_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt text;
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(
    OLD.report_scope,
    OLD.clinical_content_version,
    OLD.clinical_inventory_sha256,
    OLD.clinical_review_receipt_sha256
  ) IS DISTINCT FROM ROW(
    NEW.report_scope,
    NEW.clinical_content_version,
    NEW.clinical_inventory_sha256,
    NEW.clinical_review_receipt_sha256
  ) THEN
    RAISE EXCEPTION 'report clinical provenance is immutable' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.operation_mode = 'prototype' THEN
      IF NEW.clinical_review_receipt_sha256 IS NOT NULL THEN
        RAISE EXCEPTION 'prototype report cannot claim a clinical review receipt' USING ERRCODE = '55000';
      END IF;
    ELSIF NEW.report_scope = 'legacy_unversioned' THEN
      RAISE EXCEPTION 'new legacy-unversioned reports are disabled' USING ERRCODE = '55000';
    ELSIF NEW.report_scope IN ('clinical_practitioner', 'clinical_client') THEN
      v_receipt := private.active_clinical_receipt(
        NEW.clinical_content_version,
        NEW.clinical_inventory_sha256,
        CASE NEW.report_scope
          WHEN 'clinical_practitioner' THEN 'clinical_practitioner_report'
          ELSE 'clinical_client_report'
        END
      );
      IF v_receipt IS NULL OR v_receipt <> NEW.clinical_review_receipt_sha256 THEN
        RAISE EXCEPTION 'clinical report release is not active' USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- A prototype workout stores the catalog tuple without a review receipt. The
-- v4 snapshot marks the content as prototype_unreviewed and has no legalNotice.
ALTER TABLE public.workout_sessions DROP CONSTRAINT workout_sessions_clinical_provenance_shape;
ALTER TABLE public.workout_sessions
  ADD CONSTRAINT workout_sessions_clinical_provenance_shape CHECK (
    (
      operation_mode <> 'prototype'
      AND clinical_content_version IS NULL
      AND clinical_inventory_sha256 IS NULL
      AND clinical_review_receipt_sha256 IS NULL
    ) OR (
      operation_mode <> 'prototype'
      AND clinical_content_version IS NOT NULL
      AND clinical_inventory_sha256 ~ '^[0-9a-f]{64}$'
      AND clinical_review_receipt_sha256 ~ '^[0-9a-f]{64}$'
    ) OR (
      operation_mode = 'prototype'
      AND clinical_content_version IS NOT NULL
      AND clinical_inventory_sha256 ~ '^[0-9a-f]{64}$'
      AND clinical_review_receipt_sha256 IS NULL
    )
  ) NOT VALID;
ALTER TABLE public.workout_sessions VALIDATE CONSTRAINT workout_sessions_clinical_provenance_shape;

CREATE OR REPLACE FUNCTION private.enforce_workout_program_snapshot_provenance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_notice jsonb;
  v_notice_effective_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.program_snapshot IS DISTINCT FROM OLD.program_snapshot THEN
    RAISE EXCEPTION 'workout program snapshot is immutable' USING ERRCODE = '55000';
  END IF;

  IF NEW.legal_provenance_state = 'prototype' THEN
    IF pg_catalog.jsonb_typeof(NEW.program_snapshot) IS DISTINCT FROM 'object'
      OR NEW.program_snapshot->>'version' IS DISTINCT FROM '4'
      OR NEW.program_snapshot->>'operationMode' IS DISTINCT FROM 'prototype'
      OR NEW.program_snapshot->>'contentState' IS DISTINCT FROM 'prototype_unreviewed'
      OR NEW.program_snapshot ? 'legalNotice'
    THEN
      RAISE EXCEPTION 'prototype workout snapshot provenance is invalid' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.legal_provenance_state = 'governed' THEN
    v_notice := NEW.program_snapshot -> 'legalNotice';
    IF pg_catalog.jsonb_typeof(NEW.program_snapshot) IS DISTINCT FROM 'object'
      OR NEW.program_snapshot ->> 'version' IS NULL
      OR NEW.program_snapshot ->> 'version' NOT IN ('2', '3')
      OR pg_catalog.jsonb_typeof(v_notice) IS DISTINCT FROM 'object'
      OR v_notice ->> 'schemaVersion' IS DISTINCT FROM '1'
      OR v_notice ->> 'kind' IS DISTINCT FROM 'screening_notice'
      OR v_notice ->> 'documentId' IS DISTINCT FROM NEW.legal_document_id
      OR v_notice ->> 'version' IS DISTINCT FROM NEW.legal_document_version
      OR v_notice ->> 'bodySha256' IS DISTINCT FROM NEW.legal_document_body_sha256
      OR v_notice ->> 'jurisdiction' IS DISTINCT FROM NEW.legal_jurisdiction
      OR v_notice ->> 'productScope' IS DISTINCT FROM NEW.legal_product_scope
    THEN
      RAISE EXCEPTION 'workout snapshot legal notice does not match stored provenance' USING ERRCODE = '55000';
    END IF;
    BEGIN
      v_notice_effective_at := (v_notice ->> 'effectiveAt')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'workout snapshot legal notice does not match stored provenance' USING ERRCODE = '55000';
    END;
    IF v_notice_effective_at IS DISTINCT FROM NEW.legal_document_effective_at THEN
      RAISE EXCEPTION 'workout snapshot legal notice does not match stored provenance' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_workout_clinical_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt text;
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(
    OLD.clinical_content_version,
    OLD.clinical_inventory_sha256,
    OLD.clinical_review_receipt_sha256
  ) IS DISTINCT FROM ROW(
    NEW.clinical_content_version,
    NEW.clinical_inventory_sha256,
    NEW.clinical_review_receipt_sha256
  ) THEN
    RAISE EXCEPTION 'workout clinical provenance is immutable' USING ERRCODE = '55000';
  END IF;

  IF NEW.operation_mode = 'prototype' THEN
    IF NEW.session_token_hash IS NOT NULL OR NEW.expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'prototype workout sharing is disabled' USING ERRCODE = '55000';
    END IF;
    IF NEW.clinical_review_receipt_sha256 IS NOT NULL
      OR NEW.program_snapshot->>'version' IS DISTINCT FROM '4'
      OR NEW.program_snapshot->>'operationMode' IS DISTINCT FROM 'prototype'
      OR NEW.program_snapshot->>'contentState' IS DISTINCT FROM 'prototype_unreviewed'
      OR NEW.program_snapshot#>>'{clinicalContent,version}' IS DISTINCT FROM NEW.clinical_content_version
      OR NEW.program_snapshot#>>'{clinicalContent,inventorySha256}' IS DISTINCT FROM NEW.clinical_inventory_sha256
    THEN
      RAISE EXCEPTION 'prototype workout catalog provenance is invalid' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF ROW(
      OLD.session_token_hash,
      OLD.expires_at,
      OLD.revoked_at,
      OLD.share_generation
    ) IS DISTINCT FROM ROW(
      NEW.session_token_hash,
      NEW.expires_at,
      NEW.revoked_at,
      NEW.share_generation
    ) AND NOT (
      NEW.session_token_hash IS NULL
      AND NEW.expires_at IS NULL
      AND NEW.revoked_at IS NOT NULL
    ) THEN
      v_receipt := private.active_clinical_receipt(
        NEW.clinical_content_version,
        NEW.clinical_inventory_sha256,
        'workouts'
      );
      IF NEW.clinical_content_version IS NULL
        OR NEW.clinical_inventory_sha256 IS NULL
        OR NEW.clinical_review_receipt_sha256 IS NULL
        OR v_receipt IS NULL
        OR v_receipt <> NEW.clinical_review_receipt_sha256
      THEN
        RAISE EXCEPTION 'workout clinical release is not active' USING ERRCODE = '55000';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  v_receipt := private.active_clinical_receipt(
    NEW.clinical_content_version,
    NEW.clinical_inventory_sha256,
    'workouts'
  );
  IF v_receipt IS NULL OR v_receipt <> NEW.clinical_review_receipt_sha256 THEN
    RAISE EXCEPTION 'workout clinical release is not active' USING ERRCODE = '55000';
  END IF;
  IF NEW.program_snapshot->>'version' <> '3'
    OR NEW.program_snapshot#>>'{clinicalContent,version}' <> NEW.clinical_content_version
    OR NEW.program_snapshot#>>'{clinicalContent,inventorySha256}' <> NEW.clinical_inventory_sha256
  THEN
    RAISE EXCEPTION 'workout snapshot clinical content does not match stored provenance' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_active_workout_child()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.workout_sessions session
    WHERE session.id = NEW.workout_session_id
      AND (
        session.operation_mode = 'prototype'
        OR private.active_clinical_receipt(
          session.clinical_content_version,
          session.clinical_inventory_sha256,
          'workouts'
        ) = session.clinical_review_receipt_sha256
      )
  ) THEN
    RAISE EXCEPTION 'workout clinical release is not active' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- Atomic assessment creation prevents a processing row from surviving a child
-- write failure. The server scores first, then supplies only minimized capture
-- frames and bounded findings to this transaction.
CREATE FUNCTION public.create_assessment_prototype(
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

-- Authenticated, in-clinic prototype workout creation. Ownership, active
-- practitioner status, assessment approval, metadata shape, snapshot/catalog
-- binding, and child creation all resolve in one transaction.
CREATE FUNCTION public.create_workout_session_prototype(
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

-- Prototype report finalization retains the existing upload-compensation and
-- owned approved-assessment checks without minting legal or clinical approval.
CREATE FUNCTION public.finalize_report_upload_prototype(
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

REVOKE ALL ON FUNCTION public.create_assessment_prototype(
  uuid, uuid, uuid, text, jsonb, jsonb, numeric, text, text, boolean, boolean, numeric
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.create_assessment_prototype(
  uuid, uuid, uuid, text, jsonb, jsonb, numeric, text, text, boolean, boolean, numeric
) TO service_role;

REVOKE ALL ON FUNCTION public.create_workout_session_prototype(
  uuid, uuid, uuid, int, text, jsonb, int, uuid, text, jsonb, text, text, text
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.create_workout_session_prototype(
  uuid, uuid, uuid, int, text, jsonb, int, uuid, text, jsonb, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_report_upload_prototype(
  uuid, uuid, text, uuid, text, text, text
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.finalize_report_upload_prototype(
  uuid, uuid, text, uuid, text, text, text
) TO service_role;

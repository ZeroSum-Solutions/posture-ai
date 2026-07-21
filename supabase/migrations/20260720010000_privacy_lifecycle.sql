-- PR-06 privacy lifecycle hardening.
--
-- This migration makes consent withdrawal, share rotation/revocation, database
-- erasure, and external object deletion explicit state machines. Database
-- erasure is one transaction. External object deletion is intentionally an
-- idempotent outbox because Postgres cannot participate in the storage
-- provider's transaction. Retention periods remain inactive until an approved
-- source-controlled policy is inserted after HG-02; the scheduler safely no-ops
-- against the empty policy table.

-- ============================================================================
-- 1. Controlled lifecycle fields; remove legacy free-text erasure reasons.
-- ============================================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS deletion_reason_code text;

UPDATE public.clients
SET deletion_reason = NULL,
    deletion_reason_code = COALESCE(deletion_reason_code, 'legacy_unspecified')
WHERE deleted_at IS NOT NULL;
UPDATE public.clients
SET deletion_reason = NULL,
    deletion_reason_code = NULL
WHERE deleted_at IS NULL;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_deletion_reason_code_shape CHECK (
    (deleted_at IS NULL AND deletion_reason_code IS NULL AND deletion_reason IS NULL)
    OR
    (
      deleted_at IS NOT NULL
      AND deletion_reason IS NULL
      AND deletion_reason_code IN (
        'subject_request',
        'guardian_request',
        'duplicate_record',
        'practitioner_correction',
        'retention_policy',
        'legacy_unspecified'
      )
    )
  ) NOT VALID;

ALTER TABLE public.client_deletion_log
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS storage_objects_enqueued int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS storage_objects_deleted int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS external_deletion_status text NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

UPDATE public.client_deletion_log
SET reason = NULL,
    reason_code = COALESCE(reason_code, 'legacy_unspecified'),
    completed_at = COALESCE(completed_at, deleted_at),
    external_deletion_status = 'complete';

ALTER TABLE public.client_deletion_log
  ADD CONSTRAINT client_deletion_log_privacy_shape CHECK (
    reason IS NULL
    AND reason_code IN (
      'subject_request',
      'guardian_request',
      'duplicate_record',
      'practitioner_correction',
      'retention_policy',
      'legacy_unspecified'
    )
    AND storage_objects_enqueued >= 0
    AND storage_objects_deleted >= 0
    AND storage_objects_deleted <= storage_objects_enqueued
    AND external_deletion_status IN ('pending', 'complete')
    AND (
      (external_deletion_status = 'pending' AND completed_at IS NULL)
      OR (external_deletion_status = 'complete' AND completed_at IS NOT NULL)
    )
  ) NOT VALID;

ALTER TABLE public.consent_records
  ADD COLUMN IF NOT EXISTS reason_code text;

ALTER TABLE public.consent_records
  ADD CONSTRAINT consent_records_reason_code_shape CHECK (
    (kind <> 'revocation' AND reason_code IS NULL)
    OR
    (
      kind = 'revocation'
      AND (
        reason_code IN ('subject_request', 'guardian_request', 'practitioner_correction')
        OR (legal_provenance_state = 'legacy_unverified' AND reason_code IS NULL)
      )
    )
  ) NOT VALID;

-- Existing audit actor text is converted to a controlled code and then erased.
ALTER TABLE public.workout_share_events
  ADD COLUMN IF NOT EXISTS actor_code text,
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS operation_id uuid,
  ADD COLUMN IF NOT EXISTS share_generation int;

UPDATE public.workout_share_events
SET actor_code = CASE
      WHEN actor IN ('practitioner', 'client', 'system') THEN actor
      ELSE 'legacy_unspecified'
    END,
    actor = NULL,
    reason_code = CASE
      WHEN event = 'accessed' THEN NULL
      ELSE COALESCE(reason_code, 'legacy_unspecified')
    END,
    operation_id = COALESCE(operation_id, id),
    share_generation = COALESCE(share_generation, 1);

ALTER TABLE public.workout_share_events
  DROP CONSTRAINT IF EXISTS workout_share_events_event_check;
ALTER TABLE public.workout_share_events
  ADD CONSTRAINT workout_share_events_event_check
    CHECK (event IN ('minted', 'rotated', 'revoked', 'accessed'));
ALTER TABLE public.workout_share_events
  ADD CONSTRAINT workout_share_events_privacy_shape CHECK (
    actor IS NULL
    AND actor_code IN ('practitioner', 'client', 'system', 'legacy_unspecified')
    AND operation_id IS NOT NULL
    AND share_generation IS NOT NULL
    AND share_generation >= 1
    AND (
      (event = 'accessed' AND reason_code IS NULL)
      OR
      (event IN ('minted', 'rotated') AND reason_code IN ('practitioner_action', 'consent_withdrawn', 'legacy_unspecified'))
      OR
      (event = 'revoked' AND reason_code IN ('practitioner_action', 'consent_withdrawn', 'client_erasure', 'legacy_unspecified'))
    )
  ) NOT VALID;

-- Legacy rows are normalized above, so these constraints protect both existing
-- history and every future write instead of remaining upgrade-only promises.
ALTER TABLE public.clients VALIDATE CONSTRAINT clients_deletion_reason_code_shape;
ALTER TABLE public.client_deletion_log VALIDATE CONSTRAINT client_deletion_log_privacy_shape;
ALTER TABLE public.consent_records VALIDATE CONSTRAINT consent_records_reason_code_shape;
ALTER TABLE public.workout_share_events VALIDATE CONSTRAINT workout_share_events_privacy_shape;

ALTER TABLE public.workout_share_events
  ALTER COLUMN workout_session_id DROP NOT NULL;
ALTER TABLE public.workout_share_events
  DROP CONSTRAINT IF EXISTS workout_share_events_workout_session_id_fkey;
ALTER TABLE public.workout_share_events
  ADD CONSTRAINT workout_share_events_workout_session_id_fkey
    FOREIGN KEY (workout_session_id) REFERENCES public.workout_sessions(id) ON DELETE SET NULL;

ALTER TABLE public.workout_sessions
  ADD COLUMN IF NOT EXISTS share_generation int NOT NULL DEFAULT 1;
ALTER TABLE public.workout_sessions
  ADD CONSTRAINT workout_sessions_share_generation_positive CHECK (share_generation >= 1);

-- A revoked or never-shared row is a one-way state. This trigger protects the
-- invariant even if an older application deployment writes the table directly
-- instead of calling the governed RPCs. INSERT locks the client before checking
-- consent; UPDATE already holds the session row, which serializes it with the
-- withdrawal/revocation updates that clear the same token.
CREATE FUNCTION private.enforce_workout_share_monotonicity()
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

DROP TRIGGER IF EXISTS enforce_workout_share_monotonicity ON public.workout_sessions;
CREATE TRIGGER enforce_workout_share_monotonicity
BEFORE INSERT OR UPDATE OF session_token_hash, expires_at, revoked_at,
  share_generation, client_id, practitioner_id
ON public.workout_sessions
FOR EACH ROW EXECUTE FUNCTION private.enforce_workout_share_monotonicity();

-- These older trigger functions used unqualified relation names. A governed
-- SECURITY DEFINER RPC intentionally runs with an empty search_path, which is
-- inherited by trigger execution and made the deleted-client guards fail with
-- "relation clients does not exist" instead of enforcing their policy.
CREATE OR REPLACE FUNCTION public.reject_insert_for_deleted_client()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM public.clients c
  WHERE c.id = NEW.client_id AND c.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cannot create a record for a deleted or unknown client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_report_for_deleted_client()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM public.assessments a
  JOIN public.clients c ON c.id = a.client_id
  WHERE a.id = NEW.assessment_id AND c.deleted_at IS NULL
  FOR UPDATE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cannot create a report for a deleted or unknown client'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.compared_to_assessment_id IS NOT NULL THEN
    PERFORM 1
    FROM public.assessments a
    JOIN public.clients c ON c.id = a.client_id
    WHERE a.id = NEW.compared_to_assessment_id AND c.deleted_at IS NULL
    FOR UPDATE OF c;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'cannot create a report comparing against a deleted or unknown client'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- The public resolver exposes the current generation only to the server so an
-- access event can be bound to the credential generation that authorized it.
DROP FUNCTION public.resolve_workout_token(text);
CREATE FUNCTION public.resolve_workout_token(p_token_hash text)
RETURNS TABLE (
  workout_session_id uuid,
  practitioner_id uuid,
  client_id uuid,
  session_run_id uuid,
  program_snapshot jsonb,
  estimated_duration_sec int,
  client_first_name text,
  expires_at timestamptz,
  share_generation int,
  legal_document_id text,
  legal_document_version text,
  legal_document_body_sha256 text,
  legal_document_effective_at timestamptz,
  legal_jurisdiction text,
  legal_product_scope text,
  legal_provenance_state text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    ws.id,
    ws.practitioner_id,
    ws.client_id,
    (SELECT sr.id FROM public.session_runs sr
      WHERE sr.workout_session_id = ws.id
      ORDER BY sr.created_at ASC
      LIMIT 1),
    ws.program_snapshot,
    ws.estimated_duration_sec,
    c.first_name,
    ws.expires_at,
    ws.share_generation,
    ws.legal_document_id,
    ws.legal_document_version,
    ws.legal_document_body_sha256,
    ws.legal_document_effective_at,
    ws.legal_jurisdiction,
    ws.legal_product_scope,
    ws.legal_provenance_state
  FROM public.workout_sessions ws
  JOIN public.assessments a ON a.id = ws.assessment_id
  JOIN public.clients c ON c.id = ws.client_id
  JOIN public.practitioners p ON p.id = ws.practitioner_id
  WHERE ws.session_token_hash IS NOT NULL
    AND ws.session_token_hash = p_token_hash
    AND ws.revoked_at IS NULL
    AND ws.status = 'active'
    AND ws.expires_at IS NOT NULL
    AND ws.expires_at > pg_catalog.clock_timestamp()
    AND a.practitioner_approved = true
    AND c.deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM (
        SELECT cr.kind, cr.revoked_at
        FROM public.consent_records cr
        WHERE cr.client_id = ws.client_id
          AND cr.practitioner_id = ws.practitioner_id
        ORDER BY cr.recorded_at DESC, cr.id DESC
        LIMIT 1
      ) latest
      WHERE latest.kind <> 'revocation' AND latest.revoked_at IS NULL
    )
    AND p.access_status = 'active';
$$;
REVOKE ALL ON FUNCTION public.resolve_workout_token(text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.resolve_workout_token(text) TO service_role;

-- ============================================================================
-- 2. Durable external-object deletion outbox and approval-gated retention.
-- ============================================================================

CREATE TABLE public.privacy_storage_deletion_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deletion_receipt_id uuid REFERENCES public.client_deletion_log(id) ON DELETE CASCADE,
  source_code text NOT NULL DEFAULT 'client_erasure'
    CHECK (source_code IN ('client_erasure', 'report_insert_compensation')),
  bucket text NOT NULL CHECK (bucket IN ('posture-reports', 'posture-captures', 'practitioner-assets')),
  object_path text NOT NULL CHECK (char_length(object_path) BETWEEN 1 AND 1024),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'retry', 'complete')),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code IN ('storage_delete_failed', 'worker_update_failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (source_code = 'client_erasure' AND deletion_receipt_id IS NOT NULL)
    OR (source_code = 'report_insert_compensation' AND deletion_receipt_id IS NULL)
  ),
  UNIQUE (bucket, object_path)
);

CREATE INDEX privacy_storage_deletion_due_idx
  ON public.privacy_storage_deletion_outbox (next_attempt_at, created_at)
  WHERE status IN ('pending', 'retry', 'processing');
CREATE INDEX privacy_storage_deletion_receipt_idx
  ON public.privacy_storage_deletion_outbox (deletion_receipt_id);

ALTER TABLE public.privacy_storage_deletion_outbox ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.privacy_retention_policies (
  store_key text PRIMARY KEY CHECK (store_key IN (
    'client_records',
    'consent_history',
    'consent_tokens',
    'completed_storage_deletion_jobs',
    'api_rate_limits',
    'workout_history',
    'workout_share_events',
    'client_deletion_receipts'
  )),
  retention_days int NOT NULL CHECK (retention_days BETWEEN 1 AND 36500),
  legal_hold boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  approval_reference text CHECK (
    approval_reference IS NULL OR approval_reference ~ '^[A-Za-z0-9._:/-]{1,128}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (approved_at IS NULL AND approval_reference IS NULL)
    OR (approved_at IS NOT NULL AND approval_reference IS NOT NULL)
  )
);

ALTER TABLE public.privacy_retention_policies ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.privacy_storage_deletion_outbox TO service_role;
REVOKE ALL ON public.privacy_storage_deletion_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.privacy_retention_policies TO service_role;
REVOKE ALL ON public.privacy_retention_policies FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.privacy_retention_policies FROM service_role;

-- A durable deletion intent is inserted before a report PDF leaves Postgres.
-- Finalization inserts the governed report row and cancels that intent in one
-- transaction. A process crash anywhere after upload therefore leaves a due
-- outbox job instead of an untracked regulated object.
CREATE FUNCTION public.finalize_report_upload(
  p_assessment_id uuid,
  p_practitioner_id uuid,
  p_storage_path text,
  p_compared_to_assessment_id uuid,
  p_document_id text,
  p_document_version text,
  p_document_body_sha256 text,
  p_document_effective_at timestamptz,
  p_jurisdiction text,
  p_product_scope text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_client_id uuid;
  v_intent_id uuid;
  v_report_id uuid;
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
  THEN RETURN pg_catalog.jsonb_build_object('status', 'invalid_input'); END IF;

  SELECT a.client_id INTO v_client_id
  FROM public.assessments a
  JOIN public.clients c ON c.id = a.client_id
  WHERE a.id = p_assessment_id
    AND a.practitioner_id = p_practitioner_id
    AND a.practitioner_approved = true
    AND c.practitioner_id = p_practitioner_id
    AND c.deleted_at IS NULL
  FOR UPDATE OF c;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_found'); END IF;

  IF p_compared_to_assessment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.assessments prior
    WHERE prior.id = p_compared_to_assessment_id
      AND prior.practitioner_id = p_practitioner_id
      AND prior.client_id = v_client_id
      AND prior.practitioner_approved = true
  ) THEN RETURN pg_catalog.jsonb_build_object('status', 'invalid_comparison'); END IF;

  SELECT r.id INTO v_report_id
  FROM public.reports r
  WHERE r.practitioner_id = p_practitioner_id
    AND r.storage_path = p_storage_path
  ORDER BY r.generated_at, r.id
  LIMIT 1;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'created', 'report_id', v_report_id);
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
    legal_provenance_state
  ) VALUES (
    p_assessment_id, p_practitioner_id, p_storage_path, p_compared_to_assessment_id,
    p_document_id, p_document_version, p_document_body_sha256,
    p_document_effective_at, p_jurisdiction, p_product_scope, 'governed'
  ) RETURNING id INTO v_report_id;

  DELETE FROM public.privacy_storage_deletion_outbox WHERE id = v_intent_id;
  RETURN pg_catalog.jsonb_build_object('status', 'created', 'report_id', v_report_id);
END;
$$;

-- ============================================================================
-- 3. Governed consent withdrawal.
-- ============================================================================

CREATE FUNCTION public.withdraw_client_consent(
  p_client_id uuid,
  p_practitioner_id uuid,
  p_signer_name text,
  p_signer_relationship text,
  p_reason_code text,
  p_event_hash text,
  p_withdrawn_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_latest public.consent_records%ROWTYPE;
  v_shares_revoked int := 0;
  v_already_withdrawn boolean := false;
BEGIN
  IF p_client_id IS NULL
    OR p_practitioner_id IS NULL
    OR p_signer_name IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(p_signer_name)) NOT BETWEEN 1 AND 200
    OR p_signer_relationship NOT IN ('self', 'parent', 'legal_guardian', 'other')
    OR p_reason_code NOT IN ('subject_request', 'guardian_request', 'practitioner_correction')
    OR p_event_hash !~ '^[0-9a-f]{64}$'
    OR p_withdrawn_at IS NULL
    OR p_withdrawn_at > pg_catalog.clock_timestamp() + interval '5 minutes'
  THEN
    RETURN pg_catalog.jsonb_build_object('status', 'invalid_input', 'shares_revoked', 0);
  END IF;

  PERFORM 1
  FROM public.practitioners p
  WHERE p.id = p_practitioner_id
    AND p.access_status = 'active'
    AND p.role = 'practitioner'
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'practitioner_unavailable', 'shares_revoked', 0);
  END IF;

  PERFORM 1
  FROM public.clients c
  WHERE c.id = p_client_id
    AND c.practitioner_id = p_practitioner_id
    AND c.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_found', 'shares_revoked', 0);
  END IF;

  SELECT cr.* INTO v_latest
  FROM public.consent_records cr
  WHERE cr.client_id = p_client_id
    AND cr.practitioner_id = p_practitioner_id
  ORDER BY cr.recorded_at DESC, cr.id DESC
  LIMIT 1
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'no_consent', 'shares_revoked', 0);
  END IF;

  IF p_withdrawn_at < v_latest.recorded_at THEN
    RETURN pg_catalog.jsonb_build_object('status', 'invalid_input', 'shares_revoked', 0);
  END IF;

  v_already_withdrawn := v_latest.kind = 'revocation' OR v_latest.revoked_at IS NOT NULL;

  IF NOT v_already_withdrawn THEN
    INSERT INTO public.consent_records (
      client_id, practitioner_id, assessment_id, kind, consent_version,
      consent_hash, signer_name, signer_relationship, method, jurisdiction,
      signed_at, recorded_at, revoked_at, notes, reason_code,
      legal_document_id, legal_document_version, legal_document_body_sha256,
      legal_document_effective_at, legal_jurisdiction, legal_product_scope,
      legal_provenance_state
    ) VALUES (
      p_client_id, p_practitioner_id, NULL, 'revocation', v_latest.consent_version,
      p_event_hash, pg_catalog.btrim(p_signer_name),
      p_signer_relationship::public.signer_relationship_enum, 'e_signature',
      v_latest.jurisdiction, p_withdrawn_at, p_withdrawn_at, p_withdrawn_at,
      NULL, p_reason_code,
      v_latest.legal_document_id, v_latest.legal_document_version,
      v_latest.legal_document_body_sha256, v_latest.legal_document_effective_at,
      v_latest.legal_jurisdiction, v_latest.legal_product_scope,
      v_latest.legal_provenance_state
    );
  END IF;

  DELETE FROM public.consent_tokens ct
  WHERE ct.client_id = p_client_id
    AND ct.practitioner_id = p_practitioner_id;

  WITH revoked AS (
    UPDATE public.workout_sessions ws
    SET session_token_hash = NULL,
        expires_at = NULL,
        revoked_at = COALESCE(ws.revoked_at, p_withdrawn_at)
    WHERE ws.client_id = p_client_id
      AND ws.practitioner_id = p_practitioner_id
      AND ws.session_token_hash IS NOT NULL
    RETURNING ws.id, ws.share_generation
  ), inserted AS (
    INSERT INTO public.workout_share_events (
      workout_session_id, practitioner_id, event, actor, actor_code, ip_hash,
      reason_code, operation_id, share_generation
    )
    SELECT id, p_practitioner_id, 'revoked', NULL, 'practitioner', NULL,
           'consent_withdrawn', gen_random_uuid(), share_generation
    FROM revoked
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::int INTO v_shares_revoked FROM inserted;

  UPDATE public.clients
  SET consent_recorded_at = NULL
  WHERE id = p_client_id;

  RETURN pg_catalog.jsonb_build_object(
    'status', CASE WHEN v_already_withdrawn THEN 'already_withdrawn' ELSE 'withdrawn' END,
    'shares_revoked', v_shares_revoked
  );
END;
$$;

-- Permit a service-role-only revocation of a historical legacy consent after the
-- one-way governance latch. This cannot reopen legacy enrollment or artifact
-- creation; it only moves access monotonically toward denial.
CREATE OR REPLACE FUNCTION private.reject_legacy_legal_write_after_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.legal_provenance_state = 'legacy_unverified'
    AND EXISTS (
      SELECT 1 FROM private.legal_governance_activation
      WHERE singleton = true AND activated_at IS NOT NULL
    )
    AND NOT (
      TG_TABLE_SCHEMA = 'public'
      AND TG_TABLE_NAME = 'consent_records'
      AND pg_catalog.to_jsonb(NEW)->>'kind' = 'revocation'
      AND EXISTS (
        SELECT 1 FROM public.consent_records prior
        WHERE prior.client_id = (pg_catalog.to_jsonb(NEW)->>'client_id')::uuid
          AND prior.practitioner_id = (pg_catalog.to_jsonb(NEW)->>'practitioner_id')::uuid
          AND prior.id <> (pg_catalog.to_jsonb(NEW)->>'id')::uuid
      )
    )
  THEN
    RAISE EXCEPTION 'legal governance is active: legacy_unverified writes are disabled'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 4. Transactional workout share revoke/rotate.
-- ============================================================================

CREATE FUNCTION public.create_workout_session_governed(
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
  p_product_scope text
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
  THEN RETURN pg_catalog.jsonb_build_object('status', 'invalid_input'); END IF;

  PERFORM 1
  FROM public.practitioners p
  WHERE p.id = p_practitioner_id
    AND p.access_status = 'active'
    AND p.role = 'practitioner'
  FOR SHARE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'practitioner_unavailable'); END IF;

  PERFORM 1
  FROM public.assessments a
  JOIN public.clients c ON c.id = a.client_id
  WHERE a.id = p_assessment_id
    AND a.client_id = p_client_id
    AND a.practitioner_id = p_practitioner_id
    AND a.practitioner_approved = true
    AND c.practitioner_id = p_practitioner_id
    AND c.deleted_at IS NULL
  FOR UPDATE OF c;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_found'); END IF;

  -- The client lock above serializes this check with grant/withdrawal RPCs.
  -- An approved historical assessment does not preserve permission to mint a
  -- new workout artifact after the subject withdraws consent.
  IF NOT EXISTS (
    SELECT 1
    FROM (
      SELECT cr.kind, cr.revoked_at
      FROM public.consent_records cr
      WHERE cr.client_id = p_client_id
        AND cr.practitioner_id = p_practitioner_id
      ORDER BY cr.recorded_at DESC, cr.id DESC
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
    legal_provenance_state, share_generation
  ) VALUES (
    p_assessment_id, p_client_id, p_practitioner_id, p_week, p_capability,
    p_program_snapshot, p_estimated_duration_sec, p_token_hash, p_expires_at,
    p_document_id, p_document_version, p_document_body_sha256,
    p_document_effective_at, p_jurisdiction, p_product_scope,
    'governed', 1
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

CREATE FUNCTION public.revoke_workout_share(
  p_session_id uuid,
  p_practitioner_id uuid,
  p_reason_code text,
  p_operation_id uuid,
  p_revoked_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.workout_sessions%ROWTYPE;
BEGIN
  IF p_session_id IS NULL OR p_practitioner_id IS NULL OR p_operation_id IS NULL
    OR p_reason_code NOT IN ('practitioner_action', 'consent_withdrawn', 'client_erasure')
    OR p_revoked_at IS NULL
    OR p_revoked_at > pg_catalog.clock_timestamp() + interval '5 minutes'
  THEN
    RETURN pg_catalog.jsonb_build_object('status', 'invalid_input');
  END IF;

  SELECT ws.* INTO v_session
  FROM public.workout_sessions ws
  JOIN public.clients c ON c.id = ws.client_id AND c.deleted_at IS NULL
  WHERE ws.id = p_session_id AND ws.practitioner_id = p_practitioner_id
  FOR UPDATE OF ws;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_found'); END IF;

  IF v_session.session_token_hash IS NULL OR v_session.revoked_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('status', 'already_revoked');
  END IF;

  UPDATE public.workout_sessions
  SET session_token_hash = NULL, expires_at = NULL, revoked_at = p_revoked_at
  WHERE id = p_session_id;

  INSERT INTO public.workout_share_events (
    workout_session_id, practitioner_id, event, actor, actor_code, ip_hash,
    reason_code, operation_id, share_generation
  ) VALUES (
    p_session_id, p_practitioner_id, 'revoked', NULL, 'practitioner', NULL,
    p_reason_code, p_operation_id, v_session.share_generation
  );

  RETURN pg_catalog.jsonb_build_object('status', 'revoked');
END;
$$;

CREATE FUNCTION public.rotate_workout_share(
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
BEGIN
  IF p_session_id IS NULL OR p_practitioner_id IS NULL OR p_operation_id IS NULL
    OR p_new_token_hash !~ '^[0-9a-f]{64}$'
    OR p_new_expires_at IS NULL OR p_rotated_at IS NULL
    OR p_new_expires_at <= p_rotated_at
    OR p_rotated_at > pg_catalog.clock_timestamp() + interval '5 minutes'
  THEN RETURN pg_catalog.jsonb_build_object('status', 'invalid_input'); END IF;

  -- Lock clients first, matching consent withdrawal and erasure, so the active
  -- consent decision and token update cannot race each other.
  SELECT c.id INTO v_client_id
  FROM public.clients c
  JOIN public.workout_sessions ws ON ws.client_id = c.id
  WHERE ws.id = p_session_id
    AND ws.practitioner_id = p_practitioner_id
    AND c.practitioner_id = p_practitioner_id
    AND c.deleted_at IS NULL
  FOR UPDATE OF c;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_found'); END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM (
      SELECT cr.kind, cr.revoked_at
      FROM public.consent_records cr
      WHERE cr.client_id = v_client_id
        AND cr.practitioner_id = p_practitioner_id
      ORDER BY cr.recorded_at DESC, cr.id DESC
      LIMIT 1
    ) latest
    WHERE latest.kind <> 'revocation' AND latest.revoked_at IS NULL
  ) THEN
    RETURN pg_catalog.jsonb_build_object('status', 'consent_unavailable');
  END IF;

  SELECT ws.share_generation + 1 INTO v_generation
  FROM public.workout_sessions ws
  WHERE ws.id = p_session_id
    AND ws.practitioner_id = p_practitioner_id
    AND ws.status = 'active'
    AND ws.session_token_hash IS NOT NULL
    AND ws.revoked_at IS NULL
    AND ws.expires_at > pg_catalog.clock_timestamp()
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

-- ============================================================================
-- 5. Transactional database erasure and idempotent external-object outbox.
-- ============================================================================

CREATE FUNCTION public.erase_client_transactional(
  p_client_id uuid,
  p_practitioner_id uuid,
  p_reason_code text,
  p_erased_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_receipt public.client_deletion_log%ROWTYPE;
  v_assessments int := 0;
  v_captures int := 0;
  v_objects int := 0;
  v_was_deleted boolean := false;
BEGIN
  IF p_client_id IS NULL OR p_practitioner_id IS NULL OR p_erased_at IS NULL
    OR p_reason_code NOT IN (
      'subject_request', 'guardian_request', 'duplicate_record',
      'practitioner_correction', 'retention_policy', 'legacy_unspecified'
    )
    OR p_erased_at > pg_catalog.clock_timestamp() + interval '5 minutes'
  THEN RETURN pg_catalog.jsonb_build_object('status', 'invalid_input'); END IF;

  SELECT c.* INTO v_client
  FROM public.clients c
  WHERE c.id = p_client_id AND c.practitioner_id = p_practitioner_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'not_found'); END IF;

  v_was_deleted := v_client.deleted_at IS NOT NULL;

  -- A live erasure requires an active practitioner. A historical tombstone may
  -- still need residue reconciliation after that practitioner is deactivated;
  -- finishing an already-started erasure is a monotonic privacy operation.
  IF NOT v_was_deleted AND p_reason_code <> 'retention_policy' THEN
    PERFORM 1 FROM public.practitioners p
    WHERE p.id = p_practitioner_id
      AND p.access_status = 'active'
      AND p.role = 'practitioner'
    FOR SHARE;
    IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('status', 'practitioner_unavailable'); END IF;
  END IF;

  SELECT pg_catalog.count(*)::int INTO v_assessments
  FROM public.assessments a
  WHERE a.client_id = p_client_id AND a.practitioner_id = p_practitioner_id;

  SELECT pg_catalog.count(*)::int INTO v_captures
  FROM public.captures cap
  JOIN public.assessments a ON a.id = cap.assessment_id
  WHERE a.client_id = p_client_id AND a.practitioner_id = p_practitioner_id;

  IF v_was_deleted THEN
    -- Pre-PR06 erasure ran as several independent statements. A client could be
    -- tombstoned while assessments, report rows/files, or consent PII remained.
    -- A replay must reconcile that residue before it may say already_erased.
    SELECT dl.* INTO v_receipt
    FROM public.client_deletion_log dl
    WHERE dl.original_client_id = p_client_id
      AND dl.practitioner_id = p_practitioner_id
    ORDER BY dl.deleted_at ASC, dl.id ASC
    LIMIT 1;
  END IF;

  IF v_receipt.id IS NULL THEN
    INSERT INTO public.client_deletion_log (
      original_client_id, practitioner_id, deleted_at, reason, reason_code,
      assessments_purged, captures_purged, storage_objects_enqueued,
      storage_objects_deleted, external_deletion_status, completed_at
    ) VALUES (
      p_client_id, p_practitioner_id,
      COALESCE(v_client.deleted_at, p_erased_at), NULL,
      CASE WHEN v_was_deleted THEN COALESCE(v_client.deletion_reason_code, 'legacy_unspecified') ELSE p_reason_code END,
      v_assessments, v_captures, 0, 0, 'complete',
      COALESCE(v_client.deleted_at, p_erased_at)
    ) RETURNING * INTO v_receipt;
  END IF;

  INSERT INTO public.privacy_storage_deletion_outbox (
    deletion_receipt_id, bucket, object_path
  )
  SELECT v_receipt.id, 'posture-reports', r.storage_path
  FROM public.reports r
  JOIN public.assessments a ON a.id = r.assessment_id
  WHERE a.client_id = p_client_id
    AND a.practitioner_id = p_practitioner_id
    AND r.storage_path IS NOT NULL
  ON CONFLICT (bucket, object_path) DO UPDATE
    SET deletion_receipt_id = EXCLUDED.deletion_receipt_id,
        source_code = 'client_erasure',
        updated_at = pg_catalog.clock_timestamp()
    WHERE privacy_storage_deletion_outbox.deletion_receipt_id IS NULL;

  SELECT pg_catalog.count(*)::int INTO v_objects
  FROM public.privacy_storage_deletion_outbox job
  WHERE job.deletion_receipt_id = v_receipt.id;

  DELETE FROM public.consent_tokens ct
  WHERE ct.client_id = p_client_id AND ct.practitioner_id = p_practitioner_id;

  UPDATE public.consent_records cr
  SET signer_name = 'REDACTED', notes = NULL
  WHERE cr.client_id = p_client_id AND cr.practitioner_id = p_practitioner_id;

  DELETE FROM public.assessments a
  WHERE a.client_id = p_client_id AND a.practitioner_id = p_practitioner_id;

  UPDATE public.clients
  SET first_name = 'REDACTED', last_name = 'REDACTED', date_of_birth = NULL,
      sex_at_birth = NULL, height_cm = NULL, weight_kg = NULL, notes = NULL,
      consent_recorded_at = NULL, archived_at = COALESCE(archived_at, p_erased_at),
      deleted_at = COALESCE(deleted_at, p_erased_at), deletion_reason = NULL,
      deletion_reason_code = CASE
        WHEN v_was_deleted THEN COALESCE(deletion_reason_code, 'legacy_unspecified')
        ELSE p_reason_code
      END
  WHERE id = p_client_id;

  UPDATE public.client_deletion_log
  SET assessments_purged = GREATEST(assessments_purged, v_assessments),
      captures_purged = GREATEST(captures_purged, v_captures),
      storage_objects_enqueued = v_objects,
      storage_objects_deleted = (
        SELECT pg_catalog.count(*)::int
        FROM public.privacy_storage_deletion_outbox job
        WHERE job.deletion_receipt_id = v_receipt.id AND job.status = 'complete'
      ),
      external_deletion_status = CASE WHEN EXISTS (
        SELECT 1 FROM public.privacy_storage_deletion_outbox job
        WHERE job.deletion_receipt_id = v_receipt.id AND job.status <> 'complete'
      ) THEN 'pending' ELSE 'complete' END,
      completed_at = CASE WHEN EXISTS (
        SELECT 1 FROM public.privacy_storage_deletion_outbox job
        WHERE job.deletion_receipt_id = v_receipt.id AND job.status <> 'complete'
      ) THEN NULL ELSE COALESCE(completed_at, p_erased_at) END
  WHERE id = v_receipt.id
  RETURNING * INTO v_receipt;

  RETURN pg_catalog.jsonb_build_object(
    'status', CASE WHEN v_was_deleted THEN 'already_erased' ELSE 'database_erased' END,
    'receipt_id', v_receipt.id,
    'assessments_purged', v_receipt.assessments_purged,
    'captures_purged', v_receipt.captures_purged,
    'storage_objects_enqueued', v_receipt.storage_objects_enqueued,
    'external_deletion_status', v_receipt.external_deletion_status
  );
END;
$$;

-- Older DELETE code tombstoned first, then purged children in separate calls.
-- Tombstoned clients are hidden from the UI, so reconciliation cannot depend on
-- a practitioner manually replaying that request. The scheduler calls this
-- bounded scan, and the migration runs it once for residue already on disk.
CREATE FUNCTION public.reconcile_legacy_client_erasures(
  p_limit int DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_client record;
  v_reconciled int := 0;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid reconciliation limit' USING ERRCODE = '22023';
  END IF;

  FOR v_client IN
    SELECT c.id, c.practitioner_id, c.deleted_at,
           COALESCE(c.deletion_reason_code, 'legacy_unspecified') AS reason_code
    FROM public.clients c
    WHERE c.deleted_at IS NOT NULL
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.client_deletion_log receipt
          WHERE receipt.original_client_id = c.id
            AND receipt.practitioner_id = c.practitioner_id
        )
        OR EXISTS (
          SELECT 1 FROM public.assessments a
          WHERE a.client_id = c.id AND a.practitioner_id = c.practitioner_id
        )
        OR EXISTS (
          SELECT 1 FROM public.consent_tokens token
          WHERE token.client_id = c.id AND token.practitioner_id = c.practitioner_id
        )
        OR EXISTS (
          SELECT 1 FROM public.consent_records consent
          WHERE consent.client_id = c.id
            AND consent.practitioner_id = c.practitioner_id
            AND (consent.signer_name <> 'REDACTED' OR consent.notes IS NOT NULL)
        )
      )
    ORDER BY c.deleted_at, c.id
    LIMIT p_limit
    FOR UPDATE OF c SKIP LOCKED
  LOOP
    PERFORM public.erase_client_transactional(
      v_client.id,
      v_client.practitioner_id,
      v_client.reason_code,
      v_client.deleted_at
    );
    v_reconciled := v_reconciled + 1;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object('clients_reconciled', v_reconciled);
END;
$$;

DO $$
BEGIN
  PERFORM public.reconcile_legacy_client_erasures(1000);
END;
$$;

CREATE FUNCTION public.claim_privacy_storage_deletions(
  p_limit int DEFAULT 25,
  p_receipt_id uuid DEFAULT NULL
) RETURNS TABLE (id uuid, deletion_receipt_id uuid, bucket text, object_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid claim limit' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT job.id
    FROM public.privacy_storage_deletion_outbox job
    WHERE (p_receipt_id IS NULL OR job.deletion_receipt_id = p_receipt_id)
      AND (
        (job.status IN ('pending', 'retry') AND job.next_attempt_at <= pg_catalog.clock_timestamp())
        OR
        (job.status = 'processing' AND job.locked_at < pg_catalog.clock_timestamp() - interval '5 minutes')
      )
    ORDER BY job.created_at, job.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.privacy_storage_deletion_outbox job
    SET status = 'processing', attempts = job.attempts + 1,
        locked_at = pg_catalog.clock_timestamp(), updated_at = pg_catalog.clock_timestamp()
    FROM due
    WHERE job.id = due.id
    RETURNING job.id, job.deletion_receipt_id, job.bucket, job.object_path
  )
  SELECT claimed.id, claimed.deletion_receipt_id, claimed.bucket, claimed.object_path
  FROM claimed;
END;
$$;

CREATE FUNCTION public.complete_privacy_storage_deletion(
  p_job_id uuid,
  p_succeeded boolean,
  p_error_code text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt_id uuid;
BEGIN
  IF p_job_id IS NULL OR p_succeeded IS NULL
    OR (p_succeeded AND p_error_code IS NOT NULL)
    OR (NOT p_succeeded AND p_error_code NOT IN ('storage_delete_failed', 'worker_update_failed'))
  THEN RETURN false; END IF;

  UPDATE public.privacy_storage_deletion_outbox job
  SET status = CASE WHEN p_succeeded THEN 'complete' ELSE 'retry' END,
      completed_at = CASE WHEN p_succeeded THEN pg_catalog.clock_timestamp() ELSE NULL END,
      last_error_code = CASE WHEN p_succeeded THEN NULL ELSE p_error_code END,
      next_attempt_at = CASE
        WHEN p_succeeded THEN job.next_attempt_at
        ELSE pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => CASE
              WHEN job.attempts >= 7 THEN 3600
              ELSE (30 * pg_catalog.power(2, job.attempts))::int
            END)
      END,
      locked_at = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE job.id = p_job_id AND job.status = 'processing'
  RETURNING job.deletion_receipt_id INTO v_receipt_id;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.client_deletion_log receipt
  SET storage_objects_deleted = (
        SELECT pg_catalog.count(*)::int
        FROM public.privacy_storage_deletion_outbox job
        WHERE job.deletion_receipt_id = v_receipt_id AND job.status = 'complete'
      ),
      external_deletion_status = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.privacy_storage_deletion_outbox job
          WHERE job.deletion_receipt_id = v_receipt_id AND job.status <> 'complete'
        ) THEN 'complete' ELSE 'pending' END,
      completed_at = CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.privacy_storage_deletion_outbox job
          WHERE job.deletion_receipt_id = v_receipt_id AND job.status <> 'complete'
        ) THEN pg_catalog.clock_timestamp() ELSE NULL END
  WHERE receipt.id = v_receipt_id;

  RETURN true;
END;
$$;

-- ============================================================================
-- 6. Approval-gated retention worker. Empty policy table = safe no-op.
-- ============================================================================

CREATE FUNCTION public.run_approved_privacy_retention(p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_policy public.privacy_retention_policies%ROWTYPE;
  v_client record;
  v_result jsonb;
  v_deleted int;
  v_total int := 0;
  v_policies int := 0;
BEGIN
  IF p_now IS NULL OR p_now > pg_catalog.clock_timestamp() + interval '5 minutes' THEN
    RETURN pg_catalog.jsonb_build_object('policies_run', 0, 'rows_deleted', 0);
  END IF;

  FOR v_policy IN
    SELECT policy.*
    FROM public.privacy_retention_policies policy
    WHERE policy.approved_at IS NOT NULL AND NOT policy.legal_hold
    ORDER BY policy.store_key
  LOOP
    v_deleted := 0;
    IF v_policy.store_key = 'client_records' THEN
      -- Client-level expiry is the safe root operation: erase_client_transactional
      -- inventories report objects before cascading assessments/workouts and
      -- leaves a minimized receipt. No period is active until HG-02 supplies it.
      FOR v_client IN
        SELECT c.id, c.practitioner_id
        FROM public.clients c
        WHERE c.deleted_at IS NULL
          AND c.created_at <= p_now - pg_catalog.make_interval(days => v_policy.retention_days)
        ORDER BY c.created_at, c.id
      LOOP
        v_result := public.erase_client_transactional(
          v_client.id, v_client.practitioner_id, 'retention_policy', p_now
        );
        IF v_result->>'status' = 'database_erased' THEN
          v_deleted := v_deleted + 1;
        END IF;
      END LOOP;
    ELSIF v_policy.store_key = 'consent_history' THEN
      DELETE FROM public.consent_records consent
      WHERE consent.recorded_at
        <= p_now - pg_catalog.make_interval(days => v_policy.retention_days);
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSIF v_policy.store_key = 'consent_tokens' THEN
      DELETE FROM public.consent_tokens token
      WHERE token.expires_at <= p_now
        AND COALESCE(token.consumed_at, token.expires_at)
          <= p_now - pg_catalog.make_interval(days => v_policy.retention_days);
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSIF v_policy.store_key = 'completed_storage_deletion_jobs' THEN
      DELETE FROM public.privacy_storage_deletion_outbox job
      WHERE job.status = 'complete'
        AND job.completed_at <= p_now - pg_catalog.make_interval(days => v_policy.retention_days);
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSIF v_policy.store_key = 'api_rate_limits' THEN
      DELETE FROM public.api_rate_limits bucket
      WHERE bucket.window_start <= p_now - pg_catalog.make_interval(days => v_policy.retention_days);
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSIF v_policy.store_key = 'workout_history' THEN
      DELETE FROM public.workout_sessions session
      WHERE session.created_at
        <= p_now - pg_catalog.make_interval(days => v_policy.retention_days);
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSIF v_policy.store_key = 'workout_share_events' THEN
      DELETE FROM public.workout_share_events event
      WHERE event.created_at
        <= p_now - pg_catalog.make_interval(days => v_policy.retention_days);
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSIF v_policy.store_key = 'client_deletion_receipts' THEN
      DELETE FROM public.client_deletion_log receipt
      WHERE receipt.external_deletion_status = 'complete'
        AND receipt.deleted_at
          <= p_now - pg_catalog.make_interval(days => v_policy.retention_days);
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
    END IF;
    v_policies := v_policies + 1;
    v_total := v_total + v_deleted;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object('policies_run', v_policies, 'rows_deleted', v_total);
END;
$$;

-- Every lifecycle RPC is server-side service-role only. Default privileges in
-- this repo otherwise expose new functions to browser roles.
REVOKE ALL ON FUNCTION public.withdraw_client_consent(uuid, uuid, text, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.withdraw_client_consent(uuid, uuid, text, text, text, text, timestamptz)
  TO service_role;

REVOKE ALL ON FUNCTION public.finalize_report_upload(
  uuid, uuid, text, uuid, text, text, text, timestamptz, text, text
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.finalize_report_upload(
  uuid, uuid, text, uuid, text, text, text, timestamptz, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.create_workout_session_governed(
  uuid, uuid, uuid, int, text, jsonb, int, text, timestamptz, uuid, text,
  text, text, text, timestamptz, text, text
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.create_workout_session_governed(
  uuid, uuid, uuid, int, text, jsonb, int, text, timestamptz, uuid, text,
  text, text, text, timestamptz, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.revoke_workout_share(uuid, uuid, text, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.revoke_workout_share(uuid, uuid, text, uuid, timestamptz)
  TO service_role;

REVOKE ALL ON FUNCTION public.rotate_workout_share(uuid, uuid, text, timestamptz, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.rotate_workout_share(uuid, uuid, text, timestamptz, uuid, timestamptz)
  TO service_role;

REVOKE ALL ON FUNCTION public.erase_client_transactional(uuid, uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.erase_client_transactional(uuid, uuid, text, timestamptz)
  TO service_role;

REVOKE ALL ON FUNCTION public.reconcile_legacy_client_erasures(int)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.reconcile_legacy_client_erasures(int)
  TO service_role;

REVOKE ALL ON FUNCTION public.claim_privacy_storage_deletions(int, uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.claim_privacy_storage_deletions(int, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.complete_privacy_storage_deletion(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.complete_privacy_storage_deletion(uuid, boolean, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.run_approved_privacy_retention(timestamptz)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.run_approved_privacy_retention(timestamptz)
  TO service_role;

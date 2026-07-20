-- PR-05: governed legal-document provenance without storing legal copy in the
-- database. Reviewed source remains the content authority; regulated rows retain
-- the exact document id, version, body hash, effective date, jurisdiction, and
-- product scope that the application displayed.
--
-- This migration is intentionally additive. Existing records stay explicitly
-- legacy_unverified until the one-way launch latch is activated after the governed
-- application is live. Before activation, rollback remains possible. After
-- activation, legacy writers fail closed and rollback behind PR-05 is forbidden.
-- Withdrawal, retention, erasure, and share revocation belong to PR-06.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE private.legal_governance_activation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  activated_at timestamptz
);
INSERT INTO private.legal_governance_activation (singleton, activated_at)
VALUES (true, NULL);
REVOKE ALL ON TABLE private.legal_governance_activation
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ============================================================================
-- 1. Append-only practitioner legal-document acceptances
-- ============================================================================

CREATE TABLE public.practitioner_legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id uuid NOT NULL
    REFERENCES public.practitioners(id) ON DELETE RESTRICT,
  legal_document_id text NOT NULL,
  legal_document_version text NOT NULL,
  legal_document_body_sha256 text NOT NULL,
  legal_document_effective_at timestamptz NOT NULL,
  legal_jurisdiction text NOT NULL,
  legal_product_scope text NOT NULL,
  acceptance_context text NOT NULL,
  acceptance_method text NOT NULL DEFAULT 'authenticated_checkbox',
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT practitioner_legal_acceptances_document_id_valid
    CHECK (char_length(btrim(legal_document_id)) BETWEEN 1 AND 128),
  CONSTRAINT practitioner_legal_acceptances_version_valid
    CHECK (char_length(btrim(legal_document_version)) BETWEEN 1 AND 128),
  CONSTRAINT practitioner_legal_acceptances_body_hash_valid
    CHECK (legal_document_body_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT practitioner_legal_acceptances_jurisdiction_valid
    CHECK (char_length(btrim(legal_jurisdiction)) BETWEEN 1 AND 32),
  CONSTRAINT practitioner_legal_acceptances_scope_valid
    CHECK (char_length(btrim(legal_product_scope)) BETWEEN 1 AND 128),
  CONSTRAINT practitioner_legal_acceptances_context_valid
    CHECK (char_length(btrim(acceptance_context)) BETWEEN 1 AND 64),
  CONSTRAINT practitioner_legal_acceptances_method_valid
    CHECK (char_length(btrim(acceptance_method)) BETWEEN 1 AND 64),
  CONSTRAINT practitioner_legal_acceptances_effective_before_acceptance
    CHECK (legal_document_effective_at <= accepted_at),
  CONSTRAINT practitioner_legal_acceptances_exact_event_unique UNIQUE (
    practitioner_id,
    legal_document_id,
    legal_document_version,
    legal_document_body_sha256,
    legal_document_effective_at,
    legal_jurisdiction,
    legal_product_scope,
    acceptance_context
  )
);

CREATE INDEX practitioner_legal_acceptances_practitioner_recorded_idx
  ON public.practitioner_legal_acceptances(practitioner_id, recorded_at DESC);

ALTER TABLE public.practitioner_legal_acceptances ENABLE ROW LEVEL SECURITY;

CREATE POLICY practitioner_legal_acceptances_read_own
  ON public.practitioner_legal_acceptances
  FOR SELECT
  TO authenticated
  USING (practitioner_id = (SELECT auth.uid()));

-- 20260612000000_role_grants.sql grants broad defaults to every public table.
-- Strip those defaults and grant only self-readable/service-insert behavior.
REVOKE ALL ON TABLE public.practitioner_legal_acceptances
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.practitioner_legal_acceptances
  TO authenticated, service_role;
GRANT INSERT ON TABLE public.practitioner_legal_acceptances
  TO service_role;

CREATE OR REPLACE FUNCTION private.reject_append_only_legal_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'practitioner legal acceptances are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER practitioner_legal_acceptances_append_only
  BEFORE UPDATE OR DELETE ON public.practitioner_legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION private.reject_append_only_legal_acceptance();

REVOKE ALL ON FUNCTION private.reject_append_only_legal_acceptance()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ============================================================================
-- 2. Add exact, nullable legal provenance to regulated records
-- ============================================================================

ALTER TABLE public.consent_tokens
  ADD COLUMN legal_document_id text,
  ADD COLUMN legal_document_version text,
  ADD COLUMN legal_document_body_sha256 text,
  ADD COLUMN legal_document_effective_at timestamptz,
  ADD COLUMN legal_jurisdiction text,
  ADD COLUMN legal_product_scope text,
  ADD COLUMN legal_provenance_state text NOT NULL DEFAULT 'legacy_unverified';

ALTER TABLE public.consent_records
  ADD COLUMN legal_document_id text,
  ADD COLUMN legal_document_version text,
  ADD COLUMN legal_document_body_sha256 text,
  ADD COLUMN legal_document_effective_at timestamptz,
  ADD COLUMN legal_jurisdiction text,
  ADD COLUMN legal_product_scope text,
  ADD COLUMN legal_provenance_state text NOT NULL DEFAULT 'legacy_unverified';

ALTER TABLE public.assessments
  ADD COLUMN legal_document_id text,
  ADD COLUMN legal_document_version text,
  ADD COLUMN legal_document_body_sha256 text,
  ADD COLUMN legal_document_effective_at timestamptz,
  ADD COLUMN legal_jurisdiction text,
  ADD COLUMN legal_product_scope text,
  ADD COLUMN legal_provenance_state text NOT NULL DEFAULT 'legacy_unverified';

ALTER TABLE public.reports
  ADD COLUMN legal_document_id text,
  ADD COLUMN legal_document_version text,
  ADD COLUMN legal_document_body_sha256 text,
  ADD COLUMN legal_document_effective_at timestamptz,
  ADD COLUMN legal_jurisdiction text,
  ADD COLUMN legal_product_scope text,
  ADD COLUMN legal_provenance_state text NOT NULL DEFAULT 'legacy_unverified';

ALTER TABLE public.workout_sessions
  ADD COLUMN legal_document_id text,
  ADD COLUMN legal_document_version text,
  ADD COLUMN legal_document_body_sha256 text,
  ADD COLUMN legal_document_effective_at timestamptz,
  ADD COLUMN legal_jurisdiction text,
  ADD COLUMN legal_product_scope text,
  ADD COLUMN legal_provenance_state text NOT NULL DEFAULT 'legacy_unverified';

-- NOT VALID avoids a table scan during this expand migration while still
-- enforcing the exact all-null/all-present shape on every new or changed row.
ALTER TABLE public.consent_tokens
  ADD CONSTRAINT consent_tokens_legal_provenance_shape CHECK (
    (
      legal_provenance_state = 'legacy_unverified'
      AND legal_document_id IS NULL
      AND legal_document_version IS NULL
      AND legal_document_body_sha256 IS NULL
      AND legal_document_effective_at IS NULL
      AND legal_jurisdiction IS NULL
      AND legal_product_scope IS NULL
    )
    OR
    (
      legal_provenance_state = 'governed'
      AND legal_document_id IS NOT NULL
      AND char_length(btrim(legal_document_id)) BETWEEN 1 AND 128
      AND legal_document_version IS NOT NULL
      AND char_length(btrim(legal_document_version)) BETWEEN 1 AND 128
      AND legal_document_body_sha256 IS NOT NULL
      AND legal_document_body_sha256 ~ '^[0-9a-f]{64}$'
      AND legal_document_effective_at IS NOT NULL
      AND legal_jurisdiction IS NOT NULL
      AND char_length(btrim(legal_jurisdiction)) BETWEEN 1 AND 32
      AND legal_product_scope IS NOT NULL
      AND char_length(btrim(legal_product_scope)) BETWEEN 1 AND 128
    )
  ) NOT VALID;

ALTER TABLE public.consent_records
  ADD CONSTRAINT consent_records_legal_provenance_shape CHECK (
    (
      legal_provenance_state = 'legacy_unverified'
      AND legal_document_id IS NULL
      AND legal_document_version IS NULL
      AND legal_document_body_sha256 IS NULL
      AND legal_document_effective_at IS NULL
      AND legal_jurisdiction IS NULL
      AND legal_product_scope IS NULL
    )
    OR
    (
      legal_provenance_state = 'governed'
      AND legal_document_id IS NOT NULL
      AND char_length(btrim(legal_document_id)) BETWEEN 1 AND 128
      AND legal_document_version IS NOT NULL
      AND char_length(btrim(legal_document_version)) BETWEEN 1 AND 128
      AND legal_document_body_sha256 IS NOT NULL
      AND legal_document_body_sha256 ~ '^[0-9a-f]{64}$'
      AND legal_document_effective_at IS NOT NULL
      AND legal_jurisdiction IS NOT NULL
      AND char_length(btrim(legal_jurisdiction)) BETWEEN 1 AND 32
      AND legal_product_scope IS NOT NULL
      AND char_length(btrim(legal_product_scope)) BETWEEN 1 AND 128
    )
  ) NOT VALID;

ALTER TABLE public.assessments
  ADD CONSTRAINT assessments_legal_provenance_shape CHECK (
    (
      legal_provenance_state = 'legacy_unverified'
      AND legal_document_id IS NULL
      AND legal_document_version IS NULL
      AND legal_document_body_sha256 IS NULL
      AND legal_document_effective_at IS NULL
      AND legal_jurisdiction IS NULL
      AND legal_product_scope IS NULL
    )
    OR
    (
      legal_provenance_state = 'governed'
      AND legal_document_id IS NOT NULL
      AND char_length(btrim(legal_document_id)) BETWEEN 1 AND 128
      AND legal_document_version IS NOT NULL
      AND char_length(btrim(legal_document_version)) BETWEEN 1 AND 128
      AND legal_document_body_sha256 IS NOT NULL
      AND legal_document_body_sha256 ~ '^[0-9a-f]{64}$'
      AND legal_document_effective_at IS NOT NULL
      AND legal_jurisdiction IS NOT NULL
      AND char_length(btrim(legal_jurisdiction)) BETWEEN 1 AND 32
      AND legal_product_scope IS NOT NULL
      AND char_length(btrim(legal_product_scope)) BETWEEN 1 AND 128
    )
  ) NOT VALID;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_legal_provenance_shape CHECK (
    (
      legal_provenance_state = 'legacy_unverified'
      AND legal_document_id IS NULL
      AND legal_document_version IS NULL
      AND legal_document_body_sha256 IS NULL
      AND legal_document_effective_at IS NULL
      AND legal_jurisdiction IS NULL
      AND legal_product_scope IS NULL
    )
    OR
    (
      legal_provenance_state = 'governed'
      AND legal_document_id IS NOT NULL
      AND char_length(btrim(legal_document_id)) BETWEEN 1 AND 128
      AND legal_document_version IS NOT NULL
      AND char_length(btrim(legal_document_version)) BETWEEN 1 AND 128
      AND legal_document_body_sha256 IS NOT NULL
      AND legal_document_body_sha256 ~ '^[0-9a-f]{64}$'
      AND legal_document_effective_at IS NOT NULL
      AND legal_jurisdiction IS NOT NULL
      AND char_length(btrim(legal_jurisdiction)) BETWEEN 1 AND 32
      AND legal_product_scope IS NOT NULL
      AND char_length(btrim(legal_product_scope)) BETWEEN 1 AND 128
    )
  ) NOT VALID;

ALTER TABLE public.workout_sessions
  ADD CONSTRAINT workout_sessions_legal_provenance_shape CHECK (
    (
      legal_provenance_state = 'legacy_unverified'
      AND legal_document_id IS NULL
      AND legal_document_version IS NULL
      AND legal_document_body_sha256 IS NULL
      AND legal_document_effective_at IS NULL
      AND legal_jurisdiction IS NULL
      AND legal_product_scope IS NULL
    )
    OR
    (
      legal_provenance_state = 'governed'
      AND legal_document_id IS NOT NULL
      AND char_length(btrim(legal_document_id)) BETWEEN 1 AND 128
      AND legal_document_version IS NOT NULL
      AND char_length(btrim(legal_document_version)) BETWEEN 1 AND 128
      AND legal_document_body_sha256 IS NOT NULL
      AND legal_document_body_sha256 ~ '^[0-9a-f]{64}$'
      AND legal_document_effective_at IS NOT NULL
      AND legal_jurisdiction IS NOT NULL
      AND char_length(btrim(legal_jurisdiction)) BETWEEN 1 AND 32
      AND legal_product_scope IS NOT NULL
      AND char_length(btrim(legal_product_scope)) BETWEEN 1 AND 128
    )
  ) NOT VALID;

-- The exact provenance attached at INSERT may never be rewritten. This still
-- permits ordinary lifecycle updates such as consuming a token, approving an
-- assessment, revoking a workout session, or deletion-time signer redaction.
CREATE OR REPLACE FUNCTION private.reject_legal_provenance_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF ROW(
    OLD.legal_document_id,
    OLD.legal_document_version,
    OLD.legal_document_body_sha256,
    OLD.legal_document_effective_at,
    OLD.legal_jurisdiction,
    OLD.legal_product_scope,
    OLD.legal_provenance_state
  ) IS DISTINCT FROM ROW(
    NEW.legal_document_id,
    NEW.legal_document_version,
    NEW.legal_document_body_sha256,
    NEW.legal_document_effective_at,
    NEW.legal_jurisdiction,
    NEW.legal_product_scope,
    NEW.legal_provenance_state
  ) THEN
    RAISE EXCEPTION 'legal document provenance is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER consent_tokens_legal_provenance_immutable
  BEFORE UPDATE ON public.consent_tokens
  FOR EACH ROW EXECUTE FUNCTION private.reject_legal_provenance_update();
CREATE TRIGGER consent_records_legal_provenance_immutable
  BEFORE UPDATE ON public.consent_records
  FOR EACH ROW EXECUTE FUNCTION private.reject_legal_provenance_update();
CREATE TRIGGER assessments_legal_provenance_immutable
  BEFORE UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION private.reject_legal_provenance_update();
CREATE TRIGGER reports_legal_provenance_immutable
  BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION private.reject_legal_provenance_update();
CREATE TRIGGER workout_sessions_legal_provenance_immutable
  BEFORE UPDATE ON public.workout_sessions
  FOR EACH ROW EXECUTE FUNCTION private.reject_legal_provenance_update();

REVOKE ALL ON FUNCTION private.reject_legal_provenance_update()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- A workout carries the exact screening notice inside program_snapshot for the
-- public player and repeats its identity in protected scalar columns for audit.
-- Bind those two representations at INSERT and freeze the complete snapshot so
-- a privileged writer cannot change either the program or notice after minting.
CREATE FUNCTION private.enforce_workout_program_snapshot_provenance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_notice jsonb;
  v_notice_effective_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.program_snapshot IS DISTINCT FROM OLD.program_snapshot THEN
    RAISE EXCEPTION 'workout program snapshot is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.legal_provenance_state = 'governed' THEN
    v_notice := NEW.program_snapshot -> 'legalNotice';
    IF pg_catalog.jsonb_typeof(NEW.program_snapshot) IS DISTINCT FROM 'object'
      OR NEW.program_snapshot ->> 'version' IS DISTINCT FROM '2'
      OR pg_catalog.jsonb_typeof(v_notice) IS DISTINCT FROM 'object'
      OR v_notice ->> 'schemaVersion' IS DISTINCT FROM '1'
      OR v_notice ->> 'kind' IS DISTINCT FROM 'screening_notice'
      OR v_notice ->> 'documentId' IS DISTINCT FROM NEW.legal_document_id
      OR v_notice ->> 'version' IS DISTINCT FROM NEW.legal_document_version
      OR v_notice ->> 'bodySha256' IS DISTINCT FROM NEW.legal_document_body_sha256
      OR v_notice ->> 'jurisdiction' IS DISTINCT FROM NEW.legal_jurisdiction
      OR v_notice ->> 'productScope' IS DISTINCT FROM NEW.legal_product_scope
    THEN
      RAISE EXCEPTION 'workout snapshot legal notice does not match stored provenance'
        USING ERRCODE = '55000';
    END IF;

    BEGIN
      v_notice_effective_at := (v_notice ->> 'effectiveAt')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'workout snapshot legal notice does not match stored provenance'
        USING ERRCODE = '55000';
    END;

    IF v_notice_effective_at IS DISTINCT FROM NEW.legal_document_effective_at THEN
      RAISE EXCEPTION 'workout snapshot legal notice does not match stored provenance'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER workout_sessions_program_snapshot_provenance
  BEFORE INSERT OR UPDATE ON public.workout_sessions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workout_program_snapshot_provenance();

REVOKE ALL ON FUNCTION private.enforce_workout_program_snapshot_provenance()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- The public bearer-token reader returns the protected provenance alongside the
-- JSON snapshot. Server code verifies both representations and recomputes the
-- embedded content hash before projecting any workout content to the client.
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
    AND p.access_status = 'active';
$$;

REVOKE ALL ON FUNCTION public.resolve_workout_token(text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.resolve_workout_token(text) TO service_role;

-- ============================================================================
-- 3. Governed consent writers (additive; legacy RPCs remain for rollback)
-- ============================================================================

CREATE FUNCTION public.record_inperson_consent_governed(
  p_client_id uuid,
  p_practitioner_id uuid,
  p_document_id text,
  p_document_version text,
  p_document_body_sha256 text,
  p_document_effective_at timestamptz,
  p_jurisdiction text,
  p_product_scope text,
  p_signer_name text,
  p_signer_relationship text,
  p_consent_hash text,
  p_signed_at timestamptz
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_client_id IS NULL
    OR p_practitioner_id IS NULL
    OR p_document_id IS NULL
    OR p_document_version IS NULL
    OR p_document_body_sha256 IS NULL
    OR p_document_effective_at IS NULL
    OR p_jurisdiction IS NULL
    OR p_product_scope IS NULL
    OR p_signer_name IS NULL
    OR p_signer_relationship IS NULL
    OR p_consent_hash IS NULL
    OR p_signed_at IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(p_document_id)) NOT BETWEEN 1 AND 128
    OR pg_catalog.char_length(pg_catalog.btrim(p_document_version)) NOT BETWEEN 1 AND 128
    OR p_document_body_sha256 !~ '^[0-9a-f]{64}$'
    OR pg_catalog.char_length(pg_catalog.btrim(p_jurisdiction)) NOT BETWEEN 1 AND 32
    OR pg_catalog.char_length(pg_catalog.btrim(p_product_scope)) NOT BETWEEN 1 AND 128
    OR pg_catalog.char_length(pg_catalog.btrim(p_signer_name)) NOT BETWEEN 1 AND 200
    OR p_signer_relationship NOT IN ('self', 'parent', 'legal_guardian', 'other')
    OR p_consent_hash !~ '^[0-9a-f]{64}$'
    OR p_document_effective_at > p_signed_at
    OR p_signed_at > pg_catalog.clock_timestamp() + interval '5 minutes'
  THEN
    RETURN 'invalid_input';
  END IF;

  -- Match the repository's lock order: active practitioner before owned client.
  PERFORM 1
    FROM public.practitioners p
    WHERE p.id = p_practitioner_id
      AND p.access_status = 'active'
      AND p.role = 'practitioner'
    FOR SHARE;
  IF NOT FOUND THEN RETURN 'practitioner_unavailable'; END IF;

  PERFORM 1
    FROM public.clients c
    WHERE c.id = p_client_id
      AND c.practitioner_id = p_practitioner_id
      AND c.deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  INSERT INTO public.consent_records (
    client_id,
    practitioner_id,
    kind,
    consent_version,
    consent_hash,
    signer_name,
    signer_relationship,
    method,
    jurisdiction,
    signed_at,
    legal_document_id,
    legal_document_version,
    legal_document_body_sha256,
    legal_document_effective_at,
    legal_jurisdiction,
    legal_product_scope,
    legal_provenance_state
  ) VALUES (
    p_client_id,
    p_practitioner_id,
    'enrollment',
    pg_catalog.btrim(p_document_version),
    p_consent_hash,
    pg_catalog.btrim(p_signer_name),
    p_signer_relationship::public.signer_relationship_enum,
    'e_signature',
    pg_catalog.btrim(p_jurisdiction),
    p_signed_at,
    pg_catalog.btrim(p_document_id),
    pg_catalog.btrim(p_document_version),
    p_document_body_sha256,
    p_document_effective_at,
    pg_catalog.btrim(p_jurisdiction),
    pg_catalog.btrim(p_product_scope),
    'governed'
  );

  UPDATE public.clients
    SET consent_recorded_at = p_signed_at
    WHERE id = p_client_id;

  RETURN 'ok';
END;
$$;

-- Client enrollment and its initial in-person consent are one legal transaction.
-- A consent failure raises and rolls the client insert back, so PII cannot be left
-- behind in a record the UI incorrectly treats as consented.
CREATE FUNCTION public.create_client_with_inperson_consent_governed(
  p_practitioner_id uuid,
  p_first_name text,
  p_last_name text,
  p_date_of_birth date,
  p_sex_at_birth text,
  p_height_cm numeric,
  p_weight_kg numeric,
  p_notes text,
  p_document_id text,
  p_document_version text,
  p_document_body_sha256 text,
  p_document_effective_at timestamptz,
  p_jurisdiction text,
  p_product_scope text,
  p_signer_name text,
  p_signer_relationship text,
  p_consent_hash text,
  p_signed_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_client_id uuid;
  v_client jsonb;
  v_consent_result text;
BEGIN
  IF p_practitioner_id IS NULL
    OR p_first_name IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(p_first_name)) NOT BETWEEN 1 AND 200
    OR p_last_name IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(p_last_name)) NOT BETWEEN 1 AND 200
    OR (p_sex_at_birth IS NOT NULL AND p_sex_at_birth NOT IN ('male', 'female', 'other', 'prefer_not_to_say'))
    OR (p_height_cm IS NOT NULL AND p_height_cm < 0)
    OR (p_weight_kg IS NOT NULL AND p_weight_kg < 0)
  THEN
    RAISE EXCEPTION 'invalid client enrollment input' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.clients (
    practitioner_id,
    first_name,
    last_name,
    date_of_birth,
    sex_at_birth,
    height_cm,
    weight_kg,
    notes
  ) VALUES (
    p_practitioner_id,
    pg_catalog.btrim(p_first_name),
    pg_catalog.btrim(p_last_name),
    p_date_of_birth,
    CASE WHEN p_sex_at_birth IS NULL THEN NULL ELSE p_sex_at_birth::public.sex_at_birth_enum END,
    p_height_cm,
    p_weight_kg,
    p_notes
  )
  RETURNING id INTO v_client_id;

  v_consent_result := public.record_inperson_consent_governed(
    v_client_id,
    p_practitioner_id,
    p_document_id,
    p_document_version,
    p_document_body_sha256,
    p_document_effective_at,
    p_jurisdiction,
    p_product_scope,
    p_signer_name,
    p_signer_relationship,
    p_consent_hash,
    p_signed_at
  );
  IF v_consent_result <> 'ok' THEN
    RAISE EXCEPTION 'client consent enrollment failed: %', v_consent_result
      USING ERRCODE = 'P0001';
  END IF;

  SELECT pg_catalog.to_jsonb(c)
    INTO v_client
    FROM public.clients c
    WHERE c.id = v_client_id;
  RETURN v_client;
END;
$$;

CREATE FUNCTION public.record_remote_consent_governed(
  p_token_hash text,
  p_presented_document_id text,
  p_presented_document_version text,
  p_presented_document_body_sha256 text,
  p_signer_name text,
  p_signer_relationship text,
  p_consent_hash text,
  p_signed_at timestamptz
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_client_id uuid;
  v_practitioner_id uuid;
  v_document_id text;
  v_document_version text;
  v_document_body_sha256 text;
  v_document_effective_at timestamptz;
  v_jurisdiction text;
  v_product_scope text;
  v_provenance_state text;
  v_recorded_at timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_token_hash IS NULL
    OR p_presented_document_id IS NULL
    OR p_presented_document_version IS NULL
    OR p_presented_document_body_sha256 IS NULL
    OR p_signer_name IS NULL
    OR p_signer_relationship IS NULL
    OR p_consent_hash IS NULL
    OR p_token_hash !~ '^[0-9a-f]{64}$'
    OR p_signed_at IS NULL
    OR pg_catalog.char_length(pg_catalog.btrim(p_presented_document_id)) NOT BETWEEN 1 AND 128
    OR pg_catalog.char_length(pg_catalog.btrim(p_presented_document_version)) NOT BETWEEN 1 AND 128
    OR p_presented_document_body_sha256 !~ '^[0-9a-f]{64}$'
    OR pg_catalog.char_length(pg_catalog.btrim(p_signer_name)) NOT BETWEEN 1 AND 200
    OR p_signer_relationship NOT IN ('self', 'parent', 'legal_guardian', 'other')
    OR p_consent_hash !~ '^[0-9a-f]{64}$'
    OR p_signed_at > v_recorded_at + interval '5 minutes'
  THEN
    RETURN 'invalid_input';
  END IF;

  SELECT
    ct.client_id,
    ct.practitioner_id,
    ct.legal_document_id,
    ct.legal_document_version,
    ct.legal_document_body_sha256,
    ct.legal_document_effective_at,
    ct.legal_jurisdiction,
    ct.legal_product_scope,
    ct.legal_provenance_state
  INTO
    v_client_id,
    v_practitioner_id,
    v_document_id,
    v_document_version,
    v_document_body_sha256,
    v_document_effective_at,
    v_jurisdiction,
    v_product_scope,
    v_provenance_state
  FROM public.consent_tokens ct
  WHERE ct.token_hash = p_token_hash;

  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_provenance_state <> 'governed'
    OR v_document_id IS NULL
    OR v_document_version IS NULL
    OR v_document_body_sha256 IS NULL
    OR v_document_effective_at IS NULL
    OR v_jurisdiction IS NULL
    OR v_product_scope IS NULL
  THEN
    RETURN 'ungoverned';
  END IF;

  IF pg_catalog.btrim(p_presented_document_id) <> v_document_id
    OR pg_catalog.btrim(p_presented_document_version) <> v_document_version
    OR p_presented_document_body_sha256 <> v_document_body_sha256
  THEN
    RETURN 'document_mismatch';
  END IF;

  IF v_document_effective_at > p_signed_at THEN
    RETURN 'not_effective';
  END IF;

  -- Match practitioner/client lock ordering used by admission and erasure paths.
  PERFORM 1
    FROM public.practitioners p
    WHERE p.id = v_practitioner_id
      AND p.access_status = 'active'
      AND p.role = 'practitioner'
    FOR SHARE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  PERFORM 1
    FROM public.clients c
    WHERE c.id = v_client_id
      AND c.practitioner_id = v_practitioner_id
      AND c.deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  -- Expiry is checked against database time, not caller-provided signed_at, so a
  -- backdated request cannot revive an expired link.
  UPDATE public.consent_tokens
    SET consumed_at = v_recorded_at
    WHERE token_hash = p_token_hash
      AND consumed_at IS NULL
      AND expires_at > v_recorded_at;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.consent_tokens ct
      WHERE ct.token_hash = p_token_hash
        AND ct.consumed_at IS NOT NULL
    ) THEN
      RETURN 'consumed';
    END IF;
    RETURN 'expired';
  END IF;

  INSERT INTO public.consent_records (
    client_id,
    practitioner_id,
    kind,
    consent_version,
    consent_hash,
    signer_name,
    signer_relationship,
    method,
    jurisdiction,
    signed_at,
    recorded_at,
    legal_document_id,
    legal_document_version,
    legal_document_body_sha256,
    legal_document_effective_at,
    legal_jurisdiction,
    legal_product_scope,
    legal_provenance_state
  ) VALUES (
    v_client_id,
    v_practitioner_id,
    'enrollment',
    v_document_version,
    p_consent_hash,
    pg_catalog.btrim(p_signer_name),
    p_signer_relationship::public.signer_relationship_enum,
    'remote_link',
    v_jurisdiction,
    p_signed_at,
    v_recorded_at,
    v_document_id,
    v_document_version,
    v_document_body_sha256,
    v_document_effective_at,
    v_jurisdiction,
    v_product_scope,
    'governed'
  );

  UPDATE public.clients
    SET consent_recorded_at = p_signed_at
    WHERE id = v_client_id;

  RETURN 'ok';
END;
$$;

-- One-way production cutover. Deploy the governed app and counsel-approved
-- catalog first, exercise the readiness checks, then call this once. From that
-- moment onward an older app can no longer create or advance ungoverned rows.
CREATE FUNCTION public.activate_legal_governance()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_activated_at timestamptz;
BEGIN
  UPDATE private.legal_governance_activation
    SET activated_at = COALESCE(activated_at, pg_catalog.clock_timestamp())
    WHERE singleton = true
    RETURNING activated_at INTO v_activated_at;
  RETURN v_activated_at;
END;
$$;

CREATE FUNCTION private.reject_legacy_legal_write_after_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.legal_provenance_state = 'legacy_unverified'
    AND EXISTS (
      SELECT 1
      FROM private.legal_governance_activation
      WHERE singleton = true AND activated_at IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'legal governance is active: legacy_unverified writes are disabled'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER consent_tokens_legacy_write_latch
  BEFORE INSERT ON public.consent_tokens
  FOR EACH ROW EXECUTE FUNCTION private.reject_legacy_legal_write_after_activation();
CREATE TRIGGER consent_records_legacy_write_latch
  BEFORE INSERT ON public.consent_records
  FOR EACH ROW EXECUTE FUNCTION private.reject_legacy_legal_write_after_activation();
CREATE TRIGGER assessments_legacy_write_latch
  BEFORE INSERT ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION private.reject_legacy_legal_write_after_activation();
CREATE TRIGGER reports_legacy_write_latch
  BEFORE INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION private.reject_legacy_legal_write_after_activation();
CREATE TRIGGER workout_sessions_legacy_write_latch
  BEFORE INSERT ON public.workout_sessions
  FOR EACH ROW EXECUTE FUNCTION private.reject_legacy_legal_write_after_activation();

REVOKE ALL ON FUNCTION private.reject_legacy_legal_write_after_activation()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Default public-schema privileges grant EXECUTE widely. Revoke every API role,
-- then expose governed writers only to the server-side service role.
REVOKE ALL ON FUNCTION public.record_inperson_consent_governed(
  uuid, uuid, text, text, text, timestamptz, text, text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.record_inperson_consent_governed(
  uuid, uuid, text, text, text, timestamptz, text, text, text, text, text, timestamptz
) TO service_role;

REVOKE ALL ON FUNCTION public.create_client_with_inperson_consent_governed(
  uuid, text, text, date, text, numeric, numeric, text, text, text, text, timestamptz, text, text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.create_client_with_inperson_consent_governed(
  uuid, text, text, date, text, numeric, numeric, text, text, text, text, timestamptz, text, text, text, text, text, timestamptz
) TO service_role;

REVOKE ALL ON FUNCTION public.record_remote_consent_governed(
  text, text, text, text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.record_remote_consent_governed(
  text, text, text, text, text, text, text, timestamptz
) TO service_role;

REVOKE ALL ON FUNCTION public.activate_legal_governance()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.activate_legal_governance() TO service_role;

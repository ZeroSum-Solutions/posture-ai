-- PR-07 clinical-content governance.
--
-- Clinical source content remains migration-owned.  A normalized, append-only
-- release ledger records the exact inventory and HG-03 receipt that may power
-- clinical surfaces.  Production has no active release by default; only a later
-- reviewed migration may install one.  The local seed installs a conspicuously
-- labelled test fixture so the approved path can be exercised without creating
-- production approval evidence.

-- ============================================================================
-- 1. Immutable review receipts, releases, and reviewed items.
-- ============================================================================

CREATE TABLE public.clinical_content_review_receipts (
  receipt_sha256 text PRIMARY KEY
    CHECK (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  receipt_kind text NOT NULL
    CHECK (receipt_kind IN ('hg03_clinical_review', 'local_test_fixture')),
  artifact_reference text NOT NULL
    CHECK (pg_catalog.char_length(pg_catalog.btrim(artifact_reference)) BETWEEN 1 AND 1024),
  signed_at timestamptz NOT NULL,
  reviewer_name text,
  license_jurisdiction text,
  license_identifier text,
  attestation text NOT NULL
    CHECK (attestation IN ('licensed_clinician', 'local_test_fixture_not_clinical_approval')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT clinical_content_review_receipts_kind_shape CHECK (
    (
      receipt_kind = 'hg03_clinical_review'
      AND attestation = 'licensed_clinician'
      AND pg_catalog.char_length(pg_catalog.btrim(reviewer_name)) >= 2
      AND pg_catalog.char_length(pg_catalog.btrim(license_jurisdiction)) >= 2
      AND pg_catalog.char_length(pg_catalog.btrim(license_identifier)) >= 2
    ) OR (
      receipt_kind = 'local_test_fixture'
      AND attestation = 'local_test_fixture_not_clinical_approval'
      AND reviewer_name IS NULL
      AND license_jurisdiction IS NULL
      AND license_identifier IS NULL
    )
  )
);

CREATE TABLE public.clinical_content_releases (
  id text PRIMARY KEY
    CHECK (id ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  inventory_sha256 text NOT NULL
    CHECK (inventory_sha256 ~ '^[0-9a-f]{64}$'),
  hg03_receipt_sha256 text NOT NULL
    REFERENCES public.clinical_content_review_receipts(receipt_sha256) ON DELETE RESTRICT,
  release_kind text NOT NULL
    CHECK (release_kind IN ('hg03_approved', 'local_test_fixture')),
  approved_at timestamptz NOT NULL,
  recommendations_enabled boolean NOT NULL DEFAULT false,
  programs_enabled boolean NOT NULL DEFAULT false,
  workouts_enabled boolean NOT NULL DEFAULT false,
  knowledge_links_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (id, inventory_sha256, hg03_receipt_sha256)
);

CREATE TABLE public.clinical_content_release_items (
  release_id text NOT NULL
    REFERENCES public.clinical_content_releases(id) ON DELETE RESTRICT,
  item_id text NOT NULL
    CHECK (item_id ~ '^(muscle|exercise|link|exercise_muscle|contraindication|report_copy|algorithm):[a-z0-9_.:-]+$'),
  item_kind text NOT NULL
    CHECK (item_kind IN (
      'muscle', 'exercise', 'link', 'exercise_muscle',
      'contraindication', 'report_copy', 'algorithm'
    )),
  item_slug text NOT NULL
    CHECK (pg_catalog.char_length(pg_catalog.btrim(item_slug)) >= 1),
  item_sha256 text NOT NULL
    CHECK (item_sha256 ~ '^[0-9a-f]{64}$'),
  review_status text NOT NULL
    CHECK (review_status IN ('approved', 'rejected')),
  reviewed_at timestamptz NOT NULL,
  reviewer_note_sha256 text NOT NULL
    CHECK (reviewer_note_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (release_id, item_id),
  CONSTRAINT clinical_content_release_items_kind_matches_id CHECK (
    pg_catalog.split_part(item_id, ':', 1) = item_kind
  )
);

ALTER TABLE public.clinical_content_review_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_content_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_content_release_items ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.reject_clinical_governance_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'clinical governance records are append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER clinical_content_review_receipts_append_only
  BEFORE UPDATE OR DELETE ON public.clinical_content_review_receipts
  FOR EACH ROW EXECUTE FUNCTION private.reject_clinical_governance_mutation();
CREATE TRIGGER clinical_content_releases_append_only
  BEFORE UPDATE OR DELETE ON public.clinical_content_releases
  FOR EACH ROW EXECUTE FUNCTION private.reject_clinical_governance_mutation();
CREATE TRIGGER clinical_content_release_items_append_only
  BEFORE UPDATE OR DELETE ON public.clinical_content_release_items
  FOR EACH ROW EXECUTE FUNCTION private.reject_clinical_governance_mutation();

REVOKE ALL ON FUNCTION private.reject_clinical_governance_mutation()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Activation is deliberately separate from the immutable evidence.  It is a
-- one-row deployment pointer owned by migrations, never an application toggle.
CREATE TABLE private.clinical_content_activation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  release_id text NOT NULL,
  inventory_sha256 text NOT NULL,
  hg03_receipt_sha256 text NOT NULL,
  activated_at timestamptz NOT NULL,
  activated_by_change text NOT NULL
    CHECK (pg_catalog.char_length(pg_catalog.btrim(activated_by_change)) BETWEEN 1 AND 200),
  FOREIGN KEY (release_id, inventory_sha256, hg03_receipt_sha256)
    REFERENCES public.clinical_content_releases(id, inventory_sha256, hg03_receipt_sha256)
    ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION private.enforce_clinical_content_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_release_kind text;
  v_receipt_kind text;
BEGIN
  SELECT release.release_kind, receipt.receipt_kind
    INTO v_release_kind, v_receipt_kind
  FROM public.clinical_content_releases release
  JOIN public.clinical_content_review_receipts receipt
    ON receipt.receipt_sha256 = release.hg03_receipt_sha256
  WHERE release.id = NEW.release_id
    AND release.inventory_sha256 = NEW.inventory_sha256
    AND release.hg03_receipt_sha256 = NEW.hg03_receipt_sha256
    AND EXISTS (
      SELECT 1
      FROM public.clinical_content_release_items item
      WHERE item.release_id = release.id
    );

  IF NOT FOUND
    OR (v_release_kind = 'hg03_approved' AND v_receipt_kind <> 'hg03_clinical_review')
    OR (v_release_kind = 'local_test_fixture' AND v_receipt_kind <> 'local_test_fixture')
  THEN
    RAISE EXCEPTION 'clinical activation does not match a complete review release'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER clinical_content_activation_exact_release
  BEFORE INSERT OR UPDATE ON private.clinical_content_activation
  FOR EACH ROW EXECUTE FUNCTION private.enforce_clinical_content_activation();

REVOKE ALL ON TABLE private.clinical_content_activation
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.enforce_clinical_content_activation()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- Returns the immutable receipt only when version, inventory, activation, and
-- the requested surface all agree.  Absence or mismatch is a hard denial.
CREATE OR REPLACE FUNCTION private.active_clinical_receipt(
  p_release_id text,
  p_inventory_sha256 text,
  p_surface text
) RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT release.hg03_receipt_sha256
  FROM private.clinical_content_activation activation
  JOIN public.clinical_content_releases release
    ON release.id = activation.release_id
   AND release.inventory_sha256 = activation.inventory_sha256
   AND release.hg03_receipt_sha256 = activation.hg03_receipt_sha256
  JOIN public.clinical_content_review_receipts receipt
    ON receipt.receipt_sha256 = release.hg03_receipt_sha256
  WHERE activation.singleton = true
    AND release.id = p_release_id
    AND release.inventory_sha256 = p_inventory_sha256
    AND CASE p_surface
      WHEN 'recommendations' THEN release.recommendations_enabled
      WHEN 'programs' THEN release.programs_enabled
      WHEN 'workouts' THEN release.workouts_enabled
      WHEN 'knowledge_links' THEN release.knowledge_links_enabled
      WHEN 'clinical_practitioner_report' THEN
        release.recommendations_enabled OR release.knowledge_links_enabled
      WHEN 'clinical_client_report' THEN
        release.recommendations_enabled AND release.programs_enabled
      ELSE false
    END
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION private.active_clinical_receipt(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE FUNCTION public.verify_clinical_content_activation(
  p_release_id text,
  p_inventory_sha256 text,
  p_receipt_sha256 text,
  p_recommendations_enabled boolean,
  p_programs_enabled boolean,
  p_workouts_enabled boolean,
  p_knowledge_links_enabled boolean
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM private.clinical_content_activation activation
    JOIN public.clinical_content_releases release
      ON release.id = activation.release_id
      AND release.inventory_sha256 = activation.inventory_sha256
      AND release.hg03_receipt_sha256 = activation.hg03_receipt_sha256
    WHERE activation.singleton = true
      AND release.id = p_release_id
      AND release.inventory_sha256 = p_inventory_sha256
      AND release.hg03_receipt_sha256 = p_receipt_sha256
      AND release.recommendations_enabled = p_recommendations_enabled
      AND release.programs_enabled = p_programs_enabled
      AND release.workouts_enabled = p_workouts_enabled
      AND release.knowledge_links_enabled = p_knowledge_links_enabled
  );
$$;

REVOKE ALL ON FUNCTION public.verify_clinical_content_activation(
  text, text, text, boolean, boolean, boolean, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_clinical_content_activation(
  text, text, text, boolean, boolean, boolean, boolean
) TO anon, authenticated, service_role;

-- The ledger and authored clinical tables are migration-owned.  The server may
-- read them for an already-verified path, but no application role may mutate
-- them and browser roles may not read them directly.
REVOKE ALL ON TABLE
  public.clinical_content_review_receipts,
  public.clinical_content_releases,
  public.clinical_content_release_items
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE
  public.clinical_content_review_receipts,
  public.clinical_content_releases,
  public.clinical_content_release_items
TO service_role;

DROP POLICY IF EXISTS imbalance_defs_read ON public.imbalance_definitions;
DROP POLICY IF EXISTS exercises_read ON public.exercises;
DROP POLICY IF EXISTS muscles_read ON public.muscles;
DROP POLICY IF EXISTS muscle_links_read ON public.muscle_imbalance_links;
DROP POLICY IF EXISTS exercise_muscles_read ON public.exercise_muscles;

REVOKE ALL ON TABLE
  public.imbalance_definitions,
  public.exercises,
  public.exercise_recommendations,
  public.muscles,
  public.muscle_imbalance_links,
  public.exercise_muscles
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE
  public.imbalance_definitions,
  public.exercises,
  public.exercise_recommendations,
  public.muscles,
  public.muscle_imbalance_links,
  public.exercise_muscles
TO service_role;

-- The legacy exercise-media bucket was intentionally public. That is
-- incompatible with an assessment-only release because its provider URL
-- bypasses the application proxy entirely. Keep existing objects private;
-- a future reviewed media release must project them through a release-gated
-- endpoint or short-lived signed URL.
UPDATE storage.buckets
SET public = false
WHERE id = 'exercise-media';

-- ============================================================================
-- 2. Immutable clinical provenance on reports and workout snapshots.
-- ============================================================================

ALTER TABLE public.reports
  ADD COLUMN report_scope text;
UPDATE public.reports SET report_scope = 'legacy_unversioned' WHERE report_scope IS NULL;
ALTER TABLE public.reports
  ALTER COLUMN report_scope SET NOT NULL,
  ADD COLUMN clinical_content_version text,
  ADD COLUMN clinical_inventory_sha256 text,
  ADD COLUMN clinical_review_receipt_sha256 text,
  ADD CONSTRAINT reports_clinical_scope_shape CHECK (
    (
      report_scope IN ('legacy_unversioned', 'assessment_only')
      AND clinical_content_version IS NULL
      AND clinical_inventory_sha256 IS NULL
      AND clinical_review_receipt_sha256 IS NULL
    ) OR (
      report_scope IN ('clinical_practitioner', 'clinical_client')
      AND clinical_content_version IS NOT NULL
      AND clinical_inventory_sha256 ~ '^[0-9a-f]{64}$'
      AND clinical_review_receipt_sha256 ~ '^[0-9a-f]{64}$'
    )
  ) NOT VALID,
  ADD CONSTRAINT reports_clinical_release_fk FOREIGN KEY (
    clinical_content_version, clinical_inventory_sha256, clinical_review_receipt_sha256
  ) REFERENCES public.clinical_content_releases(id, inventory_sha256, hg03_receipt_sha256)
    ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.reports VALIDATE CONSTRAINT reports_clinical_scope_shape;
ALTER TABLE public.reports VALIDATE CONSTRAINT reports_clinical_release_fk;

ALTER TABLE public.workout_sessions
  ADD COLUMN clinical_content_version text,
  ADD COLUMN clinical_inventory_sha256 text,
  ADD COLUMN clinical_review_receipt_sha256 text,
  ADD CONSTRAINT workout_sessions_clinical_provenance_shape CHECK (
    (
      clinical_content_version IS NULL
      AND clinical_inventory_sha256 IS NULL
      AND clinical_review_receipt_sha256 IS NULL
    ) OR (
      clinical_content_version IS NOT NULL
      AND clinical_inventory_sha256 ~ '^[0-9a-f]{64}$'
      AND clinical_review_receipt_sha256 ~ '^[0-9a-f]{64}$'
    )
  ) NOT VALID,
  ADD CONSTRAINT workout_sessions_clinical_release_fk FOREIGN KEY (
    clinical_content_version, clinical_inventory_sha256, clinical_review_receipt_sha256
  ) REFERENCES public.clinical_content_releases(id, inventory_sha256, hg03_receipt_sha256)
    ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.workout_sessions VALIDATE CONSTRAINT workout_sessions_clinical_provenance_shape;
ALTER TABLE public.workout_sessions VALIDATE CONSTRAINT workout_sessions_clinical_release_fk;

-- PR-05 originally bound only v2 legal snapshots.  PR-07's v3 snapshot retains
-- the identical legalNotice object and adds clinicalContent; accept both for
-- historical lifecycle updates while the clinical guard below permits only v3
-- on new inserts.
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
    RAISE EXCEPTION 'workout program snapshot is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.legal_provenance_state = 'governed' THEN
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
    RAISE EXCEPTION 'report clinical provenance is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.report_scope = 'legacy_unversioned' THEN
      RAISE EXCEPTION 'new legacy-unversioned reports are disabled'
        USING ERRCODE = '55000';
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
        RAISE EXCEPTION 'clinical report release is not active'
          USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reports_clinical_provenance_guard
  BEFORE INSERT OR UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION private.enforce_report_clinical_provenance();

CREATE OR REPLACE FUNCTION private.enforce_workout_clinical_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(
      OLD.clinical_content_version,
      OLD.clinical_inventory_sha256,
      OLD.clinical_review_receipt_sha256
    ) IS DISTINCT FROM ROW(
      NEW.clinical_content_version,
      NEW.clinical_inventory_sha256,
      NEW.clinical_review_receipt_sha256
    ) THEN
      RAISE EXCEPTION 'workout clinical provenance is immutable'
        USING ERRCODE = '55000';
    END IF;

    -- Token removal with a durable revocation timestamp is always permitted:
    -- consent withdrawal and revocation must remain usable even for legacy or
    -- inactive releases.  Every positive share mutation requires the exact
    -- active release, including direct service-role updates that bypass the RPC.
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
        RAISE EXCEPTION 'workout clinical release is not active'
          USING ERRCODE = '55000';
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
    RAISE EXCEPTION 'workout clinical release is not active'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.program_snapshot->>'version' <> '3'
    OR NEW.program_snapshot#>>'{clinicalContent,version}' <> NEW.clinical_content_version
    OR NEW.program_snapshot#>>'{clinicalContent,inventorySha256}' <> NEW.clinical_inventory_sha256
  THEN
    RAISE EXCEPTION 'workout snapshot clinical content does not match stored provenance'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workout_sessions_clinical_provenance_guard
  BEFORE INSERT OR UPDATE ON public.workout_sessions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_workout_clinical_provenance();

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
      AND private.active_clinical_receipt(
        session.clinical_content_version,
        session.clinical_inventory_sha256,
        'workouts'
      ) = session.clinical_review_receipt_sha256
  ) THEN
    RAISE EXCEPTION 'workout clinical release is not active'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER session_runs_active_clinical_release
  BEFORE INSERT OR UPDATE ON public.session_runs
  FOR EACH ROW EXECUTE FUNCTION private.enforce_active_workout_child();
CREATE TRIGGER workout_ratings_active_clinical_release
  BEFORE INSERT OR UPDATE ON public.workout_ratings
  FOR EACH ROW EXECUTE FUNCTION private.enforce_active_workout_child();

REVOKE ALL ON FUNCTION private.enforce_report_clinical_provenance()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.enforce_workout_clinical_provenance()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.enforce_active_workout_child()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- ============================================================================
-- 3. Fail-closed report finalization.
-- ============================================================================

-- The old finalizer cannot distinguish assessment-only output from a clinical
-- PDF.  Leave its signature callable by the immediately prior deployment, but
-- make it a non-mutating hard denial so it can never mint unversioned content.
CREATE OR REPLACE FUNCTION public.finalize_report_upload(
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object('status', 'clinical_provenance_required');
$$;

CREATE FUNCTION public.finalize_report_upload_v2(
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

-- ============================================================================
-- 4. Fail-closed workout creation, resolution, rotation, and completion.
-- ============================================================================

-- Legacy creation lacks clinical version arguments and therefore cannot prove
-- an active HG-03 release.  It remains only as a non-mutating compatibility
-- stub so stale callers fail closed with a stable status.
CREATE OR REPLACE FUNCTION public.create_workout_session_governed(
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object('status', 'clinical_content_unavailable');
$$;

CREATE FUNCTION public.create_workout_session_clinical_governed(
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
  legal_provenance_state text,
  clinical_content_version text,
  clinical_inventory_sha256 text,
  clinical_review_receipt_sha256 text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    session.id,
    session.practitioner_id,
    session.client_id,
    (SELECT run.id FROM public.session_runs run
      WHERE run.workout_session_id = session.id
      ORDER BY run.created_at ASC
      LIMIT 1),
    session.program_snapshot,
    session.estimated_duration_sec,
    client.first_name,
    session.expires_at,
    session.share_generation,
    session.legal_document_id,
    session.legal_document_version,
    session.legal_document_body_sha256,
    session.legal_document_effective_at,
    session.legal_jurisdiction,
    session.legal_product_scope,
    session.legal_provenance_state,
    session.clinical_content_version,
    session.clinical_inventory_sha256,
    session.clinical_review_receipt_sha256
  FROM public.workout_sessions session
  JOIN public.assessments assessment ON assessment.id = session.assessment_id
  JOIN public.clients client ON client.id = session.client_id
  JOIN public.practitioners practitioner ON practitioner.id = session.practitioner_id
  WHERE session.session_token_hash IS NOT NULL
    AND session.session_token_hash = p_token_hash
    AND session.revoked_at IS NULL
    AND session.status = 'active'
    AND session.expires_at IS NOT NULL
    AND session.expires_at > pg_catalog.clock_timestamp()
    AND assessment.practitioner_approved = true
    AND client.deleted_at IS NULL
    AND private.active_clinical_receipt(
      session.clinical_content_version,
      session.clinical_inventory_sha256,
      'workouts'
    ) = session.clinical_review_receipt_sha256
    AND EXISTS (
      SELECT 1
      FROM (
        SELECT consent.kind, consent.revoked_at
        FROM public.consent_records consent
        WHERE consent.client_id = session.client_id
          AND consent.practitioner_id = session.practitioner_id
        ORDER BY consent.recorded_at DESC, consent.id DESC
        LIMIT 1
      ) latest
      WHERE latest.kind <> 'revocation' AND latest.revoked_at IS NULL
    )
    AND practitioner.access_status = 'active';
$$;

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

-- Browser roles can call none of these security-definer boundaries.  Service
-- role receives only the exact public operations used by the server.
REVOKE ALL ON FUNCTION public.finalize_report_upload(
  uuid, uuid, text, uuid, text, text, text, timestamptz, text, text
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.finalize_report_upload(
  uuid, uuid, text, uuid, text, text, text, timestamptz, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_report_upload_v2(
  uuid, uuid, text, uuid, text, text, text, timestamptz, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.finalize_report_upload_v2(
  uuid, uuid, text, uuid, text, text, text, timestamptz, text, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.create_workout_session_governed(
  uuid, uuid, uuid, int, text, jsonb, int, text, timestamptz, uuid, text,
  text, text, text, timestamptz, text, text
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.create_workout_session_governed(
  uuid, uuid, uuid, int, text, jsonb, int, text, timestamptz, uuid, text,
  text, text, text, timestamptz, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.create_workout_session_clinical_governed(
  uuid, uuid, uuid, int, text, jsonb, int, text, timestamptz, uuid, text,
  text, text, text, timestamptz, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.create_workout_session_clinical_governed(
  uuid, uuid, uuid, int, text, jsonb, int, text, timestamptz, uuid, text,
  text, text, text, timestamptz, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.resolve_workout_token(text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.resolve_workout_token(text) TO service_role;

REVOKE ALL ON FUNCTION public.rotate_workout_share(uuid, uuid, text, timestamptz, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.rotate_workout_share(uuid, uuid, text, timestamptz, uuid, timestamptz)
  TO service_role;

-- revoke_workout_share is intentionally unchanged and remains service-role
-- executable even when provenance is missing or its release is inactive.

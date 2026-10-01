-- Remove the clinical-content review gate (owner decision, 2026-10-01).
--
-- Until now every clinical surface (muscle links, recommendations, programs,
-- workouts, clinical reports) required an HG-03 release signed by a licensed
-- clinician and activated in private.clinical_content_activation. The product
-- owner removed that gate: the full catalog is shown to every practitioner.
--
-- The app now records content as an "open" version named
--   clinical-content-open-<first 12 hex chars of the inventory SHA-256>
-- This migration makes that version active for every surface. It is backed by
-- one receipt that says plainly that no clinical review happened
-- (receipt_kind 'open_ungated', attestation 'no_clinical_review'), so stored
-- provenance never claims a review. Release rows are created on first use, so
-- a code change that moves the inventory hash needs no database step.
-- Existing HG-03 / test-fixture releases keep working unchanged.

-- 1. Allow the open receipt and release kinds.
ALTER TABLE public.clinical_content_review_receipts
  DROP CONSTRAINT clinical_content_review_receipts_receipt_kind_check,
  ADD CONSTRAINT clinical_content_review_receipts_receipt_kind_check
    CHECK (receipt_kind IN ('hg03_clinical_review', 'local_test_fixture', 'open_ungated'));
ALTER TABLE public.clinical_content_review_receipts
  DROP CONSTRAINT clinical_content_review_receipts_attestation_check,
  ADD CONSTRAINT clinical_content_review_receipts_attestation_check
    CHECK (attestation IN ('licensed_clinician', 'local_test_fixture_not_clinical_approval', 'no_clinical_review'));
ALTER TABLE public.clinical_content_review_receipts
  DROP CONSTRAINT clinical_content_review_receipts_kind_shape,
  ADD CONSTRAINT clinical_content_review_receipts_kind_shape CHECK (
    (
      receipt_kind = 'hg03_clinical_review'
      AND attestation = 'licensed_clinician'
      AND char_length(btrim(reviewer_name)) >= 2
      AND char_length(btrim(license_jurisdiction)) >= 2
      AND char_length(btrim(license_identifier)) >= 2
    ) OR (
      receipt_kind = 'local_test_fixture'
      AND attestation = 'local_test_fixture_not_clinical_approval'
      AND reviewer_name IS NULL AND license_jurisdiction IS NULL AND license_identifier IS NULL
    ) OR (
      receipt_kind = 'open_ungated'
      AND attestation = 'no_clinical_review'
      AND reviewer_name IS NULL AND license_jurisdiction IS NULL AND license_identifier IS NULL
    )
  );
ALTER TABLE public.clinical_content_releases
  DROP CONSTRAINT clinical_content_releases_release_kind_check,
  ADD CONSTRAINT clinical_content_releases_release_kind_check
    CHECK (release_kind IN ('hg03_approved', 'local_test_fixture', 'open_ungated'));

-- 2. The single open receipt.
CREATE OR REPLACE FUNCTION private.open_clinical_receipt()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to('posture-ai:clinical-content-open:v1', 'UTF8')),
    'hex'
  );
$$;

INSERT INTO public.clinical_content_review_receipts (
  receipt_sha256, receipt_kind, artifact_reference, signed_at, attestation
) VALUES (
  private.open_clinical_receipt(),
  'open_ungated',
  'Clinical-content review gate removed by the product owner on 2026-10-01. Content is shown without licensed-clinician review.',
  '2026-10-01T00:00:00Z',
  'no_clinical_review'
)
ON CONFLICT (receipt_sha256) DO NOTHING;

CREATE OR REPLACE FUNCTION private.is_open_clinical_release(
  p_release_id text,
  p_inventory_sha256 text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_inventory_sha256 ~ '^[0-9a-f]{64}$'
    AND p_release_id = 'clinical-content-open-' || pg_catalog.left(p_inventory_sha256, 12);
$$;

-- 3. Open releases are active for every surface; everything else is unchanged.
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
  SELECT CASE
    WHEN private.is_open_clinical_release(p_release_id, p_inventory_sha256)
      AND p_surface IN (
        'recommendations', 'programs', 'workouts', 'knowledge_links',
        'clinical_practitioner_report', 'clinical_client_report'
      )
    THEN private.open_clinical_receipt()
    ELSE (
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
      LIMIT 1
    )
  END;
$$;

REVOKE ALL ON FUNCTION private.active_clinical_receipt(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

-- 4. Create the open release row on first use, so the provenance foreign keys
-- on reports and workout_sessions resolve for any inventory hash.
CREATE OR REPLACE FUNCTION private.ensure_open_clinical_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.clinical_content_version IS NOT NULL
    AND private.is_open_clinical_release(NEW.clinical_content_version, NEW.clinical_inventory_sha256)
  THEN
    INSERT INTO public.clinical_content_releases (
      id, inventory_sha256, hg03_receipt_sha256, release_kind, approved_at,
      recommendations_enabled, programs_enabled, workouts_enabled, knowledge_links_enabled
    ) VALUES (
      NEW.clinical_content_version, NEW.clinical_inventory_sha256, private.open_clinical_receipt(),
      'open_ungated', pg_catalog.clock_timestamp(), true, true, true, true
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.open_clinical_receipt() FROM PUBLIC, anon, authenticated, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.is_open_clinical_release(text, text) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.ensure_open_clinical_release()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER reports_ensure_open_clinical_release
  BEFORE INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION private.ensure_open_clinical_release();
CREATE TRIGGER workout_sessions_ensure_open_clinical_release
  BEFORE INSERT ON public.workout_sessions
  FOR EACH ROW EXECUTE FUNCTION private.ensure_open_clinical_release();

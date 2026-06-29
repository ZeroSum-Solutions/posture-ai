-- Regulatory hardening v2 — close the direct-DB-write bypass found in review.
--
-- The compliance gates (subject consent, age policy, face-landmark stripping,
-- no-image-bytes, export approval) are enforced in the Next API routes only.
-- Because `authenticated` held blanket INSERT/UPDATE/DELETE on every table plus
-- permissive `*_own` RLS, a practitioner using the browser Supabase client could
-- write regulated rows directly and skip every gate. Fix: make the API
-- (service-role) the SOLE writer of regulated tables by revoking write grants
-- from the public roles, and add defense-in-depth at the DB. SELECT is retained
-- (RLS still scopes reads); service_role keeps its grants and is unaffected.

-- ============================================================================
-- 1. Revoke direct writes on regulated tables from the public API roles.
-- ============================================================================
REVOKE INSERT, UPDATE, DELETE ON
  -- per-client / per-assessment regulated data
  clients, assessments, captures, assessment_findings, reports,
  exercise_recommendations,
  consent_records, consent_tokens, client_deletion_log, organizations,
  -- shared reference/KB + internal infra: only migrations/service-role write
  -- these at runtime, so a practitioner has no business writing them directly
  -- (otherwise one tenant could vandalize data shared across all tenants).
  exercises, exercise_muscles, muscles, muscle_imbalance_links,
  imbalance_definitions, api_rate_limits
  FROM anon, authenticated;
-- `practitioners` intentionally retains authenticated self-write (onboarding ack,
-- own profile); it is row-scoped by RLS to the caller's own row.

-- ============================================================================
-- 2. Defense-in-depth: reject obvious raw-image payloads smuggled into the
--    captures.pose_frame JSONB (the existing CHECK only guards storage_path).
--    Landmark-level minimization is enforced in the API; this blocks the
--    coarsest image-bytes smuggling at the DB even for a service-role write bug.
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE captures ADD CONSTRAINT captures_pose_frame_no_image
    CHECK (
      pose_frame IS NULL
      OR NOT (pose_frame ?| ARRAY['image','imageData','dataUrl','dataURL','base64','blob','bytes','png','jpeg','jpg'])
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================================
-- 3. Tighten the consent_records insert policy (belt-and-suspenders): a consent
--    row must reference a client the signer actually owns. The API enforces this
--    too; this guards against any future re-grant of authenticated writes.
-- ============================================================================
DROP POLICY IF EXISTS consent_records_insert_own ON consent_records;
CREATE POLICY consent_records_insert_own ON consent_records FOR INSERT
  WITH CHECK (
    practitioner_id = (select auth.uid())
    AND EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_id AND c.practitioner_id = (select auth.uid())
    )
  );

-- ============================================================================
-- 4. Atomic remote-consent recording — fixes the non-transactional
--    claim+insert+stamp in /api/consent/respond. Claims the single-use token,
--    inserts the consent record, and stamps the client in ONE transaction; if
--    any step fails the whole thing rolls back, so a token is never consumed
--    without a recorded consent. Returns a status the route maps to 200/404/410.
-- ============================================================================
CREATE OR REPLACE FUNCTION record_remote_consent(
  p_token text,
  p_signer_name text,
  p_signer_relationship text,
  p_consent_hash text,
  p_signed_at timestamptz
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client uuid;
  v_prac uuid;
  v_version text;
BEGIN
  -- Resolve the token's client and LOCK that client row, so a concurrent
  -- right-to-erasure can't tombstone it between this check and the insert. Refuse
  -- (WITHOUT consuming the token) if the token is unknown or the client is already
  -- erased — this closes the erasure/remote-consent TOCTOU.
  SELECT ct.client_id, ct.practitioner_id, ct.consent_version
    INTO v_client, v_prac, v_version
    FROM consent_tokens ct WHERE ct.token = p_token;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  PERFORM 1 FROM clients WHERE id = v_client AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  -- Atomically claim the single-use, unexpired token.
  UPDATE consent_tokens
     SET consumed_at = p_signed_at
   WHERE token = p_token
     AND consumed_at IS NULL
     AND expires_at > p_signed_at;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM consent_tokens WHERE token = p_token AND consumed_at IS NOT NULL) THEN
      RETURN 'consumed';
    ELSE
      RETURN 'expired';
    END IF;
  END IF;

  INSERT INTO consent_records (
    client_id, practitioner_id, kind, consent_version, consent_hash,
    signer_name, signer_relationship, method, signed_at
  ) VALUES (
    v_client, v_prac, 'enrollment', v_version, p_consent_hash,
    btrim(p_signer_name), p_signer_relationship::signer_relationship_enum, 'remote_link', p_signed_at
  );

  UPDATE clients SET consent_recorded_at = p_signed_at WHERE id = v_client;

  RETURN 'ok';
END;
$$;

-- Lock execution to service_role only. NOTE: role_grants.sql sets ALTER DEFAULT
-- PRIVILEGES granting EXECUTE on new functions to anon+authenticated, so a bare
-- `REVOKE ... FROM PUBLIC` would leave these SECURITY DEFINER functions callable
-- by a browser client (which could forge consent, bypassing practitionerGate).
-- Revoke from those roles explicitly.
REVOKE ALL ON FUNCTION record_remote_consent(text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_remote_consent(text, text, text, text, timestamptz) TO service_role;

-- ============================================================================
-- 5. Atomic in-person consent recording — same locked guarantee for the
--    practitioner-device e-signature path (/api/consent). Locks the OWNED,
--    non-tombstoned client row, inserts the consent record, and stamps the
--    client in one transaction, so consent can't be recorded on a client that is
--    mid/after right-to-erasure (closes the in-person variant of the TOCTOU).
-- ============================================================================
CREATE OR REPLACE FUNCTION record_inperson_consent(
  p_client_id uuid,
  p_practitioner_id uuid,
  p_consent_version text,
  p_signer_name text,
  p_signer_relationship text,
  p_consent_hash text,
  p_signed_at timestamptz
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM clients
   WHERE id = p_client_id
     AND practitioner_id = p_practitioner_id
     AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  INSERT INTO consent_records (
    client_id, practitioner_id, kind, consent_version, consent_hash,
    signer_name, signer_relationship, method, signed_at
  ) VALUES (
    p_client_id, p_practitioner_id, 'enrollment', p_consent_version, p_consent_hash,
    btrim(p_signer_name), p_signer_relationship::signer_relationship_enum, 'e_signature', p_signed_at
  );

  UPDATE clients SET consent_recorded_at = p_signed_at WHERE id = p_client_id;

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION record_inperson_consent(uuid, uuid, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_inperson_consent(uuid, uuid, text, text, text, text, timestamptz) TO service_role;

-- ============================================================================
-- 6. Lock down practitioners writes — close an org-IDOR / BAA-gate bypass.
--    practitioners.organization_id drives the BAA gate and is the link the
--    /api/settings/organization route trusts. With table-level UPDATE, a
--    practitioner could self-set organization_id to ANOTHER tenant's org (org
--    ids were world-readable, see below) and then mutate that org via the
--    service-role settings route, or null it to dodge the gate. Fix: revoke
--    table-level write and re-grant UPDATE only on the self-service profile
--    columns, so organization_id is service-role-only (set exclusively by the
--    settings route to an org it created for the caller). INSERT is handled by
--    the SECURITY DEFINER handle_new_user trigger, so authenticated needs none.
REVOKE INSERT, UPDATE, DELETE ON practitioners FROM anon, authenticated;
GRANT UPDATE (display_name, practice_name, logo_storage_path, non_diagnostic_ack_at, updated_at)
  ON practitioners TO authenticated;

-- Restrict organization visibility to the caller's own org. It was USING(true),
-- which leaked every tenant's org name + BAA status and, critically, let a caller
-- enumerate other org ids (the IDOR enabler). Server reads that need the org use
-- service-role, so they are unaffected by this tightening.
DROP POLICY IF EXISTS organizations_read ON organizations;
CREATE POLICY organizations_read ON organizations FOR SELECT
  USING (id = (SELECT organization_id FROM practitioners WHERE id = (select auth.uid())));

-- ============================================================================
-- 7. Reject new regulated rows for a tombstoned client (DB-enforced), so a
--    right-to-erasure can't race a concurrent write and leave data behind a
--    successful delete. FOR UPDATE locks the client row, serializing the insert
--    against erasure's client tombstone UPDATE (which also locks it): the row is
--    therefore either created BEFORE the tombstone (then caught by erasure's
--    delete-by-client_id / report-file purge) or rejected AFTER it. Lock order is
--    clients-first everywhere (these triggers, the consent RPCs, erasure), so
--    there is no deadlock. captures/assessment_findings need no trigger: they FK
--    to assessments, so a deleted client's assessment (+ children) cascade and a
--    late child insert FK-fails. consent_records go through the locked RPCs.
-- ============================================================================

-- Tables with a direct client_id (assessments, consent_tokens):
CREATE OR REPLACE FUNCTION reject_insert_for_deleted_client()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1 FROM clients WHERE id = NEW.client_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cannot create % for a deleted or unknown client (%)', TG_TABLE_NAME, NEW.client_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assessments_reject_deleted_client ON assessments;
CREATE TRIGGER assessments_reject_deleted_client
  BEFORE INSERT ON assessments
  FOR EACH ROW EXECUTE FUNCTION reject_insert_for_deleted_client();

DROP TRIGGER IF EXISTS consent_tokens_reject_deleted_client ON consent_tokens;
CREATE TRIGGER consent_tokens_reject_deleted_client
  BEFORE INSERT ON consent_tokens
  FOR EACH ROW EXECUTE FUNCTION reject_insert_for_deleted_client();

-- reports reach the client via assessment_id (primary) and, for comparison
-- reports, compared_to_assessment_id — BOTH must belong to a live client.
CREATE OR REPLACE FUNCTION reject_report_for_deleted_client()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1 FROM assessments a JOIN clients c ON c.id = a.client_id
   WHERE a.id = NEW.assessment_id AND c.deleted_at IS NULL FOR UPDATE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cannot create a report for a deleted or unknown client'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.compared_to_assessment_id IS NOT NULL THEN
    PERFORM 1 FROM assessments a JOIN clients c ON c.id = a.client_id
     WHERE a.id = NEW.compared_to_assessment_id AND c.deleted_at IS NULL FOR UPDATE OF c;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'cannot create a report comparing against a deleted or unknown client'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reports_reject_deleted_client ON reports;
CREATE TRIGGER reports_reject_deleted_client
  BEFORE INSERT ON reports
  FOR EACH ROW EXECUTE FUNCTION reject_report_for_deleted_client();

-- compared_to_assessment_id was a NO ACTION FK, so erasing a client whose
-- assessment is referenced as a COMPARISON in another (live) client's report
-- would be blocked. Switch it to ON DELETE SET NULL so erasure nulls the dangling
-- pointer and always completes; the primary assessment_id FK stays ON DELETE
-- CASCADE so a report is removed with its own client's data.
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_compared_to_assessment_id_fkey;
ALTER TABLE reports ADD CONSTRAINT reports_compared_to_assessment_id_fkey
  FOREIGN KEY (compared_to_assessment_id) REFERENCES assessments(id) ON DELETE SET NULL;

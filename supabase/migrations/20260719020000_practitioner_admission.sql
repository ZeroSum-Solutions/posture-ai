-- Invitation-only practitioner admission and AAL2 enforcement.
--
-- This migration is deliberately fail closed:
--   * every pre-existing practitioner becomes review_required (never active),
--   * every future auth.users insert must atomically claim a live invitation,
--   * invited/recovery users cannot read practitioner data until an AAL2 session
--     completes the corresponding admission/recovery state transition,
--   * service-only operator RPCs are the only invitation/review/recovery writers.
--
-- Hosted Auth configuration is a separate provider operation. The matching local
-- hook/MFA/signup settings live in supabase/config.toml.

CREATE SCHEMA IF NOT EXISTS private;

DO $$ BEGIN
  CREATE TYPE private.practitioner_invitation_state AS ENUM (
    'pending', 'provisioned', 'accepted', 'revoked', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE private.practitioner_recovery_state AS ENUM (
    'pending', 'completed', 'revoked', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.practitioner_access_status AS ENUM (
    'review_required', 'invited', 'active', 'recovery_pending', 'suspended', 'revoked'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION private.normalize_practitioner_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT pg_catalog.lower(pg_catalog.btrim(p_email));
$$;

CREATE TABLE IF NOT EXISTS private.practitioner_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized text NOT NULL,
  display_name text,
  state private.practitioner_invitation_state NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  provisioned_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  provisioned_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  expired_at timestamptz,
  issued_by text NOT NULL,
  revoked_by text,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT practitioner_invitations_email_normalized
    CHECK (email_normalized = pg_catalog.lower(pg_catalog.btrim(email_normalized))),
  CONSTRAINT practitioner_invitations_expiry_after_creation
    CHECK (expires_at > created_at),
  CONSTRAINT practitioner_invitations_provisioned_shape
    CHECK (
      state NOT IN ('provisioned', 'accepted')
      OR (provisioned_user_id IS NOT NULL AND provisioned_at IS NOT NULL)
    ),
  CONSTRAINT practitioner_invitations_accepted_shape
    CHECK (state <> 'accepted' OR accepted_at IS NOT NULL),
  CONSTRAINT practitioner_invitations_revoked_shape
    CHECK (state <> 'revoked' OR revoked_at IS NOT NULL),
  CONSTRAINT practitioner_invitations_expired_shape
    CHECK (state <> 'expired' OR expired_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS practitioner_invitations_one_open_email
  ON private.practitioner_invitations (email_normalized)
  WHERE state IN ('pending', 'provisioned');
CREATE INDEX IF NOT EXISTS practitioner_invitations_expires_at
  ON private.practitioner_invitations (expires_at)
  WHERE state IN ('pending', 'provisioned');

CREATE TABLE IF NOT EXISTS private.practitioner_mfa_recoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id uuid NOT NULL REFERENCES public.practitioners(id) ON DELETE CASCADE,
  email_normalized text NOT NULL,
  state private.practitioner_recovery_state NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  authorized_by text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  revoked_at timestamptz,
  expired_at timestamptz,
  CONSTRAINT practitioner_mfa_recoveries_email_normalized
    CHECK (email_normalized = pg_catalog.lower(pg_catalog.btrim(email_normalized))),
  CONSTRAINT practitioner_mfa_recoveries_expiry_after_creation
    CHECK (expires_at > created_at),
  CONSTRAINT practitioner_mfa_recoveries_completed_shape
    CHECK (state <> 'completed' OR completed_at IS NOT NULL),
  CONSTRAINT practitioner_mfa_recoveries_revoked_shape
    CHECK (state <> 'revoked' OR revoked_at IS NOT NULL),
  CONSTRAINT practitioner_mfa_recoveries_expired_shape
    CHECK (state <> 'expired' OR expired_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS practitioner_mfa_recoveries_one_open_user
  ON private.practitioner_mfa_recoveries (practitioner_id)
  WHERE state = 'pending';

CREATE TABLE IF NOT EXISTS private.practitioner_access_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  practitioner_id uuid REFERENCES public.practitioners(id) ON DELETE SET NULL,
  invitation_id uuid REFERENCES private.practitioner_invitations(id) ON DELETE SET NULL,
  recovery_id uuid REFERENCES private.practitioner_mfa_recoveries(id) ON DELETE SET NULL,
  event text NOT NULL CHECK (event IN (
    'invitation_issued', 'invitation_provisioned', 'invitation_accepted',
    'access_revoked', 'existing_practitioner_approved',
    'mfa_recovery_started', 'mfa_recovery_completed'
  )),
  actor text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE private.practitioner_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.practitioner_mfa_recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.practitioner_access_events ENABLE ROW LEVEL SECURITY;

-- Existing accounts are deliberately not grandfathered. They remain blocked until
-- approve_existing_practitioner records an explicit service-role review.
ALTER TABLE public.practitioners
  ADD COLUMN IF NOT EXISTS access_status public.practitioner_access_status;
UPDATE public.practitioners
   SET access_status = 'review_required'
 WHERE access_status IS NULL;
ALTER TABLE public.practitioners
  ALTER COLUMN access_status SET DEFAULT 'review_required',
  ALTER COLUMN access_status SET NOT NULL;

-- The beta has one server-controlled application role. Keep it explicit so an
-- authenticated row update can never manufacture practitioner authority.
ALTER TABLE public.practitioners
  ADD COLUMN IF NOT EXISTS role text;
UPDATE public.practitioners
   SET role = 'practitioner'
 WHERE role IS NULL;
ALTER TABLE public.practitioners
  ALTER COLUMN role SET DEFAULT 'practitioner',
  ALTER COLUMN role SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE public.practitioners
    ADD CONSTRAINT practitioners_role_check CHECK (role = 'practitioner');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.practitioners
  ADD COLUMN IF NOT EXISTS invitation_id uuid,
  ADD COLUMN IF NOT EXISTS access_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_reviewed_by text,
  ADD COLUMN IF NOT EXISTS access_revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_reason text;

DO $$ BEGIN
  ALTER TABLE public.practitioners
    ADD CONSTRAINT practitioners_invitation_id_fkey
    FOREIGN KEY (invitation_id)
    REFERENCES private.practitioner_invitations(id)
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS practitioners_invitation_id_unique
  ON public.practitioners (invitation_id)
  WHERE invitation_id IS NOT NULL;

-- The Auth hook is defense in depth and intentionally does not consume the row.
-- The auth.users AFTER INSERT trigger below is the transactional authority.
CREATE OR REPLACE FUNCTION public.hook_enforce_practitioner_invitation(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
BEGIN
  v_email := private.normalize_practitioner_email(event->'user'->>'email');

  IF v_email IS NULL OR NOT EXISTS (
    SELECT 1
      FROM private.practitioner_invitations pi
     WHERE pi.email_normalized = v_email
       AND pi.state = 'pending'
       AND pi.revoked_at IS NULL
       AND pi.expires_at > clock_timestamp()
  ) THEN
    RETURN jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'A current practitioner invitation is required.'
      )
    );
  END IF;

  RETURN '{}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_invitation private.practitioner_invitations%ROWTYPE;
BEGIN
  v_email := private.normalize_practitioner_email(NEW.email);

  SELECT pi.*
    INTO v_invitation
    FROM private.practitioner_invitations pi
   WHERE pi.email_normalized = v_email
     AND pi.state = 'pending'
     AND pi.revoked_at IS NULL
     AND pi.expires_at > clock_timestamp()
   ORDER BY pi.created_at ASC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'a current practitioner invitation is required'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE private.practitioner_invitations
     SET state = 'provisioned',
         provisioned_user_id = NEW.id,
         provisioned_at = clock_timestamp(),
         updated_at = clock_timestamp()
   WHERE id = v_invitation.id
     AND state = 'pending'
     AND revoked_at IS NULL
     AND expires_at > clock_timestamp();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'practitioner invitation is no longer available'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.practitioners (
    id, display_name, role, access_status, invitation_id, created_at, updated_at
  ) VALUES (
    NEW.id,
    COALESCE(v_invitation.display_name, NEW.raw_user_meta_data->>'full_name', NEW.email),
    'practitioner',
    'invited',
    v_invitation.id,
    clock_timestamp(),
    clock_timestamp()
  );

  INSERT INTO private.practitioner_access_events (
    practitioner_id, invitation_id, event, actor
  ) VALUES (
    NEW.id, v_invitation.id, 'invitation_provisioned', 'auth.users trigger'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Non-recursive because this SECURITY DEFINER helper is owned by the migration
-- owner and reads the practitioner row past its own RLS policy. Keep it in the
-- non-exposed private schema and return only a current-user boolean.
CREATE OR REPLACE FUNCTION private.is_active_aal2_practitioner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    COALESCE((auth.jwt()->>'aal') = 'aal2', false)
    AND EXISTS (
      SELECT 1
        FROM public.practitioners p
       WHERE p.id = auth.uid()
         AND p.role = 'practitioner'
         AND p.access_status = 'active'
    );
$$;

-- Restrictive policies are ANDed with the existing tenant-own permissive policies.
-- This avoids reopening access if a future permissive tenant policy is added.
DROP POLICY IF EXISTS practitioners_active_aal2_guard ON public.practitioners;
CREATE POLICY practitioners_active_aal2_guard ON public.practitioners
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.is_active_aal2_practitioner()))
  WITH CHECK ((SELECT private.is_active_aal2_practitioner()));

DROP POLICY IF EXISTS clients_active_aal2_guard ON public.clients;
CREATE POLICY clients_active_aal2_guard ON public.clients
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.is_active_aal2_practitioner()))
  WITH CHECK ((SELECT private.is_active_aal2_practitioner()));

DROP POLICY IF EXISTS assessments_active_aal2_guard ON public.assessments;
CREATE POLICY assessments_active_aal2_guard ON public.assessments
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.is_active_aal2_practitioner()))
  WITH CHECK ((SELECT private.is_active_aal2_practitioner()));

DROP POLICY IF EXISTS assessment_findings_active_aal2_guard ON public.assessment_findings;
CREATE POLICY assessment_findings_active_aal2_guard ON public.assessment_findings
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.is_active_aal2_practitioner()))
  WITH CHECK ((SELECT private.is_active_aal2_practitioner()));

DROP POLICY IF EXISTS captures_active_aal2_guard ON public.captures;
CREATE POLICY captures_active_aal2_guard ON public.captures
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.is_active_aal2_practitioner()))
  WITH CHECK ((SELECT private.is_active_aal2_practitioner()));

DROP POLICY IF EXISTS reports_active_aal2_guard ON public.reports;
CREATE POLICY reports_active_aal2_guard ON public.reports
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.is_active_aal2_practitioner()))
  WITH CHECK ((SELECT private.is_active_aal2_practitioner()));

DROP POLICY IF EXISTS exercise_recommendations_active_aal2_guard ON public.exercise_recommendations;
CREATE POLICY exercise_recommendations_active_aal2_guard ON public.exercise_recommendations
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.is_active_aal2_practitioner()))
  WITH CHECK ((SELECT private.is_active_aal2_practitioner()));

DROP POLICY IF EXISTS organizations_active_aal2_guard ON public.organizations;
CREATE POLICY organizations_active_aal2_guard ON public.organizations
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.is_active_aal2_practitioner()))
  WITH CHECK ((SELECT private.is_active_aal2_practitioner()));

DROP POLICY IF EXISTS consent_records_active_aal2_guard ON public.consent_records;
CREATE POLICY consent_records_active_aal2_guard ON public.consent_records
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.is_active_aal2_practitioner()))
  WITH CHECK ((SELECT private.is_active_aal2_practitioner()));

DROP POLICY IF EXISTS consent_tokens_active_aal2_guard ON public.consent_tokens;
CREATE POLICY consent_tokens_active_aal2_guard ON public.consent_tokens
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.is_active_aal2_practitioner()))
  WITH CHECK ((SELECT private.is_active_aal2_practitioner()));

DROP POLICY IF EXISTS client_deletion_log_active_aal2_guard ON public.client_deletion_log;
CREATE POLICY client_deletion_log_active_aal2_guard ON public.client_deletion_log
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.is_active_aal2_practitioner()))
  WITH CHECK ((SELECT private.is_active_aal2_practitioner()));

DROP POLICY IF EXISTS workout_sessions_active_aal2_guard ON public.workout_sessions;
CREATE POLICY workout_sessions_active_aal2_guard ON public.workout_sessions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.is_active_aal2_practitioner()))
  WITH CHECK ((SELECT private.is_active_aal2_practitioner()));

DROP POLICY IF EXISTS session_runs_active_aal2_guard ON public.session_runs;
CREATE POLICY session_runs_active_aal2_guard ON public.session_runs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.is_active_aal2_practitioner()))
  WITH CHECK ((SELECT private.is_active_aal2_practitioner()));

DROP POLICY IF EXISTS workout_ratings_active_aal2_guard ON public.workout_ratings;
CREATE POLICY workout_ratings_active_aal2_guard ON public.workout_ratings
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.is_active_aal2_practitioner()))
  WITH CHECK ((SELECT private.is_active_aal2_practitioner()));

DROP POLICY IF EXISTS workout_share_events_active_aal2_guard ON public.workout_share_events;
CREATE POLICY workout_share_events_active_aal2_guard ON public.workout_share_events
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.is_active_aal2_practitioner()))
  WITH CHECK ((SELECT private.is_active_aal2_practitioner()));

-- Service-only operator: mint or idempotently return the one open invitation for
-- an exact normalized email. Existing auth users must use explicit review instead.
CREATE OR REPLACE FUNCTION public.issue_practitioner_invitation(
  p_email text,
  p_display_name text,
  p_expires_at timestamptz,
  p_actor text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_invitation_id uuid;
BEGIN
  v_email := private.normalize_practitioner_email(p_email);
  IF v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid invitation email' USING ERRCODE = '22023';
  END IF;
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'actor is required' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'invitation expiry must be in the future' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 0));

  UPDATE private.practitioner_invitations
     SET state = 'expired', expired_at = clock_timestamp(), updated_at = clock_timestamp()
   WHERE email_normalized = v_email
     AND state IN ('pending', 'provisioned')
     AND expires_at <= clock_timestamp();

  SELECT id
    INTO v_invitation_id
    FROM private.practitioner_invitations
   WHERE email_normalized = v_email
     AND state IN ('pending', 'provisioned')
     AND revoked_at IS NULL
     AND expires_at > clock_timestamp()
   FOR UPDATE;

  IF FOUND THEN
    RETURN v_invitation_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM auth.users u
     WHERE private.normalize_practitioner_email(u.email) = v_email
  ) THEN
    RAISE EXCEPTION 'an auth account already exists; use explicit existing-account review'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO private.practitioner_invitations (
    email_normalized, display_name, expires_at, issued_by
  ) VALUES (
    v_email, NULLIF(pg_catalog.btrim(p_display_name), ''), p_expires_at, pg_catalog.btrim(p_actor)
  ) RETURNING id INTO v_invitation_id;

  INSERT INTO private.practitioner_access_events (
    invitation_id, event, actor
  ) VALUES (
    v_invitation_id, 'invitation_issued', pg_catalog.btrim(p_actor)
  );

  RETURN v_invitation_id;
END;
$$;

-- Authenticated completion derives identity and AAL directly from signed JWT
-- claims. It handles both first admission and an operator-authorized MFA recovery.
CREATE OR REPLACE FUNCTION public.complete_practitioner_invitation()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_user_id uuid := auth.uid();
  v_jwt_email text;
  v_auth_email text;
  v_aal text;
  v_role text;
  v_access_status public.practitioner_access_status;
  v_invitation_id uuid;
  v_invitation private.practitioner_invitations%ROWTYPE;
  v_recovery private.practitioner_mfa_recoveries%ROWTYPE;
  v_token_issued_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN 'not_invited';
  END IF;

  v_jwt_email := private.normalize_practitioner_email(v_claims->>'email');
  v_aal := v_claims->>'aal';
  BEGIN
    v_token_issued_at := pg_catalog.to_timestamp((v_claims->>'iat')::double precision);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    v_token_issued_at := NULL;
  END;

  SELECT private.normalize_practitioner_email(u.email)
    INTO v_auth_email
    FROM auth.users u
   WHERE u.id = v_user_id
   FOR SHARE;

  IF NOT FOUND THEN
    RETURN 'not_invited';
  END IF;
  IF v_jwt_email IS NULL OR v_jwt_email <> v_auth_email THEN
    RETURN 'email_mismatch';
  END IF;

  SELECT p.role, p.access_status, p.invitation_id
    INTO v_role, v_access_status, v_invitation_id
    FROM public.practitioners p
   WHERE p.id = v_user_id
   FOR UPDATE;

  IF NOT FOUND OR v_role IS DISTINCT FROM 'practitioner'
     OR v_access_status = 'review_required' THEN
    RETURN 'not_invited';
  END IF;
  IF v_access_status IN ('revoked', 'suspended') THEN
    RETURN 'revoked';
  END IF;
  IF v_aal IS DISTINCT FROM 'aal2' THEN
    RETURN 'mfa_required';
  END IF;
  IF v_access_status = 'active' THEN
    RETURN 'already_active';
  END IF;

  IF v_access_status = 'invited' THEN
    IF v_invitation_id IS NULL THEN
      RETURN 'not_invited';
    END IF;

    SELECT pi.*
      INTO v_invitation
      FROM private.practitioner_invitations pi
     WHERE pi.id = v_invitation_id
     FOR UPDATE;

    IF NOT FOUND OR v_invitation.provisioned_user_id IS DISTINCT FROM v_user_id THEN
      RETURN 'not_invited';
    END IF;
    IF v_invitation.email_normalized <> v_auth_email THEN
      RETURN 'email_mismatch';
    END IF;
    IF v_invitation.state = 'revoked' OR v_invitation.revoked_at IS NOT NULL THEN
      UPDATE public.practitioners
         SET access_status = 'revoked', access_revoked_at = clock_timestamp(), updated_at = clock_timestamp()
       WHERE id = v_user_id;
      RETURN 'revoked';
    END IF;
    IF v_invitation.state = 'expired' OR v_invitation.expires_at <= clock_timestamp() THEN
      UPDATE private.practitioner_invitations
         SET state = 'expired', expired_at = COALESCE(expired_at, clock_timestamp()), updated_at = clock_timestamp()
       WHERE id = v_invitation.id;
      RETURN 'expired';
    END IF;
    IF v_invitation.state <> 'provisioned' THEN
      RETURN 'not_invited';
    END IF;

    UPDATE private.practitioner_invitations
       SET state = 'accepted', accepted_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE id = v_invitation.id
       AND state = 'provisioned'
       AND provisioned_user_id = v_user_id
       AND revoked_at IS NULL
       AND expires_at > clock_timestamp();
    IF NOT FOUND THEN
      RETURN 'not_invited';
    END IF;

    UPDATE public.practitioners
       SET role = 'practitioner',
           access_status = 'active',
           access_accepted_at = clock_timestamp(),
           access_revoked_at = NULL,
           access_reason = NULL,
           updated_at = clock_timestamp()
     WHERE id = v_user_id AND access_status = 'invited';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'practitioner admission state changed concurrently'
        USING ERRCODE = '40001';
    END IF;

    INSERT INTO private.practitioner_access_events (
      practitioner_id, invitation_id, event, actor
    ) VALUES (
      v_user_id, v_invitation.id, 'invitation_accepted', v_auth_email
    );
    RETURN 'activated';
  END IF;

  IF v_access_status = 'recovery_pending' THEN
    SELECT r.*
      INTO v_recovery
      FROM private.practitioner_mfa_recoveries r
     WHERE r.practitioner_id = v_user_id
       AND r.state = 'pending'
     ORDER BY r.created_at DESC
     LIMIT 1
     FOR UPDATE;

    IF NOT FOUND THEN
      RETURN 'recovery_not_authorized';
    END IF;
    IF v_recovery.email_normalized <> v_auth_email THEN
      RETURN 'email_mismatch';
    END IF;
    IF v_recovery.expires_at <= clock_timestamp() THEN
      UPDATE private.practitioner_mfa_recoveries
         SET state = 'expired', expired_at = clock_timestamp()
       WHERE id = v_recovery.id AND state = 'pending';
      RETURN 'expired';
    END IF;
    -- Reject an AAL2 token minted before recovery began. Recovery completion must
    -- use a freshly established post-recovery session, not the old elevated token.
    IF v_token_issued_at IS NULL OR v_token_issued_at <= v_recovery.created_at THEN
      RETURN 'recovery_not_authorized';
    END IF;

    UPDATE private.practitioner_mfa_recoveries
       SET state = 'completed', completed_at = clock_timestamp()
     WHERE id = v_recovery.id
       AND state = 'pending'
       AND expires_at > clock_timestamp();
    IF NOT FOUND THEN
      RETURN 'recovery_not_authorized';
    END IF;

    UPDATE public.practitioners
       SET role = 'practitioner',
           access_status = 'active',
           access_reason = NULL,
           access_revoked_at = NULL,
           updated_at = clock_timestamp()
     WHERE id = v_user_id AND access_status = 'recovery_pending';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'practitioner recovery state changed concurrently'
        USING ERRCODE = '40001';
    END IF;

    INSERT INTO private.practitioner_access_events (
      practitioner_id, recovery_id, event, actor
    ) VALUES (
      v_user_id, v_recovery.id, 'mfa_recovery_completed', v_auth_email
    );
    RETURN 'activated';
  END IF;

  RETURN 'not_invited';
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_practitioner_access(
  p_email text,
  p_reason text,
  p_actor text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_user_id uuid;
  v_invitation_id uuid;
  v_transitioned boolean := false;
BEGIN
  v_email := private.normalize_practitioner_email(p_email);
  IF v_email IS NULL OR pg_catalog.btrim(COALESCE(p_reason, '')) = ''
     OR pg_catalog.btrim(COALESCE(p_actor, '')) = '' THEN
    RAISE EXCEPTION 'email, reason, and actor are required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 0));

  SELECT u.id
    INTO v_user_id
    FROM auth.users u
   WHERE private.normalize_practitioner_email(u.email) = v_email
   FOR SHARE;

  IF v_user_id IS NOT NULL THEN
    SELECT p.invitation_id
      INTO v_invitation_id
      FROM public.practitioners p
     WHERE p.id = v_user_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'practitioner record was not found' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    SELECT pi.id
      INTO v_invitation_id
      FROM private.practitioner_invitations pi
     WHERE pi.email_normalized = v_email
       AND pi.state IN ('pending', 'provisioned', 'accepted')
     ORDER BY pi.created_at DESC
     LIMIT 1
     FOR UPDATE;
  END IF;

  IF v_invitation_id IS NOT NULL THEN
    UPDATE private.practitioner_invitations
       SET state = 'revoked',
           revoked_at = COALESCE(revoked_at, clock_timestamp()),
           revoked_by = pg_catalog.btrim(p_actor),
           revoke_reason = pg_catalog.btrim(p_reason),
           updated_at = clock_timestamp()
     WHERE id = v_invitation_id
       AND state <> 'revoked';
    v_transitioned := FOUND;
  END IF;

  IF v_user_id IS NOT NULL THEN
    UPDATE private.practitioner_mfa_recoveries
     SET state = 'revoked', revoked_at = COALESCE(revoked_at, clock_timestamp())
     WHERE practitioner_id = v_user_id AND state = 'pending';
    v_transitioned := v_transitioned OR FOUND;

    UPDATE public.practitioners
       SET access_status = 'revoked',
           access_revoked_at = COALESCE(access_revoked_at, clock_timestamp()),
           access_reason = pg_catalog.btrim(p_reason),
           updated_at = clock_timestamp()
     WHERE id = v_user_id
       AND access_status <> 'revoked';
    v_transitioned := v_transitioned OR FOUND;
  END IF;

  IF v_transitioned THEN
    INSERT INTO private.practitioner_access_events (
      practitioner_id, invitation_id, event, actor, reason
    ) VALUES (
      v_user_id, v_invitation_id, 'access_revoked',
      pg_catalog.btrim(p_actor), pg_catalog.btrim(p_reason)
    );
  END IF;

  RETURN v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_existing_practitioner(
  p_email text,
  p_actor text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_user_id uuid;
  v_status public.practitioner_access_status;
  v_invitation_id uuid;
BEGIN
  v_email := private.normalize_practitioner_email(p_email);
  IF v_email IS NULL OR pg_catalog.btrim(COALESCE(p_actor, '')) = '' THEN
    RAISE EXCEPTION 'email and actor are required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 0));

  SELECT u.id
    INTO v_user_id
    FROM auth.users u
   WHERE private.normalize_practitioner_email(u.email) = v_email
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'existing auth account was not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT p.access_status, p.invitation_id
    INTO v_status, v_invitation_id
    FROM public.practitioners p
   WHERE p.id = v_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'existing practitioner record was not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_invitation_id IS NOT NULL THEN
    RAISE EXCEPTION 'invited accounts must complete the invitation flow'
      USING ERRCODE = '22023';
  END IF;
  IF v_status = 'active' THEN
    RETURN v_user_id;
  END IF;
  IF v_status <> 'review_required' THEN
    RAISE EXCEPTION 'only review_required existing accounts can be approved'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.practitioners
     SET role = 'practitioner',
         access_status = 'active',
         access_reviewed_at = clock_timestamp(),
         access_reviewed_by = pg_catalog.btrim(p_actor),
         access_reason = NULL,
         access_revoked_at = NULL,
         updated_at = clock_timestamp()
   WHERE id = v_user_id AND access_status = 'review_required';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'practitioner review state changed concurrently'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO private.practitioner_access_events (
    practitioner_id, event, actor
  ) VALUES (
    v_user_id, 'existing_practitioner_approved', pg_catalog.btrim(p_actor)
  );
  RETURN v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_practitioner_mfa_recovery(
  p_email text,
  p_reason text,
  p_actor text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_user_id uuid;
  v_status public.practitioner_access_status;
  v_recovery_id uuid;
  v_created_recovery boolean := false;
BEGIN
  v_email := private.normalize_practitioner_email(p_email);
  IF v_email IS NULL OR pg_catalog.btrim(COALESCE(p_reason, '')) = ''
     OR pg_catalog.btrim(COALESCE(p_actor, '')) = '' THEN
    RAISE EXCEPTION 'email, reason, and actor are required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 0));

  SELECT u.id
    INTO v_user_id
    FROM auth.users u
   WHERE private.normalize_practitioner_email(u.email) = v_email
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth account was not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT p.access_status
    INTO v_status
    FROM public.practitioners p
   WHERE p.id = v_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'practitioner record was not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status NOT IN ('active', 'recovery_pending') THEN
    RAISE EXCEPTION 'only active practitioner access can enter MFA recovery'
      USING ERRCODE = '22023';
  END IF;

  UPDATE private.practitioner_mfa_recoveries
     SET state = 'expired', expired_at = clock_timestamp()
   WHERE practitioner_id = v_user_id
     AND state = 'pending'
     AND expires_at <= clock_timestamp();

  SELECT r.id
    INTO v_recovery_id
    FROM private.practitioner_mfa_recoveries r
   WHERE r.practitioner_id = v_user_id
     AND r.state = 'pending'
     AND r.expires_at > clock_timestamp()
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO private.practitioner_mfa_recoveries (
      practitioner_id, email_normalized, expires_at, authorized_by, reason
    ) VALUES (
      v_user_id, v_email, clock_timestamp() + interval '30 minutes',
      pg_catalog.btrim(p_actor), pg_catalog.btrim(p_reason)
    ) RETURNING id INTO v_recovery_id;
    v_created_recovery := true;
  END IF;

  IF v_status = 'active' OR v_created_recovery THEN
    UPDATE public.practitioners
       SET access_status = 'recovery_pending',
           access_reason = pg_catalog.btrim(p_reason),
           updated_at = clock_timestamp()
     WHERE id = v_user_id
       AND access_status IN ('active', 'recovery_pending');

    INSERT INTO private.practitioner_access_events (
      practitioner_id, recovery_id, event, actor, reason
    ) VALUES (
      v_user_id, v_recovery_id, 'mfa_recovery_started',
      pg_catalog.btrim(p_actor), pg_catalog.btrim(p_reason)
    );
  END IF;
  RETURN v_user_id;
END;
$$;

-- Public workout links remain anonymous, but revoking their practitioner now
-- invalidates resolution immediately after the revocation transaction commits.
CREATE OR REPLACE FUNCTION public.resolve_workout_token(p_token_hash text)
RETURNS TABLE (
  workout_session_id uuid,
  practitioner_id uuid,
  client_id uuid,
  session_run_id uuid,
  program_snapshot jsonb,
  estimated_duration_sec int,
  client_first_name text,
  expires_at timestamptz
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
    ws.expires_at
  FROM public.workout_sessions ws
  JOIN public.assessments a ON a.id = ws.assessment_id
  JOIN public.clients c ON c.id = ws.client_id
  JOIN public.practitioners p ON p.id = ws.practitioner_id
  WHERE ws.session_token_hash IS NOT NULL
    AND ws.session_token_hash = p_token_hash
    AND ws.revoked_at IS NULL
    AND ws.status = 'active'
    AND ws.expires_at IS NOT NULL
    AND ws.expires_at > clock_timestamp()
    AND a.practitioner_approved = true
    AND c.deleted_at IS NULL
    AND p.access_status = 'active';
$$;

-- Remote consent is also token-authenticated/service-role mediated. Lock the
-- active practitioner row before the client row so a completed revocation cannot
-- be followed by a late consent write.
CREATE OR REPLACE FUNCTION public.record_remote_consent(
  p_token_hash text,
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
  v_client uuid;
  v_prac uuid;
  v_version text;
BEGIN
  SELECT ct.client_id, ct.practitioner_id, ct.consent_version
    INTO v_client, v_prac, v_version
    FROM public.consent_tokens ct
   WHERE ct.token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  PERFORM 1
    FROM public.practitioners p
   WHERE p.id = v_prac AND p.access_status = 'active'
   FOR SHARE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  PERFORM 1
    FROM public.clients c
   WHERE c.id = v_client AND c.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  UPDATE public.consent_tokens
     SET consumed_at = p_signed_at
   WHERE token_hash = p_token_hash
     AND consumed_at IS NULL
     AND expires_at > p_signed_at;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.consent_tokens
       WHERE token_hash = p_token_hash AND consumed_at IS NOT NULL
    ) THEN
      RETURN 'consumed';
    ELSE
      RETURN 'expired';
    END IF;
  END IF;

  INSERT INTO public.consent_records (
    client_id, practitioner_id, kind, consent_version, consent_hash,
    signer_name, signer_relationship, method, signed_at
  ) VALUES (
    v_client, v_prac, 'enrollment', v_version, p_consent_hash,
    pg_catalog.btrim(p_signer_name),
    p_signer_relationship::public.signer_relationship_enum,
    'remote_link', p_signed_at
  );

  UPDATE public.clients SET consent_recorded_at = p_signed_at WHERE id = v_client;
  RETURN 'ok';
END;
$$;

-- Lock down private state and every definer function explicitly. Earlier default
-- privileges grant new public functions/tables to browser roles, so omission here
-- would be an authorization defect rather than cosmetic grant hygiene.
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON private.practitioner_invitations,
  private.practitioner_mfa_recoveries,
  private.practitioner_access_events
  FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON private.practitioner_invitations,
  private.practitioner_mfa_recoveries,
  private.practitioner_access_events
  TO service_role;
GRANT USAGE, SELECT ON SEQUENCE private.practitioner_access_events_id_seq TO service_role;

REVOKE ALL ON FUNCTION private.normalize_practitioner_email(text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.is_active_aal2_practitioner()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.is_active_aal2_practitioner() TO authenticated;

REVOKE UPDATE (role, access_status, invitation_id, access_accepted_at,
  access_reviewed_at, access_reviewed_by, access_revoked_at, access_reason)
  ON public.practitioners FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.hook_enforce_practitioner_invitation(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hook_enforce_practitioner_invitation(jsonb)
  TO supabase_auth_admin;

REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION public.issue_practitioner_invitation(text, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_practitioner_invitation(text, text, timestamptz, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.complete_practitioner_invitation()
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.complete_practitioner_invitation() TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_practitioner_access(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_practitioner_access(text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.approve_existing_practitioner(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_existing_practitioner(text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.begin_practitioner_mfa_recovery(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_practitioner_mfa_recovery(text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.resolve_workout_token(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_workout_token(text) TO service_role;

REVOKE ALL ON FUNCTION public.record_remote_consent(text, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_remote_consent(text, text, text, text, timestamptz)
  TO service_role;

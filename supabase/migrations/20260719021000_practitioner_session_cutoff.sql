-- Close recovery-session replay and expose only the caller's admission state.
--
-- A practitioner entering MFA recovery is blocked immediately by access_status.
-- This migration also records the earliest acceptable JWT issue time so an older
-- stolen AAL2 token cannot become useful again after the new factor reactivates
-- the account.

ALTER TABLE public.practitioners
  ADD COLUMN IF NOT EXISTS session_valid_after timestamptz
  NOT NULL DEFAULT '-infinity'::timestamptz;

ALTER TABLE private.practitioner_mfa_recoveries
  ADD COLUMN IF NOT EXISTS ready_at timestamptz;

ALTER TABLE private.practitioner_invitations
  DROP CONSTRAINT IF EXISTS practitioner_invitations_provisioned_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS practitioner_invitations_one_bound_open_user
  ON private.practitioner_invitations (provisioned_user_id)
  WHERE provisioned_user_id IS NOT NULL
    AND state IN ('pending', 'provisioned', 'accepted');

-- Pre-migration practitioners were deliberately review-gated without an
-- invitation. Preserve the email used for that review as an immutable operator
-- lookup key so later Auth email changes cannot make revocation/recovery miss the
-- approved identity.
CREATE TABLE IF NOT EXISTS private.practitioner_identity_bindings (
  practitioner_id uuid PRIMARY KEY
    REFERENCES public.practitioners(id) ON DELETE CASCADE,
  email_normalized text NOT NULL UNIQUE,
  bound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  bound_by text NOT NULL,
  CONSTRAINT practitioner_identity_bindings_email_normalized
    CHECK (email_normalized = pg_catalog.lower(pg_catalog.btrim(email_normalized)))
);
ALTER TABLE private.practitioner_identity_bindings ENABLE ROW LEVEL SECURITY;

INSERT INTO private.practitioner_identity_bindings (
  practitioner_id, email_normalized, bound_by
)
SELECT
  p.id,
  private.normalize_practitioner_email(u.email),
  'migration:20260719021000'
FROM public.practitioners p
JOIN auth.users u ON u.id = p.id
WHERE p.invitation_id IS NULL
  AND u.email IS NOT NULL
ON CONFLICT (practitioner_id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.invalidate_sessions_for_mfa_recovery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.practitioners
     SET session_valid_after = pg_catalog.date_trunc('second', NEW.created_at) + interval '1 second',
         updated_at = clock_timestamp()
   WHERE id = NEW.practitioner_id;
  RETURN NEW;
END;
$$;

-- Recovery delivery is keyed by email at the provider boundary. Freeze an Auth
-- email while recovery_pending so the address returned by the preparation RPC
-- cannot change in the gap before the operator sends the recovery message.
CREATE OR REPLACE FUNCTION private.prevent_practitioner_email_change_during_recovery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email AND EXISTS (
    SELECT 1
      FROM public.practitioners p
     WHERE p.id = OLD.id
       AND p.access_status = 'recovery_pending'
  ) THEN
    RAISE EXCEPTION 'practitioner email cannot change during MFA recovery'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_practitioner_email_change_during_recovery
  ON auth.users;
CREATE TRIGGER prevent_practitioner_email_change_during_recovery
  BEFORE UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.prevent_practitioner_email_change_during_recovery();

DROP TRIGGER IF EXISTS invalidate_sessions_for_mfa_recovery
  ON private.practitioner_mfa_recoveries;
CREATE TRIGGER invalidate_sessions_for_mfa_recovery
  AFTER INSERT ON private.practitioner_mfa_recoveries
  FOR EACH ROW EXECUTE FUNCTION private.invalidate_sessions_for_mfa_recovery();

-- Recovery has two operator phases: block/delete factors, then mark the recovery
-- ready. A session may reactivate only when both the email recovery OTP and the
-- replacement TOTP were verified after that ready boundary. A stolen old JWT can
-- call GoTrue directly, so checking only AAL/iat or factor creation time is not
-- sufficient.
CREATE OR REPLACE FUNCTION private.enforce_recovery_auth_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ready_at timestamptz;
  v_amr jsonb := COALESCE(auth.jwt()->'amr', '[]'::jsonb);
  v_verified_factor_count integer;
  v_fresh_verified_factor_count integer;
BEGIN
  IF OLD.access_status = 'recovery_pending' AND NEW.access_status = 'active' THEN
    SELECT r.ready_at
      INTO v_ready_at
     FROM private.practitioner_mfa_recoveries r
     WHERE r.practitioner_id = OLD.id
       -- complete_practitioner_invitation marks the recovery completed before it
       -- updates access_status in the same transaction, so the trigger can see
       -- either state while enforcing the transition.
       AND r.state IN ('pending', 'completed')
     ORDER BY r.created_at DESC
     LIMIT 1
     FOR UPDATE;

    IF v_ready_at IS NULL THEN
      RAISE EXCEPTION 'MFA recovery is not ready for completion'
        USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.jsonb_array_elements(v_amr) AS entry(value)
       WHERE entry.value->>'method' = 'otp'
         AND COALESCE(entry.value->>'timestamp', '') ~ '^[0-9]+([.][0-9]+)?$'
         AND pg_catalog.to_timestamp((entry.value->>'timestamp')::double precision) >= v_ready_at
    ) OR NOT EXISTS (
      SELECT 1
        FROM pg_catalog.jsonb_array_elements(v_amr) AS entry(value)
       WHERE entry.value->>'method' = 'totp'
         AND COALESCE(entry.value->>'timestamp', '') ~ '^[0-9]+([.][0-9]+)?$'
         AND pg_catalog.to_timestamp((entry.value->>'timestamp')::double precision) >= v_ready_at
    ) THEN
      RAISE EXCEPTION 'MFA recovery requires fresh email and authenticator verification'
        USING ERRCODE = '42501';
    END IF;

    SELECT
      pg_catalog.count(*)::integer,
      pg_catalog.count(*) FILTER (
        WHERE f.created_at >= v_ready_at
          AND f.last_challenged_at >= v_ready_at
      )::integer
      INTO v_verified_factor_count, v_fresh_verified_factor_count
      FROM auth.mfa_factors f
     WHERE f.user_id = OLD.id
       AND f.factor_type = 'totp'
       AND f.status = 'verified';
    IF v_verified_factor_count <> 1 OR v_fresh_verified_factor_count <> 1 THEN
      RAISE EXCEPTION 'MFA recovery requires exactly one fresh verified factor'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_recovery_auth_transition ON public.practitioners;
CREATE TRIGGER enforce_recovery_auth_transition
  BEFORE UPDATE OF access_status ON public.practitioners
  FOR EACH ROW EXECUTE FUNCTION private.enforce_recovery_auth_transition();

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
         AND COALESCE(
           pg_catalog.to_timestamp(
             CASE
               WHEN COALESCE(auth.jwt()->>'iat', '') ~ '^[0-9]+([.][0-9]+)?$'
                 THEN (auth.jwt()->>'iat')::double precision
               ELSE NULL
             END
           ) >= p.session_valid_after,
           false
         )
    );
$$;

-- The normal practitioners policy deliberately hides non-active rows. Middleware
-- still needs the caller's own status to route an invited/recovery user without
-- signing them out. This RPC returns no other identity and accepts no user id.
CREATE OR REPLACE FUNCTION public.current_practitioner_access_state()
RETURNS TABLE (
  non_diagnostic_ack_at timestamptz,
  access_status public.practitioner_access_status,
  role text,
  session_is_current boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p.non_diagnostic_ack_at,
    p.access_status,
    p.role,
    COALESCE(
      pg_catalog.to_timestamp(
        CASE
          WHEN COALESCE(auth.jwt()->>'iat', '') ~ '^[0-9]+([.][0-9]+)?$'
            THEN (auth.jwt()->>'iat')::double precision
          ELSE NULL
        END
      ) >= p.session_valid_after,
      false
    )
  FROM public.practitioners p
  WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION private.resolve_bound_practitioner(p_email text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := private.normalize_practitioner_email(p_email);
  v_legacy_user uuid;
  v_bound_user uuid;
  v_current_user uuid;
BEGIN
  SELECT b.practitioner_id
    INTO v_legacy_user
    FROM private.practitioner_identity_bindings b
   WHERE b.email_normalized = v_email;

  SELECT pi.provisioned_user_id
    INTO v_bound_user
    FROM private.practitioner_invitations pi
   WHERE pi.email_normalized = v_email
     AND pi.provisioned_user_id IS NOT NULL
   ORDER BY pi.created_at DESC
   LIMIT 1;

  SELECT u.id
    INTO v_current_user
    FROM auth.users u
   WHERE private.normalize_practitioner_email(u.email) = v_email;

  IF v_legacy_user IS NOT NULL AND v_bound_user IS NOT NULL
     AND v_legacy_user <> v_bound_user THEN
    RAISE EXCEPTION 'email resolves to different reviewed and invited identities'
      USING ERRCODE = 'P0003';
  END IF;

  v_bound_user := COALESCE(v_legacy_user, v_bound_user);
  IF v_bound_user IS NOT NULL AND v_current_user IS NOT NULL
     AND v_bound_user <> v_current_user THEN
    RAISE EXCEPTION 'email resolves to different bound and current identities'
      USING ERRCODE = 'P0003';
  END IF;

  RETURN COALESCE(v_bound_user, v_current_user);
END;
$$;

-- Prepare a safe delivery mode. A provider retry for an already-provisioned
-- identity uses password recovery instead of calling inviteUserByEmail again.
-- An expired provisioned invitation is rebound to the same immutable auth user.
CREATE OR REPLACE FUNCTION public.issue_practitioner_invitation_with_state(
  p_email text,
  p_display_name text,
  p_expires_at timestamptz,
  p_actor text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text;
  v_existing_id uuid;
  v_invitation_id uuid;
  v_user_id uuid;
  v_current_email text;
  v_status public.practitioner_access_status;
  v_current_invitation private.practitioner_invitations%ROWTYPE;
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

  v_user_id := private.resolve_bound_practitioner(v_email);

  IF v_user_id IS NOT NULL THEN
    SELECT private.normalize_practitioner_email(u.email)
      INTO v_current_email
      FROM auth.users u
     WHERE u.id = v_user_id
     FOR SHARE;

    SELECT p.access_status
      INTO v_status
      FROM public.practitioners p
     WHERE p.id = v_user_id
     FOR UPDATE;

    IF NOT FOUND OR v_status <> 'invited' THEN
      RAISE EXCEPTION 'existing account is not eligible for invitation redelivery'
        USING ERRCODE = '22023';
    END IF;

    SELECT pi.*
      INTO v_current_invitation
      FROM private.practitioner_invitations pi
      JOIN public.practitioners p ON p.invitation_id = pi.id
     WHERE p.id = v_user_id
     FOR UPDATE OF pi;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bound invitation was not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_current_invitation.state = 'provisioned'
       AND v_current_invitation.revoked_at IS NULL
       AND v_current_invitation.expires_at > clock_timestamp()
       AND v_current_invitation.email_normalized = v_current_email THEN
      RETURN pg_catalog.jsonb_build_object(
        'invitation_id', v_current_invitation.id,
        'created', false,
        'delivery', 'recovery',
        'target_email', v_current_email,
        'rollback_on_failure', false
      );
    END IF;

    IF v_current_invitation.state = 'revoked' OR v_current_invitation.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'revoked invitations require a separate access review'
        USING ERRCODE = '42501';
    END IF;

    UPDATE private.practitioner_invitations
       SET state = CASE
             WHEN state IN ('pending', 'provisioned') THEN 'expired'::private.practitioner_invitation_state
             ELSE state
           END,
           expired_at = CASE
             WHEN state IN ('pending', 'provisioned') THEN COALESCE(expired_at, clock_timestamp())
             ELSE expired_at
           END,
           updated_at = clock_timestamp()
     WHERE id = v_current_invitation.id;

    INSERT INTO private.practitioner_invitations (
      email_normalized, display_name, state, expires_at, provisioned_user_id,
      provisioned_at, issued_by
    ) VALUES (
      v_current_email,
      COALESCE(NULLIF(pg_catalog.btrim(p_display_name), ''), v_current_invitation.display_name),
      'provisioned',
      p_expires_at,
      v_user_id,
      clock_timestamp(),
      pg_catalog.btrim(p_actor)
    ) RETURNING id INTO v_invitation_id;

    UPDATE public.practitioners
       SET invitation_id = v_invitation_id,
           access_status = 'invited',
           updated_at = clock_timestamp()
     WHERE id = v_user_id AND access_status = 'invited';

    INSERT INTO private.practitioner_access_events (
      practitioner_id, invitation_id, event, actor
    ) VALUES
      (v_user_id, v_invitation_id, 'invitation_issued', pg_catalog.btrim(p_actor)),
      (v_user_id, v_invitation_id, 'invitation_provisioned', pg_catalog.btrim(p_actor));

    RETURN pg_catalog.jsonb_build_object(
      'invitation_id', v_invitation_id,
      'created', true,
      'delivery', 'recovery',
      'target_email', v_current_email,
      'rollback_on_failure', false
    );
  END IF;

  SELECT pi.id
    INTO v_existing_id
    FROM private.practitioner_invitations pi
   WHERE pi.email_normalized = v_email
     AND pi.state IN ('pending', 'provisioned')
     AND pi.revoked_at IS NULL
     AND pi.expires_at > clock_timestamp()
   FOR UPDATE;

  v_invitation_id := public.issue_practitioner_invitation(
    p_email, p_display_name, p_expires_at, p_actor
  );

  RETURN pg_catalog.jsonb_build_object(
    'invitation_id', v_invitation_id,
    'created', v_existing_id IS NULL,
    'delivery', 'invite',
    'target_email', v_email,
    'rollback_on_failure', v_existing_id IS NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_practitioner_access_by_bound_email(
  p_email text,
  p_reason text,
  p_actor text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_invitation_id uuid;
  v_transitioned boolean := false;
BEGIN
  v_user_id := private.resolve_bound_practitioner(p_email);
  IF v_user_id IS NULL THEN
    RETURN public.revoke_practitioner_access(p_email, p_reason, p_actor);
  END IF;

  IF pg_catalog.btrim(COALESCE(p_reason, '')) = ''
     OR pg_catalog.btrim(COALESCE(p_actor, '')) = '' THEN
    RAISE EXCEPTION 'email, reason, and actor are required' USING ERRCODE = '22023';
  END IF;

  -- From this point onward, authorization is mutated by immutable Auth user id.
  -- Never translate the id back into a mutable email and then look it up again:
  -- a concurrent email change could otherwise make revocation silently target
  -- only an invitation (or nothing at all).
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );
  SELECT p.invitation_id
    INTO v_invitation_id
    FROM public.practitioners p
   WHERE p.id = v_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'practitioner record was not found' USING ERRCODE = 'P0002';
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

CREATE OR REPLACE FUNCTION public.begin_practitioner_mfa_recovery_by_bound_email(
  p_email text,
  p_reason text,
  p_actor text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_current_email text;
  v_status public.practitioner_access_status;
  v_recovery_id uuid;
  v_created_recovery boolean := false;
BEGIN
  v_user_id := private.resolve_bound_practitioner(p_email);
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth account was not found' USING ERRCODE = 'P0002';
  END IF;

  IF pg_catalog.btrim(COALESCE(p_reason, '')) = ''
     OR pg_catalog.btrim(COALESCE(p_actor, '')) = '' THEN
    RAISE EXCEPTION 'email, reason, and actor are required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  SELECT private.normalize_practitioner_email(u.email)
    INTO v_current_email
    FROM auth.users u
   WHERE u.id = v_user_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bound auth account was not found' USING ERRCODE = 'P0002';
  END IF;

  -- The identity was resolved once and remains v_user_id even if an email change
  -- is waiting on the Auth-row lock. Recovery state is never re-resolved through
  -- the mutable email address.
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
      v_user_id, v_current_email, clock_timestamp() + interval '30 minutes',
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

  -- GoTrue validates the backing session for account-management endpoints.
  -- Deleting every session in this same transaction revokes refresh tokens and
  -- makes old access JWTs unusable for getUser, password changes, and MFA factor
  -- enrollment as soon as recovery_pending becomes visible.
  DELETE FROM auth.sessions WHERE user_id = v_user_id;
  RETURN pg_catalog.jsonb_build_object('user_id', v_user_id, 'target_email', v_current_email);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_practitioner_mfa_recovery(
  p_user_id uuid,
  p_actor text
) RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ready_at timestamptz := pg_catalog.date_trunc('second', clock_timestamp()) + interval '1 second';
  v_recovery_id uuid;
BEGIN
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'actor is required' USING ERRCODE = '22023';
  END IF;

  SELECT r.id
    INTO v_recovery_id
    FROM private.practitioner_mfa_recoveries r
    JOIN public.practitioners p ON p.id = r.practitioner_id
   WHERE r.practitioner_id = p_user_id
     AND r.state = 'pending'
     AND r.expires_at > clock_timestamp()
     AND p.access_status = 'recovery_pending'
   ORDER BY r.created_at DESC
   LIMIT 1
   FOR UPDATE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pending MFA recovery was not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE private.practitioner_mfa_recoveries
     SET ready_at = v_ready_at
   WHERE id = v_recovery_id;
  UPDATE public.practitioners
     SET session_valid_after = v_ready_at,
         updated_at = clock_timestamp()
   WHERE id = p_user_id AND access_status = 'recovery_pending';

  RETURN v_ready_at;
END;
$$;

REVOKE UPDATE (session_valid_after)
  ON public.practitioners FROM anon, authenticated;

REVOKE ALL ON FUNCTION private.invalidate_sessions_for_mfa_recovery()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION private.prevent_practitioner_email_change_during_recovery()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION private.enforce_recovery_auth_transition()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION private.resolve_bound_practitioner(text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON private.practitioner_identity_bindings
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION private.is_active_aal2_practitioner()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.is_active_aal2_practitioner() TO authenticated;

REVOKE ALL ON FUNCTION public.current_practitioner_access_state()
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.current_practitioner_access_state() TO authenticated;

REVOKE ALL ON FUNCTION public.issue_practitioner_invitation_with_state(text, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_practitioner_invitation_with_state(text, text, timestamptz, text)
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.issue_practitioner_invitation(text, text, timestamptz, text)
  FROM service_role;

REVOKE ALL ON FUNCTION public.revoke_practitioner_access_by_bound_email(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_practitioner_access_by_bound_email(text, text, text)
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.revoke_practitioner_access(text, text, text)
  FROM service_role;

REVOKE ALL ON FUNCTION public.begin_practitioner_mfa_recovery_by_bound_email(text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_practitioner_mfa_recovery_by_bound_email(text, text, text)
  TO service_role;
REVOKE EXECUTE ON FUNCTION public.begin_practitioner_mfa_recovery(text, text, text)
  FROM service_role;

REVOKE ALL ON FUNCTION public.finalize_practitioner_mfa_recovery(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_practitioner_mfa_recovery(uuid, text)
  TO service_role;

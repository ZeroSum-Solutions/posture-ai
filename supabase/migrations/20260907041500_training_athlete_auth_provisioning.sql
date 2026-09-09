-- Athlete admission and actor-aware profile access. Existing practitioner
-- invitation and recovery behavior is preserved as the practitioner branch.

DO $$ BEGIN
  CREATE TYPE private.athlete_invitation_mode AS ENUM ('self_directed', 'coach_invited');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE private.athlete_invitation_state AS ENUM (
    'pending', 'provisioned', 'accepted', 'revoked', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.training_subjects
  ADD COLUMN session_valid_after timestamptz NOT NULL DEFAULT '-infinity'::timestamptz;

CREATE TABLE private.athlete_invitations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  email_normalized text NOT NULL,
  display_name text,
  mode private.athlete_invitation_mode NOT NULL,
  target_client_id uuid REFERENCES public.clients(id) ON DELETE RESTRICT,
  issuer_practitioner_id uuid REFERENCES public.practitioners(id) ON DELETE RESTRICT,
  permissions public.training_coach_permission[],
  state private.athlete_invitation_state NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  provisioned_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_id uuid UNIQUE REFERENCES public.training_subjects(id) ON DELETE SET NULL,
  provisioned_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  expired_at timestamptz,
  issued_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT athlete_invitations_email_normalized CHECK (
    email_normalized = private.normalize_practitioner_email(email_normalized)
  ),
  CONSTRAINT athlete_invitations_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT athlete_invitations_mode_shape CHECK (
    (mode = 'self_directed' AND target_client_id IS NULL
      AND issuer_practitioner_id IS NULL AND permissions IS NULL)
    OR
    (mode = 'coach_invited' AND target_client_id IS NOT NULL
      AND issuer_practitioner_id IS NOT NULL
      AND permissions IS NOT NULL
      AND pg_catalog.cardinality(permissions) > 0
      AND pg_catalog.array_position(permissions, NULL) IS NULL)
  ),
  CONSTRAINT athlete_invitations_provisioned_shape CHECK (
    state NOT IN ('provisioned','accepted')
    OR (provisioned_user_id IS NOT NULL AND subject_id IS NOT NULL AND provisioned_at IS NOT NULL)
  ),
  CONSTRAINT athlete_invitations_accepted_shape CHECK (state <> 'accepted' OR accepted_at IS NOT NULL),
  CONSTRAINT athlete_invitations_revoked_shape CHECK (state <> 'revoked' OR revoked_at IS NOT NULL),
  CONSTRAINT athlete_invitations_expired_shape CHECK (state <> 'expired' OR expired_at IS NOT NULL)
);

CREATE UNIQUE INDEX athlete_invitations_one_open_email
  ON private.athlete_invitations(email_normalized)
  WHERE state IN ('pending','provisioned');

CREATE TABLE private.athlete_access_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_id uuid REFERENCES public.training_subjects(id) ON DELETE SET NULL,
  invitation_id uuid REFERENCES private.athlete_invitations(id) ON DELETE SET NULL,
  event text NOT NULL CHECK (event IN (
    'invitation_issued','invitation_provisioned','invitation_accepted','access_revoked'
  )),
  actor text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

ALTER TABLE private.athlete_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.athlete_access_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.reject_athlete_invitation_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.email_normalized, 0)
  );
  IF NEW.state IN ('pending','provisioned')
    AND NEW.expires_at > pg_catalog.clock_timestamp()
    AND EXISTS (
      SELECT 1 FROM private.practitioner_invitations invitation
      WHERE invitation.email_normalized = NEW.email_normalized
        AND invitation.state IN ('pending','provisioned')
        AND invitation.revoked_at IS NULL
        AND invitation.expires_at > pg_catalog.clock_timestamp()
    )
  THEN
    RAISE EXCEPTION 'another invitation class is already active'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER athlete_invitation_class_guard
  BEFORE INSERT OR UPDATE OF email_normalized, state, expires_at
  ON private.athlete_invitations
  FOR EACH ROW EXECUTE FUNCTION private.reject_athlete_invitation_overlap();

CREATE OR REPLACE FUNCTION private.reject_practitioner_invitation_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.email_normalized, 0)
  );
  IF NEW.state IN ('pending','provisioned')
    AND NEW.expires_at > pg_catalog.clock_timestamp()
    AND EXISTS (
      SELECT 1 FROM private.athlete_invitations invitation
      WHERE invitation.email_normalized = NEW.email_normalized
        AND invitation.state IN ('pending','provisioned')
        AND invitation.revoked_at IS NULL
        AND invitation.expires_at > pg_catalog.clock_timestamp()
    )
  THEN
    RAISE EXCEPTION 'another invitation class is already active'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER practitioner_invitation_class_guard
  BEFORE INSERT OR UPDATE OF email_normalized, state, expires_at
  ON private.practitioner_invitations
  FOR EACH ROW EXECUTE FUNCTION private.reject_practitioner_invitation_overlap();

CREATE OR REPLACE FUNCTION public.hook_enforce_practitioner_invitation(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := private.normalize_practitioner_email(event->'user'->>'email');
  v_matches integer;
BEGIN
  SELECT
    (SELECT pg_catalog.count(*) FROM private.practitioner_invitations invitation
      WHERE invitation.email_normalized = v_email
        AND invitation.state = 'pending' AND invitation.revoked_at IS NULL
        AND invitation.expires_at > pg_catalog.clock_timestamp())
    +
    (SELECT pg_catalog.count(*) FROM private.athlete_invitations invitation
      WHERE invitation.email_normalized = v_email
        AND invitation.state = 'pending' AND invitation.revoked_at IS NULL
        AND invitation.expires_at > pg_catalog.clock_timestamp())
  INTO v_matches;
  IF v_email IS NULL OR v_matches <> 1 THEN
    RETURN pg_catalog.jsonb_build_object(
      'error', pg_catalog.jsonb_build_object(
        'http_code', 403,
        'message', 'Exactly one current application invitation is required.'
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
  v_email text := private.normalize_practitioner_email(NEW.email);
  v_practitioner private.practitioner_invitations%ROWTYPE;
  v_athlete private.athlete_invitations%ROWTYPE;
  v_subject_id uuid;
  v_matches integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 0));
  SELECT * INTO v_practitioner
  FROM private.practitioner_invitations invitation
  WHERE invitation.email_normalized = v_email
    AND invitation.state = 'pending' AND invitation.revoked_at IS NULL
    AND invitation.expires_at > pg_catalog.clock_timestamp()
  FOR UPDATE;
  SELECT * INTO v_athlete
  FROM private.athlete_invitations invitation
  WHERE invitation.email_normalized = v_email
    AND invitation.state = 'pending' AND invitation.revoked_at IS NULL
    AND invitation.expires_at > pg_catalog.clock_timestamp()
  FOR UPDATE;
  v_matches := CASE WHEN v_practitioner.id IS NULL THEN 0 ELSE 1 END
    + CASE WHEN v_athlete.id IS NULL THEN 0 ELSE 1 END;
  IF v_matches <> 1 THEN
    RAISE EXCEPTION 'exactly one current application invitation is required'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_practitioner.id IS NOT NULL THEN
    UPDATE private.practitioner_invitations
    SET state = 'provisioned', provisioned_user_id = NEW.id,
        provisioned_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_practitioner.id AND state = 'pending';
    INSERT INTO public.practitioners (
      id, display_name, role, access_status, invitation_id, created_at, updated_at
    ) VALUES (
      NEW.id,
      COALESCE(v_practitioner.display_name, NEW.raw_user_meta_data->>'full_name', NEW.email),
      'practitioner', 'invited', v_practitioner.id,
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
    );
    INSERT INTO private.practitioner_access_events (
      practitioner_id, invitation_id, event, actor
    ) VALUES (NEW.id, v_practitioner.id, 'invitation_provisioned', 'auth.users trigger');
    RETURN NEW;
  END IF;

  INSERT INTO public.training_subjects (owner_user_id, status, session_valid_after)
  VALUES (NEW.id, 'invited', '-infinity'::timestamptz)
  RETURNING id INTO v_subject_id;
  UPDATE private.athlete_invitations
  SET state = 'provisioned', provisioned_user_id = NEW.id,
      subject_id = v_subject_id, provisioned_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_athlete.id AND state = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'athlete invitation is no longer available' USING ERRCODE = '40001';
  END IF;

  IF v_athlete.mode = 'coach_invited' THEN
    PERFORM 1 FROM public.clients client
    WHERE client.id = v_athlete.target_client_id
      AND client.practitioner_id = v_athlete.issuer_practitioner_id
      AND client.deleted_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invited client is unavailable' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.client_accounts(subject_id, client_id)
    VALUES (v_subject_id, v_athlete.target_client_id);
    INSERT INTO public.coaching_relationships(
      subject_id, practitioner_id, status, permissions, started_at, revision
    ) VALUES (
      v_subject_id, v_athlete.issuer_practitioner_id, 'active',
      v_athlete.permissions, pg_catalog.clock_timestamp(), 1
    );
  END IF;
  INSERT INTO private.athlete_access_events(subject_id, invitation_id, event, actor)
  VALUES (v_subject_id, v_athlete.id, 'invitation_provisioned', 'auth.users trigger');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.issue_self_directed_athlete_invitation(
  p_email text,
  p_display_name text,
  p_expires_at timestamptz,
  p_actor text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := private.normalize_practitioner_email(p_email);
  v_id uuid;
BEGIN
  IF COALESCE(auth.jwt()->>'role','') <> 'service_role'
    OR v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    OR p_expires_at <= pg_catalog.clock_timestamp()
    OR pg_catalog.btrim(COALESCE(p_actor,'')) = ''
  THEN
    RAISE EXCEPTION 'valid service-issued invitation input is required'
      USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 0));
  IF EXISTS (
    SELECT 1 FROM auth.users user_account
    WHERE private.normalize_practitioner_email(user_account.email) = v_email
  ) THEN
    RAISE EXCEPTION 'an auth account already exists for this invitation'
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO private.athlete_invitations(
    email_normalized, display_name, mode, expires_at, issued_by
  ) VALUES (
    v_email, NULLIF(pg_catalog.btrim(p_display_name), ''), 'self_directed',
    p_expires_at, pg_catalog.btrim(p_actor)
  ) RETURNING id INTO v_id;
  INSERT INTO private.athlete_access_events(invitation_id, event, actor)
  VALUES (v_id, 'invitation_issued', pg_catalog.btrim(p_actor));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_coach_athlete_invitation(
  p_email text,
  p_target_client_id uuid,
  p_permissions public.training_coach_permission[],
  p_expires_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := private.normalize_practitioner_email(p_email);
  v_id uuid;
BEGIN
  IF NOT private.is_active_aal2_practitioner()
    OR v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    OR p_expires_at <= pg_catalog.clock_timestamp()
    OR p_permissions IS NULL
    OR pg_catalog.cardinality(p_permissions) < 1
    OR pg_catalog.array_position(p_permissions, NULL) IS NOT NULL
  THEN
    RAISE EXCEPTION 'active AAL2 coach and valid invitation input are required'
      USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 0));
  PERFORM 1 FROM public.clients client
  WHERE client.id = p_target_client_id
    AND client.practitioner_id = auth.uid()
    AND client.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.client_accounts bridge
      WHERE bridge.client_id = client.id AND bridge.status = 'active'
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'owned client requires athlete setup' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM auth.users user_account
    WHERE private.normalize_practitioner_email(user_account.email) = v_email
  ) THEN
    RAISE EXCEPTION 'an auth account already exists for this invitation'
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO private.athlete_invitations(
    email_normalized, mode, target_client_id, issuer_practitioner_id,
    permissions, expires_at, issued_by
  ) VALUES (
    v_email, 'coach_invited', p_target_client_id, auth.uid(),
    p_permissions, p_expires_at, auth.uid()::text
  ) RETURNING id INTO v_id;
  INSERT INTO private.athlete_access_events(invitation_id, event, actor)
  VALUES (v_id, 'invitation_issued', auth.uid()::text);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_application_actor()
RETURNS TABLE (
  actor_kind text,
  subject_id uuid,
  access_status text,
  role text,
  session_is_current boolean,
  invitation_mode text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_practitioner public.practitioners%ROWTYPE;
  v_subject public.training_subjects%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  SELECT * INTO v_practitioner FROM public.practitioners WHERE id = auth.uid();
  SELECT * INTO v_subject FROM public.training_subjects WHERE owner_user_id = auth.uid();
  IF v_practitioner.id IS NOT NULL AND v_subject.id IS NOT NULL THEN
    RETURN QUERY SELECT 'ambiguous', NULL::uuid, 'denied', NULL::text, false, NULL::text;
    RETURN;
  END IF;
  IF v_practitioner.id IS NOT NULL THEN
    RETURN QUERY SELECT
      'practitioner'::text,
      NULL::uuid,
      v_practitioner.access_status::text,
      v_practitioner.role,
      COALESCE(pg_catalog.to_timestamp((auth.jwt()->>'iat')::double precision)
        >= v_practitioner.session_valid_after, false),
      NULL::text;
    RETURN;
  END IF;
  IF v_subject.id IS NOT NULL THEN
    RETURN QUERY SELECT
      'athlete'::text,
      v_subject.id,
      v_subject.status::text,
      'athlete'::text,
      COALESCE(pg_catalog.to_timestamp((auth.jwt()->>'iat')::double precision)
        >= v_subject.session_valid_after, false),
      (SELECT invitation.mode::text FROM private.athlete_invitations invitation
        WHERE invitation.subject_id = v_subject.id ORDER BY invitation.created_at DESC LIMIT 1);
  END IF;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN QUERY SELECT 'ambiguous', NULL::uuid, 'denied', NULL::text, false, NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_athlete_invitation()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subject public.training_subjects%ROWTYPE;
  v_invitation private.athlete_invitations%ROWTYPE;
  v_email text;
  v_jwt_email text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 'not_invited'; END IF;
  v_jwt_email := private.normalize_practitioner_email(auth.jwt()->>'email');
  SELECT private.normalize_practitioner_email(email) INTO v_email
  FROM auth.users WHERE id = auth.uid() FOR SHARE;
  IF v_jwt_email IS NULL OR v_jwt_email <> v_email THEN RETURN 'email_mismatch'; END IF;
  SELECT * INTO v_subject FROM public.training_subjects
  WHERE owner_user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_invited'; END IF;
  IF EXISTS (SELECT 1 FROM public.practitioners WHERE id = auth.uid()) THEN
    RETURN 'ambiguous_actor';
  END IF;
  IF v_subject.status IN ('suspended','revoked') THEN RETURN 'revoked'; END IF;
  IF v_subject.status = 'active' THEN RETURN 'already_active'; END IF;
  IF COALESCE(auth.jwt()->>'aal','') <> 'aal2' THEN RETURN 'mfa_required'; END IF;
  SELECT * INTO v_invitation FROM private.athlete_invitations
  WHERE subject_id = v_subject.id AND provisioned_user_id = auth.uid()
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_invitation.email_normalized <> v_email THEN RETURN 'not_invited'; END IF;
  IF v_invitation.state = 'revoked' THEN RETURN 'revoked'; END IF;
  IF v_invitation.state = 'expired' OR v_invitation.expires_at <= pg_catalog.clock_timestamp() THEN
    UPDATE private.athlete_invitations
    SET state = 'expired', expired_at = COALESCE(expired_at, pg_catalog.clock_timestamp()),
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_invitation.id;
    RETURN 'expired';
  END IF;
  IF v_invitation.state <> 'provisioned' THEN RETURN 'not_invited'; END IF;
  UPDATE private.athlete_invitations
  SET state = 'accepted', accepted_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_invitation.id AND state = 'provisioned';
  UPDATE public.training_subjects
  SET status = 'active', activated_at = pg_catalog.clock_timestamp()
  WHERE id = v_subject.id AND status = 'invited';
  INSERT INTO private.athlete_access_events(subject_id, invitation_id, event, actor)
  VALUES (v_subject.id, v_invitation.id, 'invitation_accepted', v_email);
  RETURN 'activated';
END;
$$;

CREATE OR REPLACE FUNCTION private.is_training_subject_owner(p_subject_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((auth.jwt()->>'aal') = 'aal2', false)
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.training_subjects subject
      WHERE subject.id = p_subject_id
        AND subject.owner_user_id = auth.uid()
        AND subject.status = 'active'
        AND subject.revoked_at IS NULL
        AND subject.deleted_at IS NULL
        AND COALESCE(
          pg_catalog.to_timestamp((auth.jwt()->>'iat')::double precision)
            >= subject.session_valid_after,
          false
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.resolve_training_profile_projection(
  p_subject_id uuid,
  p_client_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subject_id uuid;
  v_client_id uuid;
  v_profile public.training_profile_revisions%ROWTYPE;
  v_permissions jsonb;
BEGIN
  IF (p_subject_id IS NULL) = (p_client_id IS NULL) THEN
    RAISE EXCEPTION 'exactly one subject or client selector is required'
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE(auth.jwt()->>'aal','') <> 'aal2' THEN
    RAISE EXCEPTION 'current AAL2 actor is required' USING ERRCODE = '42501';
  END IF;
  IF p_client_id IS NOT NULL THEN
    PERFORM 1 FROM public.clients client
    WHERE client.id = p_client_id
      AND client.practitioner_id = auth.uid()
      AND client.deleted_at IS NULL;
    IF NOT FOUND OR NOT private.is_active_aal2_practitioner() THEN
      RAISE EXCEPTION 'client profile access is not authorized' USING ERRCODE = '42501';
    END IF;
    SELECT bridge.subject_id INTO v_subject_id
    FROM public.client_accounts bridge
    WHERE bridge.client_id = p_client_id
      AND bridge.status = 'active' AND bridge.revoked_at IS NULL;
    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object(
        'status','setup_required','clientId',p_client_id
      );
    END IF;
    v_client_id := p_client_id;
  ELSE
    v_subject_id := p_subject_id;
    SELECT bridge.client_id INTO v_client_id
    FROM public.client_accounts bridge
    WHERE bridge.subject_id = v_subject_id
      AND bridge.status = 'active' AND bridge.revoked_at IS NULL;
  END IF;
  IF private.is_training_subject_owner(v_subject_id) THEN
    v_permissions := '["profile:read","profile:write","program:self_publish","session:read","set_log:write","session:complete","history:read","relationship:revoke"]'::jsonb;
  ELSIF private.is_training_subject_coach(v_subject_id, 'profile:read') THEN
    SELECT pg_catalog.to_jsonb(relationship.permissions) INTO v_permissions
    FROM public.coaching_relationships relationship
    WHERE relationship.subject_id = v_subject_id
      AND relationship.practitioner_id = auth.uid()
      AND relationship.status = 'active' AND relationship.ended_at IS NULL;
  ELSE
    RAISE EXCEPTION 'training profile access is not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT revision.* INTO v_profile
  FROM public.training_profile_revisions revision
  JOIN public.training_subjects subject
    ON subject.id = revision.subject_id
    AND subject.current_profile_revision = revision.revision
  WHERE revision.subject_id = v_subject_id;
  RETURN pg_catalog.jsonb_build_object(
    'status','ok',
    'schemaVersion','training-profile-projection.v1',
    'subjectId',v_subject_id,
    'clientId',v_client_id,
    'permissions',COALESCE(v_permissions,'[]'::jsonb),
    'current',CASE WHEN v_profile.subject_id IS NULL THEN NULL ELSE
      pg_catalog.jsonb_build_object(
        'revision',v_profile.revision,
        'profileHash',v_profile.profile_hash,
        'hashEncoding',v_profile.hash_encoding,
        'profile',v_profile.profile_json
      ) END
  );
END;
$$;

REVOKE ALL ON private.athlete_invitations, private.athlete_access_events
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON private.athlete_invitations, private.athlete_access_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE private.athlete_access_events_id_seq TO service_role;

REVOKE ALL ON FUNCTION private.reject_athlete_invitation_overlap()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.reject_practitioner_invitation_overlap()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.issue_self_directed_athlete_invitation(text,text,timestamptz,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_self_directed_athlete_invitation(text,text,timestamptz,text)
  TO service_role;
REVOKE ALL ON FUNCTION public.issue_coach_athlete_invitation(text,uuid,public.training_coach_permission[],timestamptz)
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.issue_coach_athlete_invitation(text,uuid,public.training_coach_permission[],timestamptz)
  TO authenticated;
REVOKE ALL ON FUNCTION public.current_application_actor()
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.current_application_actor() TO authenticated;
REVOKE ALL ON FUNCTION public.complete_athlete_invitation()
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.complete_athlete_invitation() TO authenticated;
REVOKE ALL ON FUNCTION public.resolve_training_profile_projection(uuid,uuid)
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.resolve_training_profile_projection(uuid,uuid)
  TO authenticated;

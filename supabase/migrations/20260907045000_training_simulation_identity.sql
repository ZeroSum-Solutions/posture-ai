-- Expiring practice identities support the original app's simulation context.
-- They never create live eligibility evidence and never share a practitioner UID.

CREATE TABLE private.training_simulation_identities (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  invitation_id uuid NOT NULL UNIQUE
    REFERENCES private.athlete_invitations(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE RESTRICT,
  practitioner_id uuid NOT NULL REFERENCES public.practitioners(id) ON DELETE RESTRICT,
  provisioned_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_id uuid UNIQUE REFERENCES public.training_subjects(id) ON DELETE SET NULL,
  simulation_run_id uuid NOT NULL UNIQUE,
  fixture_id text NOT NULL CHECK (private.is_stable_training_reference(fixture_id, 128)),
  fixture_hash text NOT NULL CHECK (fixture_hash ~ '^[a-f0-9]{64}$'),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 160 AND label ~* '(synthetic|practice)'),
  permission text NOT NULL DEFAULT 'simulation:control'
    CHECK (permission = 'simulation:control'),
  internal_email text NOT NULL UNIQUE
    CHECK (internal_email ~ '^simulation\+[a-f0-9]+@fixtures\.invalid$'),
  state text NOT NULL DEFAULT 'reserved'
    CHECK (state IN ('reserved','active','cancelled','expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  activated_at timestamptz,
  ended_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK ((state = 'active') = (activated_at IS NOT NULL AND ended_at IS NULL)),
  CHECK ((state IN ('cancelled','expired')) = (ended_at IS NOT NULL))
);

CREATE UNIQUE INDEX training_simulation_one_open_coach_fixture
  ON private.training_simulation_identities(practitioner_id, fixture_id, fixture_hash)
  WHERE state IN ('reserved','active');

ALTER TABLE private.training_simulation_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.training_simulation_identities
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.has_training_simulation_control(
  p_simulation_run_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.is_active_aal2_practitioner() AND EXISTS (
    SELECT 1
    FROM private.training_simulation_identities identity_record
    JOIN public.training_simulation_runs simulation_run
      ON simulation_run.id = identity_record.simulation_run_id
      AND simulation_run.subject_id = identity_record.subject_id
    JOIN public.training_subjects subject
      ON subject.id = identity_record.subject_id
    JOIN public.coaching_relationships relationship
      ON relationship.subject_id = identity_record.subject_id
      AND relationship.practitioner_id = identity_record.practitioner_id
    WHERE identity_record.simulation_run_id = p_simulation_run_id
      AND identity_record.practitioner_id = auth.uid()
      AND identity_record.permission = 'simulation:control'
      AND identity_record.state = 'active'
      AND identity_record.ended_at IS NULL
      AND identity_record.expires_at > pg_catalog.clock_timestamp()
      AND subject.status = 'active'
      AND subject.revoked_at IS NULL
      AND subject.deleted_at IS NULL
      AND relationship.status = 'active'
      AND relationship.ended_at IS NULL
      AND simulation_run.created_by_user_id = identity_record.practitioner_id
      AND simulation_run.fixture_id = identity_record.fixture_id
      AND simulation_run.fixture_hash = identity_record.fixture_hash
      AND simulation_run.status = 'active'
      AND simulation_run.expires_at = identity_record.expires_at
      AND simulation_run.expires_at > pg_catalog.clock_timestamp()
  );
$$;

CREATE OR REPLACE FUNCTION public.reserve_training_simulation_identity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_identity private.training_simulation_identities%ROWTYPE;
  v_id uuid := pg_catalog.gen_random_uuid();
  v_invitation_id uuid;
  v_client_id uuid;
  v_run_id uuid := pg_catalog.gen_random_uuid();
  v_email text;
  v_fixture_id constant text := 'synthetic-starter-catalog.v1';
  v_fixture_hash constant text := 'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717';
  v_label constant text := 'Practice data';
  v_expires_at timestamptz := pg_catalog.clock_timestamp() + interval '8 hours';
BEGIN
  IF NOT private.is_active_aal2_practitioner() THEN
    RAISE EXCEPTION 'active AAL2 practitioner is required' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      auth.uid()::text || ':' || v_fixture_id || ':' || v_fixture_hash,
      0
    )
  );

  SELECT * INTO v_identity
  FROM private.training_simulation_identities identity_record
  WHERE identity_record.practitioner_id = auth.uid()
    AND identity_record.fixture_id = v_fixture_id
    AND identity_record.fixture_hash = v_fixture_hash
    AND identity_record.state IN ('reserved','active')
  FOR UPDATE;

  IF FOUND AND v_identity.expires_at > pg_catalog.clock_timestamp()
    AND (
      v_identity.state = 'reserved'
      OR private.has_training_simulation_control(v_identity.simulation_run_id)
    )
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'status',v_identity.state,
      'reservationId',v_identity.id,
      'invitationId',v_identity.invitation_id,
      'clientId',v_identity.client_id,
      'subjectId',v_identity.subject_id,
      'provisionedUserId',v_identity.provisioned_user_id,
      'simulationRunId',v_identity.simulation_run_id,
      'internalEmail',v_identity.internal_email,
      'fixtureId',v_identity.fixture_id,
      'fixtureHash',v_identity.fixture_hash,
      'label',v_identity.label,
      'expiresAt',v_identity.expires_at,
      'profileRevision',CASE WHEN v_identity.state = 'active' THEN 1 ELSE NULL END
    );
  END IF;

  IF FOUND THEN
    UPDATE private.training_simulation_identities
    SET state = 'expired', ended_at = pg_catalog.clock_timestamp()
    WHERE id = v_identity.id;
    UPDATE private.athlete_invitations
    SET state = CASE WHEN state IN ('pending','provisioned') THEN 'expired' ELSE state END,
        expired_at = CASE WHEN state IN ('pending','provisioned')
          THEN pg_catalog.clock_timestamp() ELSE expired_at END,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_identity.invitation_id;
    UPDATE public.coaching_relationships
    SET status = 'revoked', ended_at = pg_catalog.clock_timestamp(), revision = revision + 1
    WHERE subject_id = v_identity.subject_id
      AND practitioner_id = v_identity.practitioner_id
      AND status = 'active' AND ended_at IS NULL;
    UPDATE public.client_accounts
    SET status = 'revoked', revoked_at = pg_catalog.clock_timestamp()
    WHERE subject_id = v_identity.subject_id AND status = 'active';
    UPDATE public.training_subjects
    SET status = 'revoked', revoked_at = pg_catalog.clock_timestamp(),
        session_valid_after = pg_catalog.clock_timestamp()
    WHERE id = v_identity.subject_id AND status IN ('invited','active');
    UPDATE public.training_simulation_runs
    SET status = 'ended'
    WHERE id = v_identity.simulation_run_id AND status = 'active';
    UPDATE public.clients
    SET archived_at = COALESCE(archived_at, pg_catalog.clock_timestamp())
    WHERE id = v_identity.client_id;
  END IF;

  v_email := 'simulation+' || pg_catalog.replace(v_id::text, '-', '')
    || '@fixtures.invalid';

  INSERT INTO public.clients(practitioner_id, first_name, last_name, notes)
  VALUES(auth.uid(), 'Practice', 'Athlete', v_label)
  RETURNING id INTO v_client_id;

  INSERT INTO private.athlete_invitations(
    email_normalized, display_name, mode, target_client_id,
    issuer_practitioner_id, permissions, expires_at, issued_by
  ) VALUES (
    v_email,
    v_label,
    'coach_invited',
    v_client_id,
    auth.uid(),
    ARRAY[
      'subject:read','profile:read','profile:write','program:coach_publish',
      'session:read','set_log:write','session:complete','history:read'
    ]::public.training_coach_permission[],
    v_expires_at,
    'private simulation reservation:' || auth.uid()::text
  ) RETURNING id INTO v_invitation_id;

  INSERT INTO private.athlete_access_events(invitation_id,event,actor)
  VALUES(
    v_invitation_id,
    'invitation_issued',
    'private simulation reservation:' || auth.uid()::text
  );

  INSERT INTO private.training_simulation_identities(
    id, invitation_id, client_id, practitioner_id, simulation_run_id,
    fixture_id, fixture_hash, label, internal_email, expires_at
  ) VALUES (
    v_id, v_invitation_id, v_client_id, auth.uid(), v_run_id,
    v_fixture_id, v_fixture_hash, v_label, v_email, v_expires_at
  );

  RETURN pg_catalog.jsonb_build_object(
    'status','reserved',
    'reservationId',v_id,
    'invitationId',v_invitation_id,
    'clientId',v_client_id,
    'subjectId',NULL,
    'provisionedUserId',NULL,
    'simulationRunId',v_run_id,
    'internalEmail',v_email,
    'fixtureId',v_fixture_id,
    'fixtureHash',v_fixture_hash,
    'label',v_label,
    'expiresAt',v_expires_at,
    'profileRevision',NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_training_simulation_identity(
  p_reservation_id uuid,
  p_reason text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_identity private.training_simulation_identities%ROWTYPE;
BEGIN
  IF COALESCE(auth.jwt()->>'role','') <> 'service_role'
    OR pg_catalog.btrim(COALESCE(p_reason,'')) = ''
  THEN
    RAISE EXCEPTION 'service role and reason are required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_identity
  FROM private.training_simulation_identities identity_record
  WHERE identity_record.id = p_reservation_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_identity.state IN ('cancelled','expired') THEN RETURN 'already_ended'; END IF;

  UPDATE private.training_simulation_identities
  SET state = 'cancelled', ended_at = pg_catalog.clock_timestamp()
  WHERE id = v_identity.id;
  UPDATE private.athlete_invitations
  SET state = CASE WHEN state IN ('pending','provisioned') THEN 'revoked' ELSE state END,
      revoked_at = CASE WHEN state IN ('pending','provisioned') THEN pg_catalog.clock_timestamp() ELSE revoked_at END,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_identity.invitation_id;
  UPDATE public.coaching_relationships
  SET status = 'revoked', ended_at = pg_catalog.clock_timestamp(), revision = revision + 1
  WHERE subject_id = v_identity.subject_id
    AND practitioner_id = v_identity.practitioner_id
    AND status = 'active' AND ended_at IS NULL;
  UPDATE public.client_accounts
  SET status = 'revoked', revoked_at = pg_catalog.clock_timestamp()
  WHERE subject_id = v_identity.subject_id AND status = 'active';
  UPDATE public.training_subjects
  SET status = 'revoked', revoked_at = pg_catalog.clock_timestamp(),
      session_valid_after = pg_catalog.clock_timestamp()
  WHERE id = v_identity.subject_id AND status IN ('invited','active');
  UPDATE public.training_simulation_runs
  SET status = 'ended'
  WHERE id = v_identity.simulation_run_id AND status = 'active';
  UPDATE public.clients
  SET archived_at = COALESCE(archived_at, pg_catalog.clock_timestamp())
  WHERE id = v_identity.client_id;
  INSERT INTO private.athlete_access_events(subject_id,invitation_id,event,actor,reason)
  VALUES(
    v_identity.subject_id,
    v_identity.invitation_id,
    'access_revoked',
    'private simulation cleanup',
    pg_catalog.btrim(p_reason)
  );
  RETURN 'cancelled';
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_training_simulation_identity(
  p_reservation_id uuid,
  p_provisioned_user_id uuid,
  p_profile_json jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_identity private.training_simulation_identities%ROWTYPE;
  v_invitation private.athlete_invitations%ROWTYPE;
  v_subject public.training_subjects%ROWTYPE;
BEGIN
  IF COALESCE(auth.jwt()->>'role','') <> 'service_role' THEN
    RAISE EXCEPTION 'service role is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_identity
  FROM private.training_simulation_identities identity_record
  WHERE identity_record.id = p_reservation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'simulation reservation was not found' USING ERRCODE = 'P0001';
  END IF;

  IF v_identity.state = 'active' THEN
    IF v_identity.provisioned_user_id <> p_provisioned_user_id THEN
      RAISE EXCEPTION 'simulation identity does not match reservation'
        USING ERRCODE = '42501';
    END IF;
    IF v_identity.expires_at <= pg_catalog.clock_timestamp()
      OR NOT EXISTS (
        SELECT 1 FROM public.training_simulation_runs simulation_run
        WHERE simulation_run.id = v_identity.simulation_run_id
          AND simulation_run.subject_id = v_identity.subject_id
          AND simulation_run.created_by_user_id = v_identity.practitioner_id
          AND simulation_run.fixture_id = v_identity.fixture_id
          AND simulation_run.fixture_hash = v_identity.fixture_hash
          AND simulation_run.status = 'active'
          AND simulation_run.expires_at = v_identity.expires_at
          AND simulation_run.expires_at > pg_catalog.clock_timestamp()
      )
    THEN
      RAISE EXCEPTION 'simulation identity is unavailable' USING ERRCODE = 'P0001';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'status','active','subjectId',v_identity.subject_id,
      'clientId',v_identity.client_id,'profileRevision',1,
      'simulationRunId',v_identity.simulation_run_id,
      'fixtureId',v_identity.fixture_id,'fixtureHash',v_identity.fixture_hash,
      'label',v_identity.label,'expiresAt',v_identity.expires_at
    );
  END IF;

  IF v_identity.state <> 'reserved'
    OR v_identity.expires_at <= pg_catalog.clock_timestamp()
  THEN
    RAISE EXCEPTION 'simulation reservation is unavailable' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_invitation
  FROM private.athlete_invitations invitation
  WHERE invitation.id = v_identity.invitation_id
  FOR UPDATE;
  IF v_invitation.state <> 'provisioned'
    OR v_invitation.provisioned_user_id <> p_provisioned_user_id
    OR v_invitation.email_normalized <> v_identity.internal_email
    OR v_invitation.target_client_id <> v_identity.client_id
    OR v_invitation.issuer_practitioner_id <> v_identity.practitioner_id
  THEN
    RAISE EXCEPTION 'provisioned auth identity does not match reservation'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_subject
  FROM public.training_subjects subject
  WHERE subject.id = v_invitation.subject_id
    AND subject.owner_user_id = p_provisioned_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_subject.status <> 'invited'
    OR EXISTS (SELECT 1 FROM public.practitioners WHERE id = p_provisioned_user_id)
  THEN
    RAISE EXCEPTION 'distinct invited athlete identity is required'
      USING ERRCODE = '42501';
  END IF;

  IF private.is_valid_training_profile(p_profile_json) IS DISTINCT FROM true
    OR p_profile_json#>>'{origin,kind}' <> 'synthetic_fixture'
    OR p_profile_json#>>'{origin,fixtureId}' <> 'practice-strength-profile.v1'
    OR p_profile_json#>>'{origin,label}' <> 'Synthetic practice profile'
  THEN
    RAISE EXCEPTION 'profile does not match the reserved synthetic fixture'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.training_profile_revisions(
    subject_id,revision,schema_version,profile_json,profile_hash,hash_encoding,
    created_by_user_id
  ) VALUES (
    v_subject.id,1,p_profile_json->>'schemaVersion',p_profile_json,
    private.training_evidence_sha256(p_profile_json),
    'postgres-jsonb-text-utf8.v1',p_provisioned_user_id
  );

  UPDATE public.training_subjects
  SET status = 'active', activated_at = pg_catalog.clock_timestamp(),
      current_profile_revision = 1
  WHERE id = v_subject.id AND status = 'invited';

  UPDATE private.athlete_invitations
  SET state = 'accepted', accepted_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_invitation.id AND state = 'provisioned';

  INSERT INTO public.training_simulation_runs(
    id,subject_id,created_by_user_id,fixture_id,fixture_hash,status,expires_at
  ) VALUES (
    v_identity.simulation_run_id,v_subject.id,v_identity.practitioner_id,
    v_identity.fixture_id,v_identity.fixture_hash,'active',v_identity.expires_at
  );

  UPDATE private.training_simulation_identities
  SET state = 'active', provisioned_user_id = p_provisioned_user_id,
      subject_id = v_subject.id, activated_at = pg_catalog.clock_timestamp()
  WHERE id = v_identity.id AND state = 'reserved';

  INSERT INTO private.athlete_access_events(subject_id,invitation_id,event,actor)
  VALUES(v_subject.id,v_invitation.id,'invitation_accepted','private simulation activation');

  RETURN pg_catalog.jsonb_build_object(
    'status','active','subjectId',v_subject.id,'clientId',v_identity.client_id,
    'profileRevision',1,'simulationRunId',v_identity.simulation_run_id,
    'fixtureId',v_identity.fixture_id,'fixtureHash',v_identity.fixture_hash,
    'label',v_identity.label,'expiresAt',v_identity.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_training_program_build_source(
  p_subject_id uuid,
  p_profile_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_current_profile_revision bigint;
  v_source jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_subject_id IS NULL OR p_profile_revision IS NULL THEN
    RAISE EXCEPTION 'authenticated subject and profile revision are required'
      USING ERRCODE = '42501';
  END IF;

  SELECT subject.current_profile_revision
  INTO v_current_profile_revision
  FROM public.training_subjects subject
  WHERE subject.id = p_subject_id
    AND subject.status = 'active'
    AND subject.revoked_at IS NULL
    AND subject.deleted_at IS NULL
    AND (
      private.is_training_subject_owner(subject.id)
      OR EXISTS (
        SELECT 1
        FROM private.training_simulation_identities identity_authorization
        WHERE identity_authorization.subject_id = subject.id
          AND private.has_training_simulation_control(identity_authorization.simulation_run_id)
      )
    );

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_current_profile_revision IS DISTINCT FROM p_profile_revision THEN
    RAISE EXCEPTION 'training profile changed concurrently' USING ERRCODE = '40001';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'simulationRunId',simulation_run.id,
    'subjectId',simulation_run.subject_id,
    'createdByUserId',simulation_run.created_by_user_id,
    'fixtureId',simulation_run.fixture_id,
    'fixtureHash',simulation_run.fixture_hash,
    'status',simulation_run.status,
    'createdAt',simulation_run.created_at,
    'expiresAt',simulation_run.expires_at
  )
  INTO v_source
  FROM public.training_simulation_runs simulation_run
  JOIN private.training_simulation_identities identity_record
    ON identity_record.simulation_run_id = simulation_run.id
    AND identity_record.subject_id = simulation_run.subject_id
    AND identity_record.practitioner_id = simulation_run.created_by_user_id
    AND identity_record.fixture_id = simulation_run.fixture_id
    AND identity_record.fixture_hash = simulation_run.fixture_hash
    AND identity_record.expires_at = simulation_run.expires_at
  WHERE simulation_run.subject_id = p_subject_id
    AND simulation_run.fixture_id = 'synthetic-starter-catalog.v1'
    AND simulation_run.fixture_hash = 'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717'
    AND simulation_run.status = 'active'
    AND simulation_run.expires_at > pg_catalog.clock_timestamp()
    AND identity_record.permission = 'simulation:control'
    AND identity_record.state = 'active'
    AND identity_record.ended_at IS NULL
    AND (
      private.is_training_subject_owner(p_subject_id)
      OR private.has_training_simulation_control(simulation_run.id)
    );

  RETURN v_source;
END;
$$;

REVOKE ALL ON FUNCTION private.has_training_simulation_control(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.has_training_simulation_control(uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.reserve_training_simulation_identity()
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.reserve_training_simulation_identity()
  TO authenticated;
REVOKE ALL ON FUNCTION public.resolve_training_program_build_source(uuid,bigint)
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.resolve_training_program_build_source(uuid,bigint)
  TO authenticated;
REVOKE ALL ON FUNCTION public.activate_training_simulation_identity(uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.activate_training_simulation_identity(uuid,uuid,jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION public.cancel_training_simulation_identity(uuid,text)
  FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.cancel_training_simulation_identity(uuid,text)
  TO service_role;

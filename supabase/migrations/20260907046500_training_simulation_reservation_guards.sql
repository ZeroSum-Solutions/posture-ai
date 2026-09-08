-- Close direct-RPC simulation identity amplification and permanently exclude
-- historical simulation clients from live athlete invitation admission.

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
      SELECT 1
      FROM private.training_simulation_identities simulation_identity
      WHERE simulation_identity.client_id = client.id
    )
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

  IF public.check_rate_limit(
    'training_simulation_reservation:' || auth.uid()::text,
    4,
    3600
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'training simulation reservation rate limit exceeded'
      USING ERRCODE = 'PT429';
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

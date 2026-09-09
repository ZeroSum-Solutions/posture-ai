-- Add one fixed conditioning-revision practice fixture without changing the
-- established starter/swap identities or accepting catalog provenance from callers.

CREATE OR REPLACE FUNCTION private.reserve_training_simulation_identity_for_fixture(
  p_fixture_id text,
  p_fixture_hash text,
  p_label text
)
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
  v_expires_at timestamptz := pg_catalog.clock_timestamp() + interval '8 hours';
BEGIN
  IF NOT private.is_active_aal2_practitioner() THEN
    RAISE EXCEPTION 'active AAL2 practitioner is required' USING ERRCODE = '42501';
  END IF;
  IF p_label <> 'Practice data'
    OR NOT (
      (p_fixture_id = 'synthetic-starter-catalog.v1'
        AND p_fixture_hash = 'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717')
      OR
      (p_fixture_id = 'synthetic-swap-journey-catalog.v1'
        AND p_fixture_hash = '2279f354548647f1b351f032de2b5babf40bd20c2b208071586b1c68645c7078')
      OR
      (p_fixture_id = 'synthetic-conditioning-journey-catalog.v1'
        AND p_fixture_hash = 'e304f19092b458ae87c2f05f5decd36a09b64f8503a3784a250c9b4293e8c73e')
    )
  THEN
    RAISE EXCEPTION 'unsupported training simulation fixture' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      auth.uid()::text || ':' || p_fixture_id || ':' || p_fixture_hash,
      0
    )
  );

  SELECT * INTO v_identity
  FROM private.training_simulation_identities identity_record
  WHERE identity_record.practitioner_id = auth.uid()
    AND identity_record.fixture_id = p_fixture_id
    AND identity_record.fixture_hash = p_fixture_hash
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

  -- All fixed public wrappers share the established per-practitioner quota.
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
  VALUES(auth.uid(), 'Practice', 'Athlete', p_label)
  RETURNING id INTO v_client_id;

  INSERT INTO private.athlete_invitations(
    email_normalized, display_name, mode, target_client_id,
    issuer_practitioner_id, permissions, expires_at, issued_by
  ) VALUES (
    v_email,
    p_label,
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
    p_fixture_id, p_fixture_hash, p_label, v_email, v_expires_at
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
    'fixtureId',p_fixture_id,
    'fixtureHash',p_fixture_hash,
    'label',p_label,
    'expiresAt',v_expires_at,
    'profileRevision',NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_training_simulation_identity()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.reserve_training_simulation_identity_for_fixture(
    'synthetic-starter-catalog.v1',
    'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717',
    'Practice data'
  );
$$;

CREATE OR REPLACE FUNCTION public.reserve_training_exercise_swap_simulation_identity()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.reserve_training_simulation_identity_for_fixture(
    'synthetic-swap-journey-catalog.v1',
    '2279f354548647f1b351f032de2b5babf40bd20c2b208071586b1c68645c7078',
    'Practice data'
  );
$$;

CREATE OR REPLACE FUNCTION public.reserve_training_conditioning_simulation_identity()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.reserve_training_simulation_identity_for_fixture(
    'synthetic-conditioning-journey-catalog.v1',
    'e304f19092b458ae87c2f05f5decd36a09b64f8503a3784a250c9b4293e8c73e',
    'Practice data'
  );
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
    RAISE EXCEPTION 'training profile changed concurrently' USING ERRCODE = 'PT409';
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
    AND (
      (simulation_run.fixture_id = 'synthetic-starter-catalog.v1'
        AND simulation_run.fixture_hash = 'ea848ced42813786b527296c351dc51ba2a8072a6c85ac5d2f744547de730717')
      OR
      (simulation_run.fixture_id = 'synthetic-swap-journey-catalog.v1'
        AND simulation_run.fixture_hash = '2279f354548647f1b351f032de2b5babf40bd20c2b208071586b1c68645c7078')
      OR
      (simulation_run.fixture_id = 'synthetic-conditioning-journey-catalog.v1'
        AND simulation_run.fixture_hash = 'e304f19092b458ae87c2f05f5decd36a09b64f8503a3784a250c9b4293e8c73e')
    )
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

REVOKE ALL ON FUNCTION private.reserve_training_simulation_identity_for_fixture(text,text,text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.reserve_training_simulation_identity()
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.reserve_training_simulation_identity()
  TO authenticated;
REVOKE ALL ON FUNCTION public.reserve_training_exercise_swap_simulation_identity()
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.reserve_training_exercise_swap_simulation_identity()
  TO authenticated;
REVOKE ALL ON FUNCTION public.reserve_training_conditioning_simulation_identity()
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.reserve_training_conditioning_simulation_identity()
  TO authenticated;
REVOKE ALL ON FUNCTION public.resolve_training_program_build_source(uuid,bigint)
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.resolve_training_program_build_source(uuid,bigint)
  TO authenticated;

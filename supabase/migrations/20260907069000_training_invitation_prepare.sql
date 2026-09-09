-- Request-bound preparation for coach-issued athlete invitations. Link
-- generation remains server-only and outside PostgreSQL; no link token is
-- persisted. Exact retries recover the same invitation after auth provisioning.

CREATE TABLE private.training_coach_invitation_prepare_requests (
  actor_user_id uuid NOT NULL REFERENCES public.practitioners(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  invitation_id uuid NOT NULL UNIQUE
    REFERENCES private.athlete_invitations(id) ON DELETE RESTRICT,
  target_client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  email_normalized text NOT NULL,
  permissions public.training_coach_permission[] NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (actor_user_id,request_id),
  CHECK (email_normalized = private.normalize_practitioner_email(email_normalized)),
  CHECK (pg_catalog.cardinality(permissions) > 0),
  CHECK (pg_catalog.array_position(permissions,NULL) IS NULL),
  CHECK (expires_at > created_at)
);

CREATE TRIGGER training_coach_invitation_prepare_requests_immutable
  BEFORE UPDATE OR DELETE ON private.training_coach_invitation_prepare_requests
  FOR EACH ROW EXECUTE FUNCTION private.reject_training_evidence_mutation();

ALTER TABLE private.training_coach_invitation_prepare_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.training_coach_invitation_prepare_requests
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION private.training_coach_invitation_prepare_projection(
  p_request private.training_coach_invitation_prepare_requests,
  p_invitation private.athlete_invitations
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'status',p_invitation.state::text,
    'invitationId',p_invitation.id,
    'clientId',p_request.target_client_id,
    'emailNormalized',p_request.email_normalized,
    'permissions',pg_catalog.to_jsonb(p_request.permissions),
    'expiresAt',pg_catalog.to_char(
      p_request.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ),
    'provisionedUserId',p_invitation.provisioned_user_id,
    'subjectId',p_invitation.subject_id
  );
$$;

CREATE OR REPLACE FUNCTION public.prepare_coach_athlete_invitation(
  p_request_id uuid,
  p_target_client_id uuid,
  p_email text,
  p_permissions public.training_coach_permission[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text := private.normalize_practitioner_email(p_email);
  v_permissions public.training_coach_permission[];
  v_hash text;
  v_expires_at timestamptz;
  v_invitation_id uuid;
  v_request private.training_coach_invitation_prepare_requests%ROWTYPE;
  v_invitation private.athlete_invitations%ROWTYPE;
BEGIN
  IF NOT private.is_active_aal2_practitioner()
    OR p_request_id IS NULL
    OR p_target_client_id IS NULL
    OR v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    OR p_permissions IS NULL
    OR pg_catalog.cardinality(p_permissions) < 1
    OR pg_catalog.array_position(p_permissions,NULL) IS NOT NULL
  THEN
    RAISE EXCEPTION 'active AAL2 coach and valid invitation input are required'
      USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.array_agg(permission ORDER BY permission::text)
  INTO v_permissions
  FROM (SELECT DISTINCT value AS permission FROM pg_catalog.unnest(p_permissions) value) canonical;
  IF pg_catalog.cardinality(v_permissions) IS DISTINCT FROM pg_catalog.cardinality(p_permissions) THEN
    RAISE EXCEPTION 'invitation permissions must be unique' USING ERRCODE = '22023';
  END IF;

  v_hash := private.training_evidence_sha256(pg_catalog.jsonb_build_object(
    'operation','prepare_coach_athlete_invitation.v1',
    'clientId',p_target_client_id,
    'email',v_email,
    'permissions',pg_catalog.to_jsonb(v_permissions)
  ));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor::text || ':' || p_request_id::text,0
  ));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'coach-invitation-client:' || p_target_client_id::text,0
  ));

  SELECT * INTO v_request
  FROM private.training_coach_invitation_prepare_requests request
  WHERE request.actor_user_id = v_actor AND request.request_id = p_request_id;
  IF FOUND THEN
    IF v_request.request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'invitation request ID reused with different content'
        USING ERRCODE = 'PT409';
    END IF;
    SELECT * INTO v_invitation FROM private.athlete_invitations invitation
    WHERE invitation.id = v_request.invitation_id FOR UPDATE;
    IF NOT FOUND
      OR v_invitation.issuer_practitioner_id IS DISTINCT FROM v_actor
      OR v_invitation.target_client_id IS DISTINCT FROM v_request.target_client_id
      OR v_invitation.email_normalized IS DISTINCT FROM v_request.email_normalized
      OR v_invitation.permissions IS DISTINCT FROM v_request.permissions
      OR v_invitation.expires_at IS DISTINCT FROM v_request.expires_at
      OR v_invitation.expires_at <= pg_catalog.clock_timestamp()
      OR v_invitation.state NOT IN ('pending','provisioned') THEN
      RAISE EXCEPTION 'invitation is no longer available' USING ERRCODE = 'PT409';
    END IF;

    PERFORM 1 FROM public.clients client
    WHERE client.id = v_request.target_client_id
      AND client.practitioner_id = v_actor
      AND client.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM private.training_simulation_identities identity
        WHERE identity.client_id = client.id
      )
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'owned client requires athlete setup' USING ERRCODE = 'P0001';
    END IF;

    IF v_invitation.state = 'pending' THEN
      IF EXISTS (
        SELECT 1 FROM public.client_accounts bridge
        WHERE bridge.client_id = v_request.target_client_id AND bridge.status = 'active'
      ) THEN
        RAISE EXCEPTION 'invitation client binding changed' USING ERRCODE = 'PT409';
      END IF;
    ELSE
      IF v_invitation.provisioned_user_id IS NULL OR v_invitation.subject_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM auth.users user_account
          WHERE user_account.id = v_invitation.provisioned_user_id
            AND private.normalize_practitioner_email(user_account.email) = v_request.email_normalized
        )
        OR NOT EXISTS (
          SELECT 1 FROM public.client_accounts bridge
          WHERE bridge.client_id = v_request.target_client_id
            AND bridge.subject_id = v_invitation.subject_id
            AND bridge.status = 'active'
        )
        OR NOT EXISTS (
          SELECT 1 FROM public.coaching_relationships relationship
          WHERE relationship.subject_id = v_invitation.subject_id
            AND relationship.practitioner_id = v_actor
            AND relationship.status = 'active'
            AND relationship.ended_at IS NULL
            AND relationship.permissions = v_request.permissions
        ) THEN
        RAISE EXCEPTION 'provisioned invitation binding changed' USING ERRCODE = 'PT409';
      END IF;
    END IF;
    RETURN private.training_coach_invitation_prepare_projection(v_request,v_invitation);
  END IF;

  v_expires_at := pg_catalog.clock_timestamp() + interval '7 days';
  IF EXISTS (
    SELECT 1 FROM private.athlete_invitations invitation
    WHERE invitation.target_client_id = p_target_client_id
      AND invitation.state IN ('pending','provisioned')
      AND invitation.expires_at > pg_catalog.clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'client already has an open athlete invitation'
      USING ERRCODE = 'PT409';
  END IF;
  v_invitation_id := public.issue_coach_athlete_invitation(
    v_email,p_target_client_id,v_permissions,v_expires_at
  );
  INSERT INTO private.training_coach_invitation_prepare_requests(
    actor_user_id,request_id,request_hash,invitation_id,target_client_id,
    email_normalized,permissions,expires_at
  ) VALUES (
    v_actor,p_request_id,v_hash,v_invitation_id,p_target_client_id,
    v_email,v_permissions,v_expires_at
  ) RETURNING * INTO v_request;
  SELECT * INTO STRICT v_invitation FROM private.athlete_invitations
  WHERE id = v_invitation_id;
  RETURN private.training_coach_invitation_prepare_projection(v_request,v_invitation);
END;
$$;

REVOKE ALL ON FUNCTION private.training_coach_invitation_prepare_projection(
  private.training_coach_invitation_prepare_requests,private.athlete_invitations
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.prepare_coach_athlete_invitation(
  uuid,uuid,text,public.training_coach_permission[]
) FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.prepare_coach_athlete_invitation(
  uuid,uuid,text,public.training_coach_permission[]
) TO authenticated;

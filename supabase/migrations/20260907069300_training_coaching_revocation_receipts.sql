-- Bind relationship revocation, its exact offline cleanup scope, and retry
-- recovery in one transaction. The legacy revocation RPC remains unchanged.

CREATE OR REPLACE FUNCTION private.is_valid_training_session_id_array(p_ids text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_ids IS NOT NULL
    AND pg_catalog.array_position(p_ids, NULL) IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(p_ids) AS item(id)
      WHERE NOT private.is_stable_training_reference(item.id, 128)
    )
    AND pg_catalog.cardinality(p_ids) = (
      SELECT pg_catalog.count(DISTINCT item.id)::integer
      FROM pg_catalog.unnest(p_ids) AS item(id)
    );
$$;

CREATE TABLE private.training_coaching_relationship_revocation_receipts (
  request_id uuid PRIMARY KEY,
  relationship_id uuid NOT NULL UNIQUE
    REFERENCES public.coaching_relationships(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL
    REFERENCES public.training_subjects(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_kind text NOT NULL CHECK (actor_kind IN ('athlete','coach')),
  client_id uuid,
  expected_revision bigint NOT NULL CHECK (expected_revision > 0),
  revoked_revision bigint NOT NULL CHECK (revoked_revision = expected_revision + 1),
  affected_session_ids text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT training_coaching_revocation_receipt_sessions_valid CHECK (
    private.is_valid_training_session_id_array(affected_session_ids)
  ),
  CONSTRAINT training_coaching_revocation_receipt_actor_shape CHECK (
    actor_kind = 'coach' OR client_id IS NULL
  )
);

CREATE OR REPLACE FUNCTION private.can_replay_training_coaching_revocation(
  p_subject_id uuid,
  p_actor_kind text,
  p_actor_user_id uuid,
  p_client_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() = p_actor_user_id
    AND COALESCE(auth.jwt()->>'aal', '') = 'aal2'
    AND EXISTS (
      SELECT 1
      FROM public.training_subjects subject
      WHERE subject.id = p_subject_id
        AND subject.status = 'active'
        AND subject.revoked_at IS NULL
        AND subject.deleted_at IS NULL
    )
    AND (
      (
        p_actor_kind = 'athlete'
        AND EXISTS (
          SELECT 1
          FROM public.training_subjects subject
          WHERE subject.id = p_subject_id
            AND subject.owner_user_id = auth.uid()
        )
      )
      OR (
        p_actor_kind = 'coach'
        AND private.is_active_aal2_practitioner()
        AND (
          p_client_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.client_accounts account
            JOIN public.clients client ON client.id = account.client_id
            WHERE account.subject_id = p_subject_id
              AND account.client_id = p_client_id
              AND account.status = 'active'
              AND account.revoked_at IS NULL
              AND client.practitioner_id = auth.uid()
              AND client.deleted_at IS NULL
          )
        )
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.revoke_training_coaching_relationship_transactional(
  p_request_id uuid,
  p_relationship_id uuid,
  p_expected_revision bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt private.training_coaching_relationship_revocation_receipts%ROWTYPE;
  v_relationship public.coaching_relationships%ROWTYPE;
  v_subject public.training_subjects%ROWTYPE;
  v_actor_kind text;
  v_client_id uuid;
  v_status public.training_coaching_relationship_status;
  v_revision bigint;
  v_affected_session_ids text[];
BEGIN
  IF auth.uid() IS NULL OR COALESCE(auth.jwt()->>'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'current AAL2 user is required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_relationship_id IS NULL
    OR p_expected_revision IS NULL OR p_expected_revision <= 0
  THEN
    RAISE EXCEPTION 'valid relationship revocation input is required' USING ERRCODE = '22023';
  END IF;

  SELECT receipt.* INTO v_receipt
  FROM private.training_coaching_relationship_revocation_receipts receipt
  WHERE receipt.request_id = p_request_id
  FOR UPDATE;

  IF FOUND THEN
    IF NOT private.can_replay_training_coaching_revocation(
      v_receipt.subject_id,
      v_receipt.actor_kind,
      v_receipt.actor_user_id,
      v_receipt.client_id
    ) THEN
      RAISE EXCEPTION 'relationship revocation is not authorized'
        USING ERRCODE = '42501';
    END IF;
    IF v_receipt.relationship_id <> p_relationship_id
      OR v_receipt.expected_revision <> p_expected_revision
    THEN
      RAISE EXCEPTION 'training relationship revocation request conflict'
        USING ERRCODE = 'PT409';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion','training-coaching-relationship-revocation.v1',
      'requestId',v_receipt.request_id,
      'relationshipId',v_receipt.relationship_id,
      'subjectId',v_receipt.subject_id,
      'status','revoked',
      'revision',v_receipt.revoked_revision,
      'affectedSessionIds',pg_catalog.to_jsonb(v_receipt.affected_session_ids)
    );
  END IF;

  SELECT relationship.* INTO v_relationship
  FROM public.coaching_relationships relationship
  WHERE relationship.id = p_relationship_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'coaching relationship is unavailable' USING ERRCODE = 'P0001';
  END IF;

  -- A concurrent identical call may have waited on the relationship lock after
  -- its first receipt lookup. Recover that committed receipt before inspecting
  -- the now-revoked relationship state.
  SELECT receipt.* INTO v_receipt
  FROM private.training_coaching_relationship_revocation_receipts receipt
  WHERE receipt.relationship_id = p_relationship_id
  FOR UPDATE;

  IF FOUND THEN
    IF NOT private.can_replay_training_coaching_revocation(
      v_receipt.subject_id,
      v_receipt.actor_kind,
      v_receipt.actor_user_id,
      v_receipt.client_id
    ) THEN
      RAISE EXCEPTION 'relationship revocation is not authorized'
        USING ERRCODE = '42501';
    END IF;
    IF v_receipt.request_id <> p_request_id
      OR v_receipt.expected_revision <> p_expected_revision
    THEN
      RAISE EXCEPTION 'training relationship revocation request conflict'
        USING ERRCODE = 'PT409';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion','training-coaching-relationship-revocation.v1',
      'requestId',v_receipt.request_id,
      'relationshipId',v_receipt.relationship_id,
      'subjectId',v_receipt.subject_id,
      'status','revoked',
      'revision',v_receipt.revoked_revision,
      'affectedSessionIds',pg_catalog.to_jsonb(v_receipt.affected_session_ids)
    );
  END IF;

  IF v_relationship.status <> 'active' OR v_relationship.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'coaching relationship is unavailable' USING ERRCODE = 'P0001';
  END IF;

  SELECT subject.* INTO v_subject
  FROM public.training_subjects subject
  WHERE subject.id = v_relationship.subject_id
  FOR UPDATE;

  IF NOT FOUND OR v_subject.status <> 'active'
    OR v_subject.revoked_at IS NOT NULL OR v_subject.deleted_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'training subject is unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF v_subject.owner_user_id = auth.uid() THEN
    v_actor_kind := 'athlete';
  ELSIF v_relationship.practitioner_id = auth.uid()
    AND private.is_training_subject_coach(
      v_relationship.subject_id,
      'relationship:revoke'
    )
  THEN
    v_actor_kind := 'coach';
    SELECT account.client_id INTO v_client_id
    FROM public.client_accounts account
    JOIN public.clients client ON client.id = account.client_id
    WHERE account.subject_id = v_relationship.subject_id
      AND account.status = 'active'
      AND account.revoked_at IS NULL
      AND client.practitioner_id = auth.uid()
      AND client.deleted_at IS NULL;
  ELSE
    RAISE EXCEPTION 'relationship revocation is not authorized'
      USING ERRCODE = '42501';
  END IF;

  IF v_relationship.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'coaching relationship changed concurrently'
      USING ERRCODE = 'PT409';
  END IF;

  -- Preserve the session -> assignment lock order used by session writers.
  -- The relationship row lock serializes new coach-assigned publications.
  PERFORM 1
  FROM public.training_sessions session
  JOIN public.training_program_assignments assignment
    ON assignment.id = session.assignment_id
  WHERE assignment.subject_id = v_relationship.subject_id
    AND assignment.program_mode = 'coach_assigned'
    AND assignment.owning_practitioner_id = v_relationship.practitioner_id
    AND assignment.status = 'active'
  ORDER BY session.id
  FOR UPDATE OF session;

  PERFORM 1
  FROM public.training_program_assignments assignment
  WHERE assignment.subject_id = v_relationship.subject_id
    AND assignment.program_mode = 'coach_assigned'
    AND assignment.owning_practitioner_id = v_relationship.practitioner_id
    AND assignment.status = 'active'
  ORDER BY assignment.id
  FOR UPDATE OF assignment;

  -- Re-read after assignment locks so a session insert that began before those
  -- locks is either committed and included or loses serialization and retries.
  SELECT COALESCE(
    pg_catalog.array_agg(session.id ORDER BY session.id),
    ARRAY[]::text[]
  ) INTO v_affected_session_ids
  FROM public.training_sessions session
  JOIN public.training_program_assignments assignment
    ON assignment.id = session.assignment_id
  WHERE assignment.subject_id = v_relationship.subject_id
    AND assignment.program_mode = 'coach_assigned'
    AND assignment.owning_practitioner_id = v_relationship.practitioner_id
    AND assignment.status = 'active';

  SELECT revoked.status, revoked.revision
  INTO v_status, v_revision
  FROM public.revoke_training_coaching_relationship(
    p_relationship_id,
    p_expected_revision
  ) AS revoked;

  IF v_status <> 'revoked' OR v_revision <> p_expected_revision + 1 THEN
    RAISE EXCEPTION 'coaching relationship revocation receipt is unavailable'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO private.training_coaching_relationship_revocation_receipts (
    request_id,relationship_id,subject_id,actor_user_id,actor_kind,client_id,
    expected_revision,revoked_revision,affected_session_ids
  ) VALUES (
    p_request_id,p_relationship_id,v_relationship.subject_id,auth.uid(),v_actor_kind,
    v_client_id,p_expected_revision,v_revision,v_affected_session_ids
  );

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion','training-coaching-relationship-revocation.v1',
    'requestId',p_request_id,
    'relationshipId',p_relationship_id,
    'subjectId',v_relationship.subject_id,
    'status','revoked',
    'revision',v_revision,
    'affectedSessionIds',pg_catalog.to_jsonb(v_affected_session_ids)
  );
END;
$$;

REVOKE ALL ON TABLE private.training_coaching_relationship_revocation_receipts
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.is_valid_training_session_id_array(text[]),
  private.can_replay_training_coaching_revocation(uuid,text,uuid,uuid),
  public.revoke_training_coaching_relationship_transactional(uuid,uuid,bigint)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.revoke_training_coaching_relationship_transactional(uuid,uuid,bigint)
  TO authenticated;

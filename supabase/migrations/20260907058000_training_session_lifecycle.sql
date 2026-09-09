-- Preserve completed training history while making stale sessions and ended
-- coaching authority explicit at every future-write boundary.

CREATE OR REPLACE FUNCTION private.is_training_session_stale(
  p_started_at timestamptz,
  p_now timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_started_at IS NOT NULL
    AND p_now IS NOT NULL
    AND p_now >= p_started_at
    AND p_now - p_started_at > pg_catalog.make_interval(hours => 24);
$$;

CREATE OR REPLACE FUNCTION private.training_session_lifecycle_denial(
  p_session_id text,
  p_actor_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.training_sessions%ROWTYPE;
  v_assignment public.training_program_assignments%ROWTYPE;
  v_is_participant boolean;
  v_relationship_revoked boolean;
  v_run_available boolean;
BEGIN
  SELECT * INTO v_session
  FROM public.training_sessions
  WHERE id = p_session_id;
  IF NOT FOUND OR p_actor_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_assignment
  FROM public.training_program_assignments
  WHERE id = v_session.assignment_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_is_participant := private.is_training_subject_owner(v_session.subject_id)
    OR v_assignment.owning_practitioner_id = p_actor_user_id;
  IF NOT COALESCE(v_is_participant, false) THEN
    RETURN NULL;
  END IF;

  IF v_assignment.program_mode = 'coach_assigned' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.coaching_relationships relationship
      WHERE relationship.subject_id = v_session.subject_id
        AND relationship.practitioner_id = v_assignment.owning_practitioner_id
        AND relationship.status = 'revoked'
        AND relationship.ended_at IS NOT NULL
    ) INTO v_relationship_revoked;
    IF v_relationship_revoked THEN
      RETURN 'relationship_revoked';
    END IF;
  END IF;

  IF v_assignment.status = 'ended' THEN
    RETURN 'assignment_expired';
  END IF;

  IF v_assignment.simulation_run_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.training_simulation_runs run
      WHERE run.id = v_assignment.simulation_run_id
        AND run.subject_id = v_assignment.subject_id
        AND run.status = 'active'
        AND run.expires_at > pg_catalog.clock_timestamp()
    ) INTO v_run_available;
    IF NOT v_run_available THEN
      RETURN 'assignment_expired';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_training_session_lifecycle_denial(
  p_session_id text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2' THEN
    RETURN NULL;
  END IF;
  RETURN private.training_session_lifecycle_denial(p_session_id, auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION private.require_active_coaching_relationship_for_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_relationship_id uuid;
BEGIN
  IF NEW.program_mode <> 'coach_assigned' OR NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  SELECT relationship.id INTO v_relationship_id
  FROM public.coaching_relationships relationship
  WHERE relationship.subject_id = NEW.subject_id
    AND relationship.practitioner_id = NEW.owning_practitioner_id
    AND relationship.status = 'active'
    AND relationship.ended_at IS NULL
    AND 'program:coach_publish' = ANY(relationship.permissions::text[])
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'training relationship revoked' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER training_assignment_active_coaching_relationship
  BEFORE INSERT ON public.training_program_assignments
  FOR EACH ROW EXECUTE FUNCTION private.require_active_coaching_relationship_for_assignment();

CREATE OR REPLACE FUNCTION private.end_training_assignments_after_coach_revocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status = 'revoked' THEN
    -- Session writers lock session, then assignment. Take the same locks in the
    -- same order so the revocation and any in-flight write have one clear winner.
    PERFORM 1
    FROM public.training_sessions session
    JOIN public.training_program_assignments assignment
      ON assignment.id = session.assignment_id
    WHERE assignment.subject_id = NEW.subject_id
      AND assignment.program_mode = 'coach_assigned'
      AND assignment.owning_practitioner_id = NEW.practitioner_id
      AND assignment.status = 'active'
    ORDER BY session.id
    FOR UPDATE OF session;

    UPDATE public.training_program_assignments assignment
    SET status = 'ended', revision = assignment.revision + 1
    WHERE assignment.subject_id = NEW.subject_id
      AND assignment.program_mode = 'coach_assigned'
      AND assignment.owning_practitioner_id = NEW.practitioner_id
      AND assignment.status = 'active';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER coaching_relationship_end_assignments
  AFTER UPDATE OF status ON public.coaching_relationships
  FOR EACH ROW EXECUTE FUNCTION private.end_training_assignments_after_coach_revocation();

CREATE OR REPLACE FUNCTION private.enforce_training_session_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_started_at timestamptz;
  v_denial text;
BEGIN
  IF OLD.state = 'in_progress'
    AND NEW.state IN ('completed', 'completed_with_omissions')
  THEN
    v_denial := private.training_session_lifecycle_denial(NEW.id, auth.uid());
    IF v_denial = 'relationship_revoked' THEN
      RAISE EXCEPTION 'training relationship revoked' USING ERRCODE = 'P0001';
    ELSIF v_denial = 'assignment_expired' THEN
      RAISE EXCEPTION 'training assignment expired' USING ERRCODE = 'P0001';
    END IF;

    SELECT prescription.started_at INTO v_started_at
    FROM public.training_session_prescriptions prescription
    WHERE prescription.session_id = NEW.id;
    IF private.is_training_session_stale(v_started_at, pg_catalog.clock_timestamp()) THEN
      RAISE EXCEPTION 'training session is stale' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Abort remains the explicit safe close for a stale or ended session. It
  -- cannot become a qualifying completed exposure.
  RETURN NEW;
END;
$$;

CREATE TRIGGER training_session_lifecycle
  BEFORE UPDATE OF state ON public.training_sessions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_training_session_lifecycle();

REVOKE ALL ON FUNCTION private.is_training_session_stale(timestamptz, timestamptz),
  private.training_session_lifecycle_denial(text, uuid),
  private.require_active_coaching_relationship_for_assignment(),
  private.end_training_assignments_after_coach_revocation(),
  private.enforce_training_session_lifecycle()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

REVOKE ALL ON FUNCTION public.read_training_session_lifecycle_denial(text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.read_training_session_lifecycle_denial(text)
  TO authenticated;

CREATE OR REPLACE FUNCTION private.revoke_training_coaching_link(
  p_subject_id uuid,
  p_practitioner_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.coaching_relationships relationship
  SET status = 'revoked',
      ended_at = pg_catalog.clock_timestamp(),
      revision = relationship.revision + 1
  WHERE relationship.subject_id = p_subject_id
    AND relationship.practitioner_id = p_practitioner_id
    AND relationship.status = 'active'
    AND relationship.ended_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.revoke_training_coaching_on_client_erasure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subject_id uuid;
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    SELECT account.subject_id INTO v_subject_id
    FROM public.client_accounts account
    WHERE account.client_id = OLD.id
    FOR UPDATE;

    IF FOUND THEN
      PERFORM private.revoke_training_coaching_link(
        v_subject_id,
        OLD.practitioner_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER clients_end_training_coaching_on_erasure
  BEFORE UPDATE OF deleted_at ON public.clients
  FOR EACH ROW EXECUTE FUNCTION private.revoke_training_coaching_on_client_erasure();

CREATE OR REPLACE FUNCTION private.revoke_training_coaching_on_client_unlink()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_practitioner_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    NULL;
  ELSIF OLD.status = 'active' AND NEW.status = 'revoked' THEN
    NULL;
  ELSE
    RETURN NEW;
  END IF;

    SELECT client.practitioner_id INTO v_practitioner_id
    FROM public.clients client
    WHERE client.id = OLD.client_id;

    IF FOUND THEN
      PERFORM private.revoke_training_coaching_link(
        OLD.subject_id,
        v_practitioner_id
      );
    END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER client_accounts_end_training_coaching_on_unlink
  BEFORE UPDATE OF status OR DELETE ON public.client_accounts
  FOR EACH ROW EXECUTE FUNCTION private.revoke_training_coaching_on_client_unlink();

REVOKE ALL ON FUNCTION private.revoke_training_coaching_link(uuid, uuid),
  private.revoke_training_coaching_on_client_erasure(),
  private.revoke_training_coaching_on_client_unlink()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

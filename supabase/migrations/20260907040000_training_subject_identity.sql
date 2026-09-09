-- Auth-owned athlete identity foundation.
--
-- This migration intentionally does not change public.handle_new_user(), the
-- auth.users trigger, practitioner admission, or application routes. Subject
-- provisioning and invitation claim are a later coordinated auth migration.

CREATE SCHEMA IF NOT EXISTS private;

DO $$ BEGIN
  CREATE TYPE public.training_subject_status AS ENUM (
    'invited', 'active', 'suspended', 'revoked'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.client_account_status AS ENUM ('active', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.training_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.training_subject_status NOT NULL DEFAULT 'invited',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  activated_at timestamptz,
  revoked_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT training_subjects_active_shape CHECK (
    status <> 'active'
    OR (activated_at IS NOT NULL AND revoked_at IS NULL AND deleted_at IS NULL)
  ),
  CONSTRAINT training_subjects_revoked_shape CHECK (
    (status = 'revoked') = (revoked_at IS NOT NULL)
  ),
  CONSTRAINT training_subjects_deleted_shape CHECK (
    deleted_at IS NULL OR status = 'revoked'
  )
);

CREATE TABLE public.client_accounts (
  subject_id uuid PRIMARY KEY
    REFERENCES public.training_subjects(id) ON DELETE CASCADE,
  client_id uuid NOT NULL UNIQUE
    REFERENCES public.clients(id) ON DELETE CASCADE,
  status public.client_account_status NOT NULL DEFAULT 'active',
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT client_accounts_revoked_shape CHECK (
    (status = 'revoked') = (revoked_at IS NOT NULL)
  )
);

CREATE OR REPLACE FUNCTION private.is_training_subject_owner(p_subject_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    COALESCE((auth.jwt()->>'aal') = 'aal2', false)
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.training_subjects subject
      WHERE subject.id = p_subject_id
        AND subject.owner_user_id = auth.uid()
        AND subject.status = 'active'
        AND subject.revoked_at IS NULL
        AND subject.deleted_at IS NULL
    );
$$;

-- Coaching relationships are added by the next identity/profile migration.
-- Keeping this predicate fail-closed lets the SELECT policies retain their
-- final shape without granting practitioners authority before that table exists.
CREATE OR REPLACE FUNCTION private.is_training_subject_coach(
  p_subject_id uuid,
  p_permission text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT false;
$$;

ALTER TABLE public.training_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY training_subjects_read_authorized
  ON public.training_subjects
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.is_training_subject_owner(id))
    OR (SELECT private.is_training_subject_coach(id, 'subject:read'))
  );

CREATE POLICY client_accounts_read_authorized
  ON public.client_accounts
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.is_training_subject_owner(subject_id))
    OR (SELECT private.is_training_subject_coach(subject_id, 'client_link:read'))
  );

REVOKE ALL ON public.training_subjects, public.client_accounts
  FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT SELECT ON public.training_subjects, public.client_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.training_subjects, public.client_accounts
  TO service_role;

REVOKE ALL ON FUNCTION private.is_training_subject_owner(uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.is_training_subject_coach(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.is_training_subject_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_training_subject_coach(uuid, text) TO authenticated;

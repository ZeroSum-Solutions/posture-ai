-- Include reserved and historical identities without exposing private identity data.
CREATE OR REPLACE FUNCTION public.read_my_training_simulation_client_ids()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.is_active_aal2_practitioner() THEN
    RAISE EXCEPTION 'active AAL2 practitioner required' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT COALESCE(pg_catalog.jsonb_agg(identity_record.client_id ORDER BY identity_record.client_id), '[]'::jsonb)
    FROM private.training_simulation_identities identity_record
    WHERE identity_record.practitioner_id = auth.uid()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.read_my_training_simulation_client_ids()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_my_training_simulation_client_ids() TO authenticated;

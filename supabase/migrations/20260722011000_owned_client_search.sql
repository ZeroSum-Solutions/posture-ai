-- Typed, bounded client-directory search. Keeping the human-entered search text
-- as an RPC argument avoids interpolating it into PostgREST's logical-filter
-- grammar. SECURITY INVOKER preserves the caller's RLS and grants.
CREATE OR REPLACE FUNCTION public.list_owned_clients_page(
  p_search text,
  p_snapshot_at timestamptz,
  p_after_at timestamptz DEFAULT NULL,
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 51
)
RETURNS TABLE (
  id uuid,
  first_name text,
  last_name text,
  date_of_birth date,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    c.id,
    c.first_name,
    c.last_name,
    c.date_of_birth,
    c.created_at
  FROM public.clients AS c
  WHERE c.practitioner_id = (SELECT auth.uid())
    AND c.archived_at IS NULL
    AND c.deleted_at IS NULL
    AND c.created_at <= p_snapshot_at
    AND (
      p_after_at IS NULL
      OR c.created_at < p_after_at
      OR (c.created_at = p_after_at AND c.id < p_after_id)
    )
    AND (
      p_search = ''
      OR c.first_name ILIKE p_search || '%'
      OR c.last_name ILIKE p_search || '%'
      OR concat_ws(' ', c.first_name, c.last_name) ILIKE p_search || '%'
      OR concat_ws(' ', c.last_name, c.first_name) ILIKE p_search || '%'
    )
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 51)
$$;

REVOKE ALL ON FUNCTION public.list_owned_clients_page(text, timestamptz, timestamptz, uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_owned_clients_page(text, timestamptz, timestamptz, uuid, integer)
  TO authenticated;

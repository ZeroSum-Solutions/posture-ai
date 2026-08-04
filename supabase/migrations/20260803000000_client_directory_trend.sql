-- The Array client directory shows each row's latest grade, when it was scanned,
-- and the trend against the previous scan, and it filters the directory by review
-- state. Both were previously impossible: list_owned_clients_page returned only
-- name/DOB/created_at, so a trend column would have had to be faked client-side
-- from a single page of rows.
--
-- The return type changes, so the function is dropped and recreated rather than
-- replaced. SECURITY INVOKER and the empty search_path are preserved: the caller's
-- RLS is what scopes these reads, and the keyset order (created_at DESC, id DESC)
-- is unchanged so existing cursors stay valid.

DROP FUNCTION IF EXISTS public.list_owned_clients_page(text, timestamptz, timestamptz, uuid, integer);

CREATE FUNCTION public.list_owned_clients_page(
  p_search text,
  p_snapshot_at timestamptz,
  p_after_at timestamptz DEFAULT NULL,
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 51,
  p_filter text DEFAULT 'all'
)
RETURNS TABLE (
  id uuid,
  first_name text,
  last_name text,
  date_of_birth date,
  created_at timestamptz,
  last_scan_at timestamptz,
  last_assessment_id uuid,
  last_grade text,
  last_score numeric,
  previous_score numeric,
  awaiting_review boolean
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
    c.created_at,
    h.last_scan_at,
    h.last_assessment_id,
    h.last_grade,
    h.last_score,
    h.previous_score,
    h.awaiting_review
  FROM public.clients AS c
  -- Only the two most recent completed scans matter: one for the current grade,
  -- the other for the delta. LIMIT 2 keeps this bounded per row.
  LEFT JOIN LATERAL (
    SELECT
      (pg_catalog.array_agg(t.created_at ORDER BY t.created_at DESC))[1] AS last_scan_at,
      (pg_catalog.array_agg(t.id ORDER BY t.created_at DESC))[1] AS last_assessment_id,
      (pg_catalog.array_agg(t.grade ORDER BY t.created_at DESC))[1] AS last_grade,
      (pg_catalog.array_agg(t.overall_score ORDER BY t.created_at DESC))[1] AS last_score,
      (pg_catalog.array_agg(t.overall_score ORDER BY t.created_at DESC))[2] AS previous_score,
      (pg_catalog.array_agg(NOT t.practitioner_approved ORDER BY t.created_at DESC))[1] AS awaiting_review
    FROM (
      SELECT
        a.id,
        a.created_at,
        a.overall_grade::text AS grade,
        a.overall_score,
        a.practitioner_approved
      FROM public.assessments AS a
      WHERE a.client_id = c.id
        AND a.status = 'complete'
        AND a.created_at <= p_snapshot_at
      ORDER BY a.created_at DESC
      LIMIT 2
    ) AS t
  ) AS h ON TRUE
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
      OR pg_catalog.concat_ws(' ', c.first_name, c.last_name) ILIKE p_search || '%'
      OR pg_catalog.concat_ws(' ', c.last_name, c.first_name) ILIKE p_search || '%'
    )
    AND (
      p_filter IS NULL
      OR p_filter = 'all'
      -- A scan that has been scored but not signed off.
      OR (p_filter = 'needs_review' AND h.awaiting_review)
      -- Deviation score moved toward zero against the previous scan.
      OR (p_filter = 'improving' AND h.previous_score IS NOT NULL AND h.last_score < h.previous_score)
      -- No scan in six weeks, including a client who has never been scanned.
      OR (p_filter = 'overdue' AND (h.last_scan_at IS NULL OR h.last_scan_at < p_snapshot_at - INTERVAL '42 days'))
    )
  ORDER BY c.created_at DESC, c.id DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 51)
$$;

REVOKE ALL ON FUNCTION public.list_owned_clients_page(text, timestamptz, timestamptz, uuid, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_owned_clients_page(text, timestamptz, timestamptz, uuid, integer, text)
  TO authenticated;

-- Chip counts must describe the whole directory, not the page in hand: a chip
-- reading "Needs review 3" while the list holds only the first 50 clients would
-- be a half-truth. One bounded aggregate over the caller's own rows.
CREATE OR REPLACE FUNCTION public.owned_client_directory_summary()
RETURNS TABLE (
  total bigint,
  needs_review bigint,
  improving bigint,
  overdue bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH latest AS (
    SELECT
      c.id,
      h.last_scan_at,
      h.last_score,
      h.previous_score,
      h.awaiting_review
    FROM public.clients AS c
    LEFT JOIN LATERAL (
      SELECT
        (pg_catalog.array_agg(t.created_at ORDER BY t.created_at DESC))[1] AS last_scan_at,
        (pg_catalog.array_agg(t.overall_score ORDER BY t.created_at DESC))[1] AS last_score,
        (pg_catalog.array_agg(t.overall_score ORDER BY t.created_at DESC))[2] AS previous_score,
        (pg_catalog.array_agg(NOT t.practitioner_approved ORDER BY t.created_at DESC))[1] AS awaiting_review
      FROM (
        SELECT a.created_at, a.overall_score, a.practitioner_approved
        FROM public.assessments AS a
        WHERE a.client_id = c.id AND a.status = 'complete'
        ORDER BY a.created_at DESC
        LIMIT 2
      ) AS t
    ) AS h ON TRUE
    WHERE c.practitioner_id = (SELECT auth.uid())
      AND c.archived_at IS NULL
      AND c.deleted_at IS NULL
  )
  SELECT
    pg_catalog.count(*) AS total,
    pg_catalog.count(*) FILTER (WHERE latest.awaiting_review) AS needs_review,
    pg_catalog.count(*) FILTER (
      WHERE latest.previous_score IS NOT NULL AND latest.last_score < latest.previous_score
    ) AS improving,
    pg_catalog.count(*) FILTER (
      WHERE latest.last_scan_at IS NULL
        OR latest.last_scan_at < pg_catalog.clock_timestamp() - INTERVAL '42 days'
    ) AS overdue
  FROM latest
$$;

REVOKE ALL ON FUNCTION public.owned_client_directory_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owned_client_directory_summary() TO authenticated;

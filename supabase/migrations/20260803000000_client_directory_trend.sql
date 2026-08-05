-- The Array client directory shows each row's latest grade, when it was scanned,
-- and the trend against the previous scan, and it filters the directory by review
-- state. Both were previously impossible: list_owned_clients_page returned only
-- name/DOB/created_at, so a trend column would have had to be faked client-side
-- from a single page of rows.
--
-- The return type changes, so the function is dropped and recreated rather than
-- replaced. SECURITY INVOKER and the empty search_path are preserved: the caller's
-- RLS is what scopes these reads, and the client keyset order
-- (created_at DESC, id DESC) is unchanged so existing cursors stay valid.
--
-- Assessment history is ordered by (assessed_at DESC, id DESC), matching
-- assessments_complete_client_practitioner_assessed_id_idx. assessed_at is the
-- clinical event time and the column the existing history keyset is built on;
-- ordering by created_at would both miss that partial index and leave the "latest
-- scan" ambiguous whenever two rows share a timestamp.

DROP FUNCTION IF EXISTS public.list_owned_clients_page(text, timestamptz, timestamptz, uuid, integer);
DROP FUNCTION IF EXISTS public.list_owned_clients_page(text, timestamptz, timestamptz, uuid, integer, text);

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
    -- Any completed scan still unsigned puts the client in the review queue, not
    -- just the most recent one. Scoping this to the latest scan would let an older
    -- unsigned scan sit in the dashboard queue while vanishing from this filter.
    EXISTS (
      SELECT 1
      FROM public.assessments AS pending
      WHERE pending.client_id = c.id
        AND pending.status = 'complete'
        AND pending.practitioner_approved = false
        AND pending.assessed_at <= p_snapshot_at
    ) AS awaiting_review
  FROM public.clients AS c
  -- Only the two most recent completed scans matter: one for the current grade,
  -- the other for the delta. LIMIT 2 keeps this bounded per row and the ordering
  -- matches the (client_id, practitioner_id, assessed_at DESC, id DESC) index.
  LEFT JOIN LATERAL (
    SELECT
      (pg_catalog.array_agg(t.assessed_at ORDER BY t.assessed_at DESC, t.id DESC))[1] AS last_scan_at,
      (pg_catalog.array_agg(t.id ORDER BY t.assessed_at DESC, t.id DESC))[1] AS last_assessment_id,
      (pg_catalog.array_agg(t.grade ORDER BY t.assessed_at DESC, t.id DESC))[1] AS last_grade,
      (pg_catalog.array_agg(t.overall_score ORDER BY t.assessed_at DESC, t.id DESC))[1] AS last_score,
      (pg_catalog.array_agg(t.overall_score ORDER BY t.assessed_at DESC, t.id DESC))[2] AS previous_score
    FROM (
      SELECT
        a.id,
        a.assessed_at,
        a.overall_grade::text AS grade,
        a.overall_score
      FROM public.assessments AS a
      WHERE a.client_id = c.id
        AND a.status = 'complete'
        AND a.assessed_at <= p_snapshot_at
      ORDER BY a.assessed_at DESC, a.id DESC
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
      -- Scored but not signed off, matching the dashboard queue's definition.
      OR (p_filter = 'needs_review' AND EXISTS (
        SELECT 1
        FROM public.assessments AS pending
        WHERE pending.client_id = c.id
          AND pending.status = 'complete'
          AND pending.practitioner_approved = false
          AND pending.assessed_at <= p_snapshot_at
      ))
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
-- reading "Needs review 6" while the list holds only the first 50 clients would be
-- a half-truth. Takes the same snapshot as the page it labels, so a client created
-- mid-scroll cannot be counted by a chip while being unreachable through the cursor.
CREATE OR REPLACE FUNCTION public.owned_client_directory_summary(p_snapshot_at timestamptz)
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
      EXISTS (
        SELECT 1
        FROM public.assessments AS pending
        WHERE pending.client_id = c.id
          AND pending.status = 'complete'
          AND pending.practitioner_approved = false
          AND pending.assessed_at <= p_snapshot_at
      ) AS awaiting_review
    FROM public.clients AS c
    LEFT JOIN LATERAL (
      SELECT
        (pg_catalog.array_agg(t.assessed_at ORDER BY t.assessed_at DESC, t.id DESC))[1] AS last_scan_at,
        (pg_catalog.array_agg(t.overall_score ORDER BY t.assessed_at DESC, t.id DESC))[1] AS last_score,
        (pg_catalog.array_agg(t.overall_score ORDER BY t.assessed_at DESC, t.id DESC))[2] AS previous_score
      FROM (
        SELECT a.id, a.assessed_at, a.overall_score
        FROM public.assessments AS a
        WHERE a.client_id = c.id
          AND a.status = 'complete'
          AND a.assessed_at <= p_snapshot_at
        ORDER BY a.assessed_at DESC, a.id DESC
        LIMIT 2
      ) AS t
    ) AS h ON TRUE
    WHERE c.practitioner_id = (SELECT auth.uid())
      AND c.archived_at IS NULL
      AND c.deleted_at IS NULL
      AND c.created_at <= p_snapshot_at
  )
  SELECT
    pg_catalog.count(*) AS total,
    pg_catalog.count(*) FILTER (WHERE latest.awaiting_review) AS needs_review,
    pg_catalog.count(*) FILTER (
      WHERE latest.previous_score IS NOT NULL AND latest.last_score < latest.previous_score
    ) AS improving,
    pg_catalog.count(*) FILTER (
      WHERE latest.last_scan_at IS NULL
        OR latest.last_scan_at < p_snapshot_at - INTERVAL '42 days'
    ) AS overdue
  FROM latest
$$;

REVOKE ALL ON FUNCTION public.owned_client_directory_summary(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owned_client_directory_summary(timestamptz) TO authenticated;

-- Which client has gone longest without a scan. The dashboard cannot derive this
-- from a capped feed of recent assessments: a client whose last scan sits behind
-- the cap would be missed entirely and a less overdue client named in its place.
-- Clients with no scan at all are excluded — "due for a re-scan" only means
-- something once there has been a first one.
CREATE OR REPLACE FUNCTION public.owned_client_longest_since_scan(p_snapshot_at timestamptz)
RETURNS TABLE (
  id uuid,
  first_name text,
  last_name text,
  last_scan_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT c.id, c.first_name, c.last_name, h.last_scan_at
  FROM public.clients AS c
  JOIN LATERAL (
    SELECT pg_catalog.max(a.assessed_at) AS last_scan_at
    FROM public.assessments AS a
    WHERE a.client_id = c.id
      AND a.status = 'complete'
      AND a.assessed_at <= p_snapshot_at
  ) AS h ON h.last_scan_at IS NOT NULL
  WHERE c.practitioner_id = (SELECT auth.uid())
    AND c.archived_at IS NULL
    AND c.deleted_at IS NULL
    AND c.created_at <= p_snapshot_at
  ORDER BY h.last_scan_at ASC, c.id ASC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.owned_client_longest_since_scan(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owned_client_longest_since_scan(timestamptz) TO authenticated;

-- Public share-link resolver for the workout player. The client link is a real
-- PHI-access surface, so it is NOT read via a raw service-role SELECT (which a
-- future edit could widen or under-check). Instead, resolve_workout_token() is
-- the SINGLE reader: given a SHA-256 token hash it returns a minimal, redacted
-- projection IFF the link is live, and nothing otherwise. The checks + the narrow
-- projection — not "service-role only" — are what make the public path IDOR-safe.
--
-- Live means ALL of: the presented hash matches a session's session_token_hash,
-- the session is not revoked, not expired, status='active', its assessment is
-- practitioner_approved, and the client is not tombstoned (deleted_at IS NULL) —
-- so an erased client's link resolves to nothing (no residual PHI). Zero rows on
-- any failure; the route maps that to 404/410. SECURITY DEFINER so it reads past
-- the practitioner-scoped RLS (an anon caller has no auth.uid()); grant hygiene
-- below keeps it callable ONLY by the service role (the server-side route).
--
-- The projection carries the frozen program_snapshot (the workout content — no
-- client identifiers live inside it by design), estimated duration, expiry, and
-- the client's FIRST name only (minimal identifier, and the link is delivered to
-- that client). It also returns the session/practitioner/client/run ids the
-- SERVER needs to write the 'accessed' audit row and attach a public rating — the
-- routes never forward those internal ids to the client response.
CREATE OR REPLACE FUNCTION resolve_workout_token(p_token_hash text)
RETURNS TABLE (
  workout_session_id uuid,
  practitioner_id uuid,
  client_id uuid,
  session_run_id uuid,
  program_snapshot jsonb,
  estimated_duration_sec int,
  client_first_name text,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ws.id,
    ws.practitioner_id,
    ws.client_id,
    -- The run seeded at mint — the public path has no run-write route, so the
    -- single existing run is what a public rating attaches to.
    (SELECT sr.id FROM session_runs sr
      WHERE sr.workout_session_id = ws.id
      ORDER BY sr.created_at ASC
      LIMIT 1),
    ws.program_snapshot,
    ws.estimated_duration_sec,
    c.first_name,
    ws.expires_at
  FROM workout_sessions ws
  JOIN assessments a ON a.id = ws.assessment_id
  JOIN clients c ON c.id = ws.client_id
  WHERE ws.session_token_hash IS NOT NULL
    AND ws.session_token_hash = p_token_hash
    AND ws.revoked_at IS NULL
    AND ws.status = 'active'
    AND ws.expires_at IS NOT NULL
    AND ws.expires_at > now()
    AND a.practitioner_approved = true
    AND c.deleted_at IS NULL;
$$;

-- role_grants.sql ALTER DEFAULT PRIVILEGES grants EXECUTE on every new function to
-- anon + authenticated, so a bare definition would be callable straight from a
-- browser client — bypassing the server route entirely. Revoke, then re-grant to
-- the service role only (same hardening the consent RPCs use).
REVOKE ALL ON FUNCTION resolve_workout_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION resolve_workout_token(text) TO service_role;

-- Serverless-safe per-user rate limiting: a fixed-window counter in Postgres,
-- exercised through a SECURITY DEFINER function. In-memory buckets do not
-- survive serverless instances; this table is shared across all of them.
-- Service-role only: RLS enabled with no policies, function EXECUTE revoked
-- from client roles.

CREATE TABLE IF NOT EXISTS api_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INT NOT NULL DEFAULT 0
);

ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION check_rate_limit(p_key TEXT, p_limit INT, p_window_seconds INT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE allowed BOOLEAN;
BEGIN
  INSERT INTO api_rate_limits (bucket_key, window_start, request_count)
  VALUES (p_key, now(), 1)
  ON CONFLICT (bucket_key) DO UPDATE SET
    request_count = CASE
      WHEN api_rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
        THEN 1
      ELSE api_rate_limits.request_count + 1
    END,
    window_start = CASE
      WHEN api_rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
        THEN now()
      ELSE api_rate_limits.window_start
    END
  RETURNING request_count <= p_limit INTO allowed;
  RETURN allowed;
END $$;

REVOKE EXECUTE ON FUNCTION check_rate_limit(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION check_rate_limit(TEXT, INT, INT) TO service_role;

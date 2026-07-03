-- Audit hardening (additive + idempotent):
--  1. Indexes for the RLS read-own policies (practitioner_id) on the workout
--     child tables, the erasure CASCADE path (workout_sessions.client_id), and
--     the rating→run lookup.
--  2. Cross-column integrity on workout_sessions: a share token and its expiry
--     travel together, and 'revoked' requires revoked_at.
--  3. One rating per run: unique index lets the rate routes upsert
--     idempotently instead of accumulating duplicate rows on retries.
--  4. Bounds on engine-written finding stats (belt-and-braces; the engine
--     already clamps).

CREATE INDEX IF NOT EXISTS idx_workout_sessions_client ON workout_sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_session_runs_practitioner ON session_runs(practitioner_id);
CREATE INDEX IF NOT EXISTS idx_workout_ratings_practitioner ON workout_ratings(practitioner_id);
CREATE INDEX IF NOT EXISTS idx_workout_share_events_practitioner ON workout_share_events(practitioner_id);

DO $$ BEGIN
  ALTER TABLE workout_sessions ADD CONSTRAINT workout_sessions_share_fields_paired
    CHECK ((session_token_hash IS NULL) = (expires_at IS NULL));
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE workout_sessions ADD CONSTRAINT workout_sessions_revoked_needs_timestamp
    CHECK (status <> 'revoked' OR revoked_at IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workout_ratings_one_per_run ON workout_ratings(session_run_id);

DO $$ BEGIN
  ALTER TABLE assessment_findings ADD CONSTRAINT assessment_findings_severity_bounds
    CHECK (severity_pct IS NULL OR (severity_pct >= 0 AND severity_pct <= 100));
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE assessment_findings ADD CONSTRAINT assessment_findings_confidence_bounds
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
EXCEPTION WHEN duplicate_object THEN null; END $$;

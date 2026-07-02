-- Workout player persistence: frozen per-assessment workout snapshots, playback
-- state for resume/analytics, post-workout movement-education feedback, and an
-- audit trail for the PHI share link. Additive + idempotent.
--
-- Security posture clones 20260629100000_regulatory_hardening_v2.sql: the API
-- (service-role) is the SOLE writer — write grants are revoked from anon and
-- authenticated (role_grants.sql default privileges would otherwise hand every
-- new table full CRUD), practitioners get SELECT scoped to their own rows via
-- RLS, JSONB columns carry a no-image-bytes CHECK, and inserts for tombstoned
-- clients are rejected by the existing reject_insert_for_deleted_client trigger.
-- Ratings are movement-education feedback ONLY (clarity/pace/difficulty) — no
-- symptom or outcome fields, keeping the non-diagnostic boundary.

-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- Frozen generated-workout snapshot per assessment. program_snapshot is the
-- immutable program the client plays back; regenerating an assessment mints a
-- new session rather than mutating this one. session_token_hash is the hash of
-- the share-link token (raw token never stored); practitioner_id is
-- denormalized for RLS, matching captures/findings/reports.
CREATE TABLE IF NOT EXISTS workout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id),
  week INT NOT NULL CHECK (week BETWEEN 1 AND 3),
  capability TEXT NOT NULL CHECK (capability IN ('regression', 'standard', 'progression')),
  program_snapshot JSONB NOT NULL,
  session_token_hash TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived', 'revoked')),
  estimated_duration_sec INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- Playback state for resume + analytics. items is a per-item progress array
-- ({slug, completed, skipped, durationMs}); updated_at is maintained by the
-- service-role writer (no auto-mutating triggers, per repo convention).
CREATE TABLE IF NOT EXISTS session_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id),
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'in_progress', 'paused', 'completed', 'abandoned')),
  current_item_index INT NOT NULL DEFAULT 0,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_duration_ms BIGINT,
  last_paused_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Post-workout feedback — movement-education quality ONLY (was it clear, paced
-- right, appropriately hard). Deliberately no symptom/pain/outcome fields.
CREATE TABLE IF NOT EXISTS workout_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_run_id UUID NOT NULL REFERENCES session_runs(id) ON DELETE CASCADE,
  workout_session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id),
  clarity INT CHECK (clarity BETWEEN 1 AND 5),
  pace TEXT CHECK (pace IN ('too_slow', 'just_right', 'too_fast')),
  difficulty TEXT CHECK (difficulty IN ('too_easy', 'just_right', 'too_hard')),
  feedback_tags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT CHECK (char_length(notes) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit trail for the PHI share link (mint/revoke/access). Append-only via
-- service role; ip_hash keeps the trail PII-minimized (no raw IPs at rest).
CREATE TABLE IF NOT EXISTS workout_share_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  practitioner_id UUID NOT NULL REFERENCES practitioners(id),
  event TEXT NOT NULL CHECK (event IN ('minted', 'revoked', 'accessed')),
  actor TEXT,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. INDEXES (session_token_hash is covered by its UNIQUE constraint)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_workout_sessions_assessment ON workout_sessions(assessment_id);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_practitioner ON workout_sessions(practitioner_id);
CREATE INDEX IF NOT EXISTS idx_session_runs_session ON session_runs(workout_session_id);
CREATE INDEX IF NOT EXISTS idx_workout_ratings_session ON workout_ratings(workout_session_id);
CREATE INDEX IF NOT EXISTS idx_workout_share_events_session ON workout_share_events(workout_session_id);

-- ============================================================================
-- 3. Defense-in-depth: reject obvious raw-image payloads smuggled into the
--    workout JSONB columns (same coarse top-level check as
--    captures_pose_frame_no_image in regulatory hardening v2 — blocks the
--    coarsest image-bytes smuggling at the DB even for a service-role write bug).
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE workout_sessions ADD CONSTRAINT workout_sessions_program_snapshot_no_image
    CHECK (
      NOT (program_snapshot ?| ARRAY['image','imageData','dataUrl','dataURL','base64','blob','bytes','png','jpeg','jpg'])
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE session_runs ADD CONSTRAINT session_runs_items_no_image
    CHECK (
      NOT (items ?| ARRAY['image','imageData','dataUrl','dataURL','base64','blob','bytes','png','jpeg','jpg'])
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================================
-- 4. RLS + POLICIES — practitioners read their own rows; NO insert/update/
--    delete policies for authenticated (service_role bypasses RLS and is the
--    sole writer, matching the regulated-tables posture from hardening v2).
-- ============================================================================
ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_share_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workout_sessions_read_own ON workout_sessions;
CREATE POLICY workout_sessions_read_own ON workout_sessions FOR SELECT
  USING (practitioner_id = (select auth.uid()));

DROP POLICY IF EXISTS session_runs_read_own ON session_runs;
CREATE POLICY session_runs_read_own ON session_runs FOR SELECT
  USING (practitioner_id = (select auth.uid()));

DROP POLICY IF EXISTS workout_ratings_read_own ON workout_ratings;
CREATE POLICY workout_ratings_read_own ON workout_ratings FOR SELECT
  USING (practitioner_id = (select auth.uid()));

DROP POLICY IF EXISTS workout_share_events_read_own ON workout_share_events;
CREATE POLICY workout_share_events_read_own ON workout_share_events FOR SELECT
  USING (practitioner_id = (select auth.uid()));

-- ============================================================================
-- 5. GRANTS — role_grants.sql default privileges give every new table full
--    CRUD for anon/authenticated; strip the writes so the API (service-role)
--    is the sole writer. SELECT is retained (RLS still scopes reads). Explicit
--    grants first so local CLI stacks (secure-by-default) match cloud.
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON workout_sessions, session_runs, workout_ratings, workout_share_events TO service_role;
GRANT SELECT ON workout_sessions, session_runs, workout_ratings, workout_share_events TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON workout_sessions, session_runs, workout_ratings, workout_share_events
  FROM anon, authenticated;

-- ============================================================================
-- 6. Reject new workout sessions for a tombstoned client (DB-enforced), so a
--    right-to-erasure can't race a concurrent mint and leave data behind a
--    successful delete. Reuses reject_insert_for_deleted_client from hardening
--    v2 (workout_sessions has a direct NOT NULL client_id, the case that
--    function covers). session_runs / workout_ratings / workout_share_events
--    need no trigger: they FK to workout_sessions, so a deleted client's
--    sessions cascade and a late child insert FK-fails — the same reasoning v2
--    documents for captures/assessment_findings.
-- ============================================================================
DROP TRIGGER IF EXISTS workout_sessions_reject_deleted_client ON workout_sessions;
CREATE TRIGGER workout_sessions_reject_deleted_client
  BEFORE INSERT ON workout_sessions
  FOR EACH ROW EXECUTE FUNCTION reject_insert_for_deleted_client();

-- ============================================================================
-- 7. COLUMN ADDITIONS for the player + capture-quality surfacing
-- ============================================================================

-- Exercise media for the player (video_url already exists in the initial schema).
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS poster_url TEXT;
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS demo_gif_url TEXT;

-- Per-finding plain-language explanation + capture-stability metrics. Nullable:
-- rows scored before this migration stay NULL (same convention as
-- metric_validity in 20260628000000).
ALTER TABLE assessment_findings ADD COLUMN IF NOT EXISTS explanation TEXT;
ALTER TABLE assessment_findings ADD COLUMN IF NOT EXISTS stability_score NUMERIC CHECK (stability_score BETWEEN 0 AND 1);
ALTER TABLE assessment_findings ADD COLUMN IF NOT EXISTS uncertainty_deg NUMERIC CHECK (uncertainty_deg >= 0);

-- Assessment-level capture stability (aggregate of the per-finding scores).
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS capture_stability NUMERIC CHECK (capture_stability BETWEEN 0 AND 1);

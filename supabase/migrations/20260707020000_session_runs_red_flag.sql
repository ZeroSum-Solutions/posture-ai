-- Plan 2 §5.4: record the pre-session red-flag acknowledgement on the run.
-- Nullable; existing/older runs stay NULL (screen not shown = no record).
ALTER TABLE session_runs
  ADD COLUMN IF NOT EXISTS red_flag_acknowledged BOOLEAN;

-- Capture-correctness flags (spec §4.4/§4.6). Nullable: historical
-- assessments predate tilt correction and stay NULL (= unknown).
ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS tilt_corrected BOOLEAN,
  ADD COLUMN IF NOT EXISTS level_verified BOOLEAN;

-- Per-side capture profiles + aggregate-finding observations.
-- Additive only: no view_enum change, no uniqueness change; existing rows get NULL
-- and render exactly as before (design §11.3).

-- Which anatomical side profile faced the camera; valid only on a side capture.
ALTER TABLE captures ADD COLUMN IF NOT EXISTS profile_side TEXT NULL
  CHECK (profile_side IN ('left', 'right'));

ALTER TABLE captures ADD CONSTRAINT captures_profile_side_only_side
  CHECK (profile_side IS NULL OR view = 'side');

-- Per-side observations for the sagittal metrics, as { sides: [...], drivingProfileSide }.
-- The scored columns above remain the aggregate (worst side); this is display-only.
ALTER TABLE assessment_findings ADD COLUMN IF NOT EXISTS observations jsonb NULL;

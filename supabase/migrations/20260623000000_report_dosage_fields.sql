-- Report/program data-model: dosage fields on exercises + priority/capability
-- persistence on assessments. Additive and idempotent.

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS reps_min INT,
  ADD COLUMN IF NOT EXISTS reps_max INT,
  ADD COLUMN IF NOT EXISTS dosage_type TEXT,
  ADD COLUMN IF NOT EXISTS is_integrative BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS priority_keys TEXT[],
  ADD COLUMN IF NOT EXISTS capability TEXT NOT NULL DEFAULT 'standard';

-- Backfill the original ten seed exercises to match the authored content files.
UPDATE exercises e SET
  dosage_type = v.dosage_type,
  reps_min = v.reps_min,
  reps_max = v.reps_max,
  is_integrative = v.is_integrative
FROM (VALUES
  ('chin-tucks', 'dynamic', 10, 15, false),
  ('neck-lateral-stretch', 'hold', NULL, NULL, false),
  ('thoracic-extension', 'dynamic', 8, 10, false),
  ('wall-angels', 'dynamic', 10, 15, true),
  ('doorway-pec-stretch', 'hold', NULL, NULL, false),
  ('kneeling-hip-flexor-stretch', 'hold', NULL, NULL, false),
  ('glute-bridge', 'dynamic', 10, 15, false),
  ('clamshell', 'dynamic', 10, 15, false),
  ('single-leg-balance', 'dynamic', 10, 15, false),
  ('standing-hamstring-curl', 'dynamic', 10, 15, false)
) AS v(slug, dosage_type, reps_min, reps_max, is_integrative)
WHERE e.slug = v.slug;

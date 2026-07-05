-- Engine 2.0.0 trunk_lean merge (spec §3.1). t1_tilt_backward and
-- anterior_pelvic_shift computed the identical shoulder→hip vector; new
-- assessments emit one trunk_lean finding. LEGACY ROWS ARE KEPT: stored v1.3
-- findings reference the old keys forever.

-- 1. New definition (copy the column list from the legacy t1 row; label/copy
--    text below is the canonical trunk_lean wording — screening vocabulary).
--    imbalance_definitions has NOT NULL columns beyond (key, label, region):
--    default_view is NOT NULL with no default, so the full 10-column INSERT
--    is required. Values for default_view, standard_value, unit,
--    threshold_config, tight_muscles, weak_muscles mirror the t1_tilt_backward
--    row (same spine region / same shoulder→hip vector).
INSERT INTO imbalance_definitions (key, region, label, default_view, standard_value, unit, threshold_config, causes_text, tight_muscles, weak_muscles)
VALUES ('trunk_lean', 'spine', 'Trunk Lean', 'side', 0, 'deg',
  '{"warning_start": 5, "danger_start": 15, "max_severity_dev": 30}'::jsonb,
  'The upper body leans forward or backward of the hips instead of stacking straight over them.',
  '["thoracic erector spinae", "latissimus dorsi"]'::jsonb,
  '["deep thoracic flexors", "abdominals"]'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 2. Remap muscle links. UNIQUE (muscle_slug, imbalance_key, role) means a
--    muscle linked to BOTH legacy keys with the same role would collide:
--    delete the anterior_pelvic_shift twin first (deterministic loser), then
--    remap the survivors.
DELETE FROM muscle_imbalance_links a
USING muscle_imbalance_links b
WHERE a.imbalance_key = 'anterior_pelvic_shift'
  AND b.imbalance_key = 't1_tilt_backward'
  AND a.muscle_slug = b.muscle_slug
  AND a.role = b.role;

UPDATE muscle_imbalance_links
SET imbalance_key = 'trunk_lean'
WHERE imbalance_key IN ('t1_tilt_backward', 'anterior_pelvic_shift');

-- 3. Remap exercise deviation keys and dedupe the arrays.
UPDATE exercises
SET primary_deviation_keys = (
  SELECT array_agg(DISTINCT CASE WHEN k IN ('t1_tilt_backward', 'anterior_pelvic_shift') THEN 'trunk_lean' ELSE k END)
  FROM unnest(primary_deviation_keys) AS k
)
WHERE primary_deviation_keys && ARRAY['t1_tilt_backward', 'anterior_pelvic_shift'];

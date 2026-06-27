-- Demote pelvic_axial_rotation: detach muscle inferences.
--
-- Transverse-plane rotation is not reliably recoverable from 2-view markerless
-- capture (r=0.00–0.19 vs Vicon; RMSE >7°; no validated pathology threshold).
-- The scoring engine now returns this metric as unreliable (severity 0), so its
-- muscle analysis must not surface in the results UI. Clear the denormalized
-- muscle arrays on imbalance_definitions and delete the muscle_imbalance_links
-- rows. Idempotent.

UPDATE imbalance_definitions
  SET tight_muscles = '[]'::jsonb, weak_muscles = '[]'::jsonb
  WHERE key = 'pelvic_axial_rotation';

-- Retroactively demote findings stored before this change so they can't map
-- back to reliable=true and drive a regenerated program. Historical
-- overall_score/ranks are left as the point-in-time assessment record.
UPDATE assessment_findings
  SET zone = 'unreliable', severity_pct = 0
  WHERE imbalance_key = 'pelvic_axial_rotation' AND zone IS DISTINCT FROM 'unreliable';

DELETE FROM muscle_imbalance_links WHERE imbalance_key = 'pelvic_axial_rotation';

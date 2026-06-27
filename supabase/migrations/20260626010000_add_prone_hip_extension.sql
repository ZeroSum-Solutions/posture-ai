-- Add the prone hip extension + abdominal draw-in (ADIM) exercise.
--
-- Fires the gluteus maximus while the abdominal brace keeps the lumbar erectors
-- quiet (Oh 2007 — the ~52% MVIC ADIM finding comes from prone hip extension,
-- not the glute bridge). Wired to anterior_pelvic_shift using existing muscles.
-- Idempotent.

INSERT INTO exercises (slug, name, category, primary_deviation_keys, min_zone, instructions, sets, hold_seconds, dosage_type, reps_min, reps_max, is_integrative)
VALUES (
  'prone-hip-extension',
  'Prone Hip Extension with Abdominal Brace',
  'strengthen',
  ARRAY['anterior_pelvic_shift'],
  'warning',
  'Lie face-down with a flat cushion under your hips and your forehead resting on your hands. First draw the lower belly gently up and away from the floor — an abdominal brace — and hold it there so the lower back stays quiet. Keeping that brace, squeeze one glute and lift that straight leg a few inches off the floor, leading with the heel and without arching the back or rotating the pelvis. Hold 5 seconds, lower with control, and repeat for 8-10 reps before switching sides.',
  3,
  5,
  'dynamic',
  8,
  10,
  false
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO exercise_muscles (exercise_id, muscle_slug, role, progression_level)
  SELECT e.id, 'gluteus-maximus', 'strengthen', 2 FROM exercises e
  WHERE e.slug = 'prone-hip-extension'
    AND NOT EXISTS (
      SELECT 1 FROM exercise_muscles em
      WHERE em.exercise_id = e.id AND em.muscle_slug = 'gluteus-maximus' AND em.role = 'strengthen'
    );

INSERT INTO exercise_muscles (exercise_id, muscle_slug, role, progression_level)
  SELECT e.id, 'deep-abdominals', 'strengthen', 1 FROM exercises e
  WHERE e.slug = 'prone-hip-extension'
    AND NOT EXISTS (
      SELECT 1 FROM exercise_muscles em
      WHERE em.exercise_id = e.id AND em.muscle_slug = 'deep-abdominals' AND em.role = 'strengthen'
    );

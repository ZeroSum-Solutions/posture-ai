-- Muscle-map evidence reconciliation (2026-06-27).
--
-- A PubMed + Consensus literature scan (2026-06-27) re-graded the weakest muscle
-- inferences (knee-hyperextension and promotion-candidate evidence notes):
--
-- 1) Knee hyperextension: of the four classic inferences only hamstrings -> weak
--    cleared the asymptomatic-population bar (Bascevan 2024 H/Q ratio; Ahn 2020
--    extensor:flexor ratio predicts recurvatum angle). The calf (Grade C, stroke-
--    only + direction-ambiguous), popliteus (C+, no causal recurvatum data) and
--    quadriceps (D) inferences are demoted to display-only: their muscle pages
--    keep the educational prose, but they are removed from the scored muscle map.
--
-- 2) Rectus femoris -> anterior pelvic tilt is promoted (medium; Reed & Pipe 2021
--    -1.2 deg APT after hip-flexor stretch; Nascimento 2020 review). It is the
--    one promotion candidate that survived adversarial verification — tibialis
--    posterior, VMO and vastus lateralis all failed on construct mismatch. The
--    effect cannot be isolated from the iliopsoas, so it is medium-confidence and
--    framed as part of the hip-flexor group.
--
-- Idempotent. The anterior_pelvic_shift legacy array already lists "hip flexors";
-- rectus femoris is carried granularly in muscle_imbalance_links rather than
-- duplicated into that coarse fallback array.

-- (1) Knee hyperextension scored set -> hamstrings only
UPDATE imbalance_definitions
  SET tight_muscles = '[]'::jsonb,
      weak_muscles  = '["hamstrings"]'::jsonb
  WHERE key = 'knee_extension_back_knee';

DELETE FROM muscle_imbalance_links
  WHERE imbalance_key = 'knee_extension_back_knee'
    AND muscle_slug IN ('gastrocnemius-soleus', 'popliteus', 'quadriceps');

-- (2) Rectus femoris muscle + anterior-pelvic-tilt link. DO UPDATE keeps the KB
-- row authoritative (matches the seed generator's upsert).
INSERT INTO muscles (slug, name, region, anatomy_summary, function_text, screening_notes, reviewed_by, reviewed_at)
VALUES (
  'rectus-femoris',
  'Rectus Femoris',
  'hip_pelvis',
  'The rectus femoris is the only one of the four quadriceps muscles that crosses both the hip and the knee. It runs straight down the middle of the front thigh, beginning on the front of the pelvis at the bony point just below and in front of the hip (the anterior inferior iliac spine) and joining the shared quadriceps tendon that wraps the kneecap and attaches to the top of the shinbone. Because it spans two joints, it both lifts the thigh at the hip and straightens the knee, and its length is shared between those movements — bending the knee while the hip is extended puts it on full stretch. This two-joint arrangement makes the rectus femoris a direct mechanical link between the tilt of the pelvis and the front of the thigh.',
  'The rectus femoris flexes the hip, drawing the thigh up toward the trunk, and extends the knee, contributing to kicking, stair climbing, and the forward swing of the leg in walking. Because it anchors onto the front of the pelvis, a short rectus femoris can add to a forward pelvic tilt as one of several hip flexors, deepening the low-back arch. It shares hip-flexion duty with the iliopsoas and knee-extension duty with the three deeper quadriceps heads, sitting at the crossover of the two.',
  'The rectus femoris commonly reads as short and overactive in clients who sit for long stretches or who stand with the pelvis tipped forward, since its hip attachment keeps it loaded in those positions. When shortened it can add to a forward pelvic tilt as part of the hip-flexor group, working alongside the iliopsoas rather than on its own. It may benefit from professional evaluation when the front of the hip feels persistently tight or the lower back stays arched; a kneeling or standing thigh stretch that combines hip extension with knee bending lengthens it directly.',
  NULL,
  NULL
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  region = EXCLUDED.region,
  anatomy_summary = EXCLUDED.anatomy_summary,
  function_text = EXCLUDED.function_text,
  screening_notes = EXCLUDED.screening_notes,
  updated_at = now();

INSERT INTO muscle_imbalance_links (muscle_slug, imbalance_key, role, rationale_text)
  SELECT 'rectus-femoris', 'anterior_pelvic_shift', 'tight',
    'As a two-joint muscle anchored to the front of the pelvis, a short rectus femoris can contribute, as one of the hip flexors, to a forward pelvic tilt and to the hips carrying ahead of the ankles in an anterior pelvic shift. The evidence frames it as part of the hip-flexor group rather than in isolation — easing hip-flexor tightness measurably reduces the forward tilt, but the effect is modest and cannot be pinned to the rectus femoris alone. It is therefore graded medium-confidence and addressed together with the iliopsoas.'
  WHERE NOT EXISTS (
    SELECT 1 FROM muscle_imbalance_links
    WHERE muscle_slug = 'rectus-femoris'
      AND imbalance_key = 'anterior_pelvic_shift'
      AND role = 'tight'
  );

-- Wire rectus femoris into its stretch (the kneeling hip-flexor stretch) so its
-- KB page surfaces the exercise. The muscle page reads exercise_muscles directly.
INSERT INTO exercise_muscles (exercise_id, muscle_slug, role, progression_level)
  SELECT e.id, 'rectus-femoris', 'stretch', 2 FROM exercises e
  WHERE e.slug = 'kneeling-hip-flexor-stretch'
    AND NOT EXISTS (
      SELECT 1 FROM exercise_muscles em
      WHERE em.exercise_id = e.id
        AND em.muscle_slug = 'rectus-femoris'
        AND em.role = 'stretch'
    );

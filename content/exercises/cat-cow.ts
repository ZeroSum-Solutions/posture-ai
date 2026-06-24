import type { ExerciseContent } from '../muscles/types'

// Segmental spine mobility through flexion and extension.
export const catCow: ExerciseContent = {
  slug: 'cat-cow',
  name: 'Cat-Cow',
  category: 'mobility',
  primaryDeviationKeys: ['t1_tilt_backward', 'anterior_pelvic_shift', 'forward_head_posture'],
  minZone: 'maintain',
  dosageType: 'dynamic',
  reps: { min: 8, max: 10 },
  instructions:
    'Start on hands and knees with wrists under shoulders and knees under hips. Exhale and round your spine toward the ceiling, tucking the tailbone and letting the head drop (cat). Inhale and reverse, letting the belly sink while the chest and tailbone lift (cow). Move slowly segment by segment, pausing 3 seconds at each end position. Keep the arms straight and the movement smooth. Flow through 8-10 full cycles per set.',
  sets: 2,
  holdSeconds: 3,
  muscles: [
    { muscleSlug: 'thoracic-erector-spinae', role: 'stretch', progressionLevel: 1 },
    { muscleSlug: 'lumbar-erector-spinae', role: 'stretch', progressionLevel: 1 },
  ],
}

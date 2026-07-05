import type { ExerciseContent } from '../muscles/types'

// Segmental spine mobility through flexion and extension.
export const catCow: ExerciseContent = {
  slug: 'cat-cow',
  name: 'Cat-Cow',
  category: 'mobility',
  primaryDeviationKeys: ['trunk_lean', 'forward_head_posture'],
  minZone: 'maintain',
  dosageType: 'dynamic',
  reps: { min: 8, max: 10 },
  instructions:
    'Start on hands and knees with wrists under shoulders and knees under hips. Exhale and round your spine toward the ceiling, tucking the tailbone and letting the head drop (cat). Inhale and reverse, letting the belly sink while the chest and tailbone lift (cow). Move slowly segment by segment, pausing 3 seconds at each end position. Keep the arms straight and the movement smooth. Flow through 8-10 full cycles per set.',
  sets: 2,
  holdSeconds: 3,
  steps: [
    'Set up on hands and knees, wrists stacked under shoulders and knees under hips.',
    'Exhale and round the spine upward, tucking the tailbone and dropping the head toward the floor.',
    'Inhale and reverse, letting the belly lower while the chest and tailbone lift toward the ceiling.',
    'Move segment by segment, pausing about three seconds at each end before flowing back through.',
  ],
  form: {
    alignmentCue: 'Move the spine one vertebra at a time so the wave travels smoothly from hips to head.',
    avoidCue: 'Avoid rushing the flow or bending the elbows; keep the arms straight and the pace slow.',
  },
  muscles: [
    { muscleSlug: 'thoracic-erector-spinae', role: 'stretch', progressionLevel: 1 },
    { muscleSlug: 'lumbar-erector-spinae', role: 'stretch', progressionLevel: 1 },
  ],
}

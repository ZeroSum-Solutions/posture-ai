import type { ExerciseContent } from '../muscles/types'

// Exemplar exercise file — existing seed exercise, now with muscle mappings.
// Instructions text is kept verbatim from the original seed row.
export const chinTucks: ExerciseContent = {
  slug: 'chin-tucks',
  name: 'Chin Tucks',
  category: 'strengthen',
  primaryDeviationKeys: ['forward_head_posture'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Stand or sit tall. Gently retract your chin straight back, making a double chin. Hold 5 seconds, then release. Perform 10-12 repetitions per set.',
  sets: 3,
  holdSeconds: 5,
  muscles: [
    { muscleSlug: 'deep-cervical-flexors', role: 'strengthen', progressionLevel: 2 },
  ],
}

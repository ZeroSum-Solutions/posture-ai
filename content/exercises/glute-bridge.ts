import type { ExerciseContent } from '../muscles/types'

// Seed exercise — instructions kept verbatim from the original seed row.
export const gluteBridge: ExerciseContent = {
  slug: 'glute-bridge',
  name: 'Glute Bridge',
  category: 'strengthen',
  primaryDeviationKeys: ['anterior_pelvic_shift', 'knee_extension_back_knee'],
  minZone: 'maintain',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Lie on your back with knees bent and feet flat on the floor. Squeeze your glutes and drive your hips up until your body forms a straight line from knees to shoulders. Hold 2 seconds at the top. Lower slowly. Perform 10-12 repetitions per set.',
  sets: 3,
  holdSeconds: 2,
  muscles: [
    { muscleSlug: 'gluteus-maximus', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'hamstrings', role: 'strengthen', progressionLevel: 1 },
  ],
}

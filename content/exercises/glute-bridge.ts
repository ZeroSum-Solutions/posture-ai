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
  steps: [
    'Lie on your back with knees bent and feet flat, hip-width apart.',
    'Press through your heels and lift your hips until they line up with your knees and shoulders.',
    'Squeeze your glutes at the top for a brief pause.',
    'Lower back down with control, one segment at a time.',
  ],
  form: {
    alignmentCue: 'Drive through your heels and squeeze your glutes at the top of each rep.',
    avoidCue: 'Avoid arching your lower back to lift higher than your hips can go.',
  },
  muscles: [
    { muscleSlug: 'gluteus-maximus', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'hamstrings', role: 'strengthen', progressionLevel: 1 },
  ],
}

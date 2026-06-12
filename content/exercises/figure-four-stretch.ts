import type { ExerciseContent } from '../muscles/types'

// Supine stretch for the deep hip external rotators (piriformis group).
export const figureFourStretch: ExerciseContent = {
  slug: 'figure-four-stretch',
  name: 'Supine Figure-Four Stretch',
  category: 'stretch',
  primaryDeviationKeys: ['pelvic_axial_rotation'],
  minZone: 'maintain',
  instructions:
    'Lie on your back with knees bent and feet flat. Cross one ankle over the opposite thigh, just above the knee, letting the crossed knee fall open. Reach through and clasp behind the supporting thigh, then gently pull it toward your chest until you feel a stretch deep in the buttock of the crossed leg. Keep your head and shoulders on the floor and the tailbone heavy. Hold 30 seconds, release slowly, and switch sides.',
  sets: 3,
  holdSeconds: 30,
  muscles: [
    { muscleSlug: 'deep-hip-external-rotators', role: 'stretch', progressionLevel: 2 },
    { muscleSlug: 'gluteus-medius', role: 'stretch', progressionLevel: 1 },
  ],
}

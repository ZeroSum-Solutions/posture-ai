import type { ExerciseContent } from '../muscles/types'

// Regression of the hamstring curl — lying down removes the balance demand.
export const proneHamstringCurl: ExerciseContent = {
  slug: 'prone-hamstring-curl',
  name: 'Prone Hamstring Curl',
  category: 'strengthen',
  primaryDeviationKeys: ['knee_extension_back_knee'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Lie face down on a mat with legs straight and forehead resting on your hands. Keeping the hips pressed into the floor, slowly bend one knee, bringing the heel toward your glutes over a count of two. Pause 3 seconds at the top, then lower over a count of three. Avoid lifting the hip or rocking the pelvis as the knee bends. Do 10-12 repetitions per leg; add a light ankle weight or loop band when it becomes easy.',
  sets: 3,
  holdSeconds: 3,
  steps: [
    'Lie face down with legs straight and forehead resting on your hands.',
    'Press the hips into the floor and slowly bend one knee, drawing the heel toward your glutes.',
    'Pause 3 seconds at the top, then lower over a slow count.',
    'Repeat for your reps, then repeat on the other side.',
  ],
  form: {
    alignmentCue: 'Keep both hips pinned to the floor so only the knee bends.',
    avoidCue: 'Avoid lifting the hip or rocking the pelvis as the heel rises.',
  },
  muscles: [
    { muscleSlug: 'hamstrings', role: 'strengthen', progressionLevel: 1 },
  ],
}

import type { ExerciseContent } from '../muscles/types'

// Classic standing stretch for the front of the thigh.
export const standingQuadStretch: ExerciseContent = {
  slug: 'standing-quad-stretch',
  name: 'Standing Quad Stretch',
  category: 'stretch',
  primaryDeviationKeys: ['knee_extension_back_knee'],
  minZone: 'maintain',
  instructions:
    'Stand tall holding a wall or chair with one hand for balance. Bend the opposite knee and grasp that ankle behind you, drawing the heel toward your glutes. Keep the knees close together and the pelvis tucked slightly under — avoid arching the lower back — until you feel a stretch along the front of the thigh. Keep the standing knee soft rather than locked back. Hold 20-30 seconds, release slowly, and repeat on the other side.',
  sets: 3,
  holdSeconds: 25,
  muscles: [
    { muscleSlug: 'quadriceps', role: 'stretch', progressionLevel: 2 },
  ],
}

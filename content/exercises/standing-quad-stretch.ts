import type { ExerciseContent } from '../muscles/types'

// Classic standing stretch for the front of the thigh.
export const standingQuadStretch: ExerciseContent = {
  slug: 'standing-quad-stretch',
  name: 'Standing Quad Stretch',
  category: 'informational',
  primaryDeviationKeys: ['knee_extension_back_knee'],
  minZone: 'maintain',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Stand tall holding a wall or chair with one hand for balance. Bend the opposite knee and grasp that ankle behind you, drawing the heel toward your glutes. Keep the knees close together and the pelvis tucked slightly under — avoid arching the lower back — until you feel a stretch along the front of the thigh. Keep the standing knee soft rather than locked back. Hold 30 seconds, release slowly, and repeat on the other side.',
  sets: 3,
  holdSeconds: 30,
  steps: [
    'Stand tall holding a wall or chair with one hand for balance.',
    'Bend the opposite knee and grasp that ankle behind you, drawing the heel toward your glutes.',
    'Keep the knees close together and tuck the pelvis slightly under until you feel the front-thigh stretch.',
    'Release the ankle slowly.',
    'Repeat on the other side.',
  ],
  form: {
    alignmentCue: 'Tuck your pelvis slightly and keep your knees together with the standing knee soft.',
    avoidCue: 'Avoid arching your lower back or locking the standing knee to reach the ankle.',
  },
  muscles: [
    { muscleSlug: 'quadriceps', role: 'stretch', progressionLevel: 2 },
  ],
}

import type { ExerciseContent } from '../muscles/types'

export const standingCalfRaise: ExerciseContent = {
  slug: 'standing-calf-raise',
  name: 'Standing Calf Raise',
  category: 'informational',
  primaryDeviationKeys: ['knee_extension_back_knee'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: null,
  instructions:
    'Stand tall with your feet hip-width apart. Press up onto the balls of both feet, lifting your heels as high as you comfortably can. Pause at the top, then lower your heels slowly and with control. Rest a hand on a wall for balance if you need it. Move smoothly and keep your ankles steady. Perform 12-15 repetitions per set.',
  sets: 3,
  holdSeconds: 2,
  steps: [
    'Stand tall with feet hip-width apart, resting a hand on a wall for balance if needed.',
    'Press up onto the balls of both feet, lifting your heels as high as you comfortably can.',
    'Pause briefly at the top with your ankles steady.',
    'Lower your heels slowly and with control back to the floor.',
  ],
  form: {
    alignmentCue: 'Push evenly through the balls of both feet and keep your ankles steady.',
    avoidCue: 'Avoid bouncing at the bottom or rolling your weight onto the outer edges of your feet.',
  },
  muscles: [
    { muscleSlug: 'gastrocnemius-soleus', role: 'strengthen', progressionLevel: 2 },
  ],
}

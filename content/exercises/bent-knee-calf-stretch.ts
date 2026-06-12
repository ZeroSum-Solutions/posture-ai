import type { ExerciseContent } from '../muscles/types'

// Bent-knee variation biased to the deeper soleus.
export const bentKneeCalfStretch: ExerciseContent = {
  slug: 'bent-knee-calf-stretch',
  name: 'Bent-Knee Calf Stretch',
  category: 'stretch',
  primaryDeviationKeys: ['knee_extension_back_knee', 'anterior_pelvic_shift'],
  minZone: 'maintain',
  instructions:
    'Stand facing a wall with hands on it for support. Step one foot back a half stride, keeping the heel down and toes forward. This time bend the back knee, sinking it toward the wall while the heel stays planted, until you feel the stretch move lower and deeper in the calf, toward the heel cord. Keep the trunk upright and weight even across the back foot. Hold 30 seconds, then change sides.',
  sets: 3,
  holdSeconds: 30,
  muscles: [
    { muscleSlug: 'gastrocnemius-soleus', role: 'stretch', progressionLevel: 2 },
  ],
}

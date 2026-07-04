import type { ExerciseContent } from '../muscles/types'

// Bent-knee variation biased to the deeper soleus.
export const bentKneeCalfStretch: ExerciseContent = {
  slug: 'bent-knee-calf-stretch',
  name: 'Bent-Knee Calf Stretch',
  category: 'stretch',
  primaryDeviationKeys: ['knee_extension_back_knee', 'anterior_pelvic_shift'],
  minZone: 'maintain',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Stand facing a wall with hands on it for support. Step one foot back a half stride, keeping the heel down and toes forward. This time bend the back knee, sinking it toward the wall while the heel stays planted, until you feel the stretch move lower and deeper in the calf, toward the heel cord. Keep the trunk upright and weight even across the back foot. Hold 30 seconds, then change sides.',
  sets: 3,
  holdSeconds: 30,
  steps: [
    'Stand facing a wall with both hands on it for support.',
    'Step one foot back a half stride, heel down and toes pointing forward.',
    'Bend the back knee toward the wall while the heel stays planted, feeling a lower, deeper stretch.',
    'Hold 30 seconds with the trunk upright, then repeat on the other side.',
  ],
  form: {
    alignmentCue: 'Keep the back heel planted and weight even across the foot as the knee sinks forward.',
    avoidCue: 'Avoid letting the heel lift or the trunk lean far over the front foot.',
  },
  muscles: [
    { muscleSlug: 'gastrocnemius-soleus', role: 'stretch', progressionLevel: 2 },
  ],
}

import type { ExerciseContent } from '../muscles/types'

// Straight-knee calf stretch biased to the gastrocnemius.
export const wallCalfStretch: ExerciseContent = {
  slug: 'wall-calf-stretch',
  name: 'Wall Calf Stretch (Straight Knee)',
  category: 'stretch',
  primaryDeviationKeys: ['knee_extension_back_knee', 'anterior_pelvic_shift'],
  minZone: 'maintain',
  instructions:
    'Face a wall and place both hands on it at shoulder height. Step one foot back about a full stride, keeping that heel flat on the floor and the toes pointing straight at the wall. Keep the back knee straight and lean your hips toward the wall until you feel a stretch in the upper calf of the back leg. Avoid letting the back arch or the heel lift. Hold 30 seconds while breathing slowly, then switch legs.',
  sets: 3,
  holdSeconds: 30,
  muscles: [
    { muscleSlug: 'gastrocnemius-soleus', role: 'stretch', progressionLevel: 2 },
  ],
}

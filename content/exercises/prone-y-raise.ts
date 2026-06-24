import type { ExerciseContent } from '../muscles/types'

// Progression targeting the lower trapezius — arms overhead in a Y.
export const proneYRaise: ExerciseContent = {
  slug: 'prone-y-raise',
  name: 'Prone Y-Raise',
  category: 'strengthen',
  primaryDeviationKeys: [
    'anterior_imbalanced_shoulders',
    'posterior_imbalanced_shoulders',
    'forward_head_posture',
  ],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Lie face down with your forehead on a folded towel and arms extended overhead at roughly 45 degrees, forming a Y, thumbs pointing up. Draw the shoulder blades down toward your back pockets, then lift both arms a few centimeters off the floor. Hold 3 seconds, feeling the work low between the shoulder blades rather than in the upper neck, then lower with control. Perform 8-12 repetitions per set.',
  sets: 3,
  holdSeconds: 3,
  muscles: [
    { muscleSlug: 'lower-trapezius', role: 'strengthen', progressionLevel: 3 },
  ],
}

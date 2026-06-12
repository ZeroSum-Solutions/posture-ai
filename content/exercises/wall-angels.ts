import type { ExerciseContent } from '../muscles/types'

// Seed exercise — instructions kept verbatim from the original seed row.
export const wallAngels: ExerciseContent = {
  slug: 'wall-angels',
  name: 'Wall Angels',
  category: 'strengthen',
  primaryDeviationKeys: ['anterior_imbalanced_shoulders', 'posterior_imbalanced_shoulders'],
  minZone: 'maintain',
  instructions:
    'Stand with your back flat against a wall, arms bent at 90 degrees in contact with the wall. Slowly slide your arms up and down like making a snow angel, keeping full contact with the wall. Pause 2-3 seconds at the top of each slide. Perform 8-10 slow slides per set.',
  sets: 3,
  holdSeconds: 3,
  muscles: [
    { muscleSlug: 'lower-trapezius', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'middle-trapezius', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'serratus-anterior', role: 'strengthen', progressionLevel: 2 },
  ],
}

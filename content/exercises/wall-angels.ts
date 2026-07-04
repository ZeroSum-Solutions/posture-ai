import type { ExerciseContent } from '../muscles/types'

// Seed exercise — instructions kept verbatim from the original seed row.
export const wallAngels: ExerciseContent = {
  slug: 'wall-angels',
  name: 'Wall Angels',
  category: 'strengthen',
  primaryDeviationKeys: ['anterior_imbalanced_shoulders', 'posterior_imbalanced_shoulders'],
  minZone: 'maintain',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  isIntegrative: true,
  instructions:
    'Stand with your back flat against a wall, arms bent at 90 degrees in contact with the wall. Slowly slide your arms up and down like making a snow angel, keeping full contact with the wall. Pause 2-3 seconds at the top of each slide. Perform 8-10 slow slides per set.',
  sets: 3,
  holdSeconds: 3,
  steps: [
    'Stand with your back flat against a wall and your feet a little forward.',
    'Bend your arms to ninety degrees and rest the backs of them against the wall.',
    'Slide your arms slowly upward, keeping contact with the wall the whole way.',
    'Pause two to three seconds near the top, then slide back down with control.',
    'Repeat for eight to ten slow slides, keeping the low back gently supported.',
  ],
  form: {
    alignmentCue: 'Keep your arms, wrists, and low back lightly in contact with the wall as you slide.',
    avoidCue: 'Avoid arching the low back off the wall or letting the arms drift forward to reach higher.',
  },
  muscles: [
    { muscleSlug: 'lower-trapezius', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'middle-trapezius', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'serratus-anterior', role: 'strengthen', progressionLevel: 2 },
  ],
}

import type { ExerciseContent } from '../muscles/types'

// Seed exercise — instructions kept verbatim from the original seed row.
export const neckLateralStretch: ExerciseContent = {
  slug: 'neck-lateral-stretch',
  name: 'Neck Lateral Stretch',
  category: 'stretch',
  primaryDeviationKeys: ['forward_head_posture'],
  minZone: 'maintain',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Tilt your head to one side, ear toward shoulder. Gently apply light pressure with your hand. Hold 30 seconds. Repeat on the other side.',
  sets: 3,
  holdSeconds: 30,
  steps: [
    'Sit or stand tall with your shoulders relaxed and down.',
    'Tilt your head to one side, bringing your ear toward that shoulder.',
    'Rest your hand lightly on the head and add gentle pressure for a mild stretch.',
    'Hold for about thirty seconds while breathing steadily, then release slowly.',
    'Return to center, then repeat on the other side.',
  ],
  form: {
    alignmentCue: 'Keep both shoulders relaxed and down so the stretch lengthens the side of the neck evenly.',
    avoidCue: 'Avoid pulling hard with the hand or lifting the opposite shoulder toward the ear.',
  },
  muscles: [
    { muscleSlug: 'upper-trapezius', role: 'stretch', progressionLevel: 2 },
    { muscleSlug: 'levator-scapulae', role: 'stretch', progressionLevel: 1 },
  ],
}

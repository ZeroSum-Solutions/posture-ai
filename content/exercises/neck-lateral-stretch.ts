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
  muscles: [
    { muscleSlug: 'upper-trapezius', role: 'stretch', progressionLevel: 2 },
    { muscleSlug: 'levator-scapulae', role: 'stretch', progressionLevel: 1 },
  ],
}

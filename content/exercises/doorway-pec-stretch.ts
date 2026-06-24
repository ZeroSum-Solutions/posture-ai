import type { ExerciseContent } from '../muscles/types'

// Seed exercise — instructions kept verbatim from the original seed row.
export const doorwayPecStretch: ExerciseContent = {
  slug: 'doorway-pec-stretch',
  name: 'Doorway Pec Stretch',
  category: 'stretch',
  primaryDeviationKeys: ['anterior_imbalanced_shoulders'],
  minZone: 'maintain',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Stand in a doorway. Place your forearm on the door frame with elbow at 90 degrees. Step forward gently until you feel a stretch across your chest. Hold 20-30 seconds. Repeat on the other side.',
  sets: 3,
  holdSeconds: 20,
  muscles: [
    { muscleSlug: 'pectoralis-major', role: 'stretch', progressionLevel: 2 },
    { muscleSlug: 'pectoralis-minor', role: 'stretch', progressionLevel: 2 },
    { muscleSlug: 'anterior-deltoid', role: 'stretch', progressionLevel: 1 },
  ],
}

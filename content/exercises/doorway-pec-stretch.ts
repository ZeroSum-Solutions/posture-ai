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
    'Stand in a doorway. Place your forearm on the door frame with elbow at 90 degrees. Step forward gently until you feel a stretch across your chest. Hold 30 seconds. Repeat on the other side.',
  sets: 3,
  holdSeconds: 30,
  steps: [
    'Stand tall in an open doorway with feet hip-width apart.',
    'Place your forearm on the door frame, elbow bent to ninety degrees at shoulder height.',
    'Step the same-side foot forward slowly until you feel a gentle stretch across the chest.',
    'Breathe steadily and keep the ribs stacked over the pelvis for the full hold.',
    'Ease back out, then repeat on the other side.',
  ],
  form: {
    alignmentCue: 'Keep your ribs stacked over your pelvis and let the chest open gradually.',
    avoidCue: 'Avoid shrugging the shoulder or arching the lower back to chase a deeper stretch.',
  },
  muscles: [
    { muscleSlug: 'pectoralis-major', role: 'stretch', progressionLevel: 2 },
    { muscleSlug: 'pectoralis-minor', role: 'stretch', progressionLevel: 2 },
    { muscleSlug: 'anterior-deltoid', role: 'stretch', progressionLevel: 1 },
  ],
}

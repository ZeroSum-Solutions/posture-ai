import type { ExerciseContent } from '../muscles/types'

// Seed exercise — instructions kept verbatim from the original seed row.
export const kneelingHipFlexorStretch: ExerciseContent = {
  slug: 'kneeling-hip-flexor-stretch',
  name: 'Kneeling Hip Flexor Stretch',
  category: 'stretch',
  primaryDeviationKeys: ['anterior_pelvic_shift', 'pelvic_obliquity'],
  minZone: 'warning',
  instructions:
    'Kneel with one knee on the ground and the other foot forward (lunge position). Shift your hips forward until you feel a stretch in the front of the hip. Keep your back straight. Hold 20-30 seconds. Repeat on the other side.',
  sets: 3,
  holdSeconds: 20,
  muscles: [
    { muscleSlug: 'iliopsoas', role: 'stretch', progressionLevel: 2 },
    { muscleSlug: 'quadriceps', role: 'stretch', progressionLevel: 1 },
  ],
}

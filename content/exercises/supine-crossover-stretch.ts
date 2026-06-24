import type { ExerciseContent } from '../muscles/types'

// Cross-body stretch for the lateral hip — gluteus medius and TFL/IT band region.
export const supineCrossoverStretch: ExerciseContent = {
  slug: 'supine-crossover-stretch',
  name: 'Supine Crossover Stretch',
  category: 'stretch',
  primaryDeviationKeys: ['pelvic_obliquity', 'pelvic_axial_rotation'],
  minZone: 'maintain',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Lie on your back with both legs extended and arms out to the sides. Lift one leg and guide it across your body toward the opposite side, letting the knee bend as the leg lowers toward the floor. Use the opposite hand on the outside of the knee to add a gentle pull until you feel a stretch along the outside of the hip and into the lower back. Keep both shoulders on the floor. Hold 30 seconds, return with control, and repeat on the other side.',
  sets: 3,
  holdSeconds: 30,
  muscles: [
    { muscleSlug: 'gluteus-medius', role: 'stretch', progressionLevel: 2 },
    { muscleSlug: 'deep-hip-external-rotators', role: 'stretch', progressionLevel: 1 },
    { muscleSlug: 'tfl-it-band', role: 'stretch', progressionLevel: 1 },
  ],
}

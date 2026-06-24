import type { ExerciseContent } from '../muscles/types'

// Seated groin stretch for the hip adductors.
export const butterflyStretch: ExerciseContent = {
  slug: 'butterfly-stretch',
  name: 'Butterfly Stretch',
  category: 'stretch',
  primaryDeviationKeys: ['pelvic_obliquity', 'genu_varum_valgum_left', 'genu_varum_valgum_right'],
  minZone: 'maintain',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Sit tall on the floor with the soles of your feet together and knees dropped out to the sides. Hold your ankles and rest the elbows lightly on the inner thighs. Sit up out of the lower back, then hinge slightly forward from the hips — or let the elbows press the thighs gently toward the floor — until you feel a stretch along the inner thighs and groin. Avoid bouncing. Hold 30 seconds while breathing slowly, then release.',
  sets: 3,
  holdSeconds: 30,
  muscles: [
    { muscleSlug: 'hip-adductors', role: 'stretch', progressionLevel: 2 },
  ],
}

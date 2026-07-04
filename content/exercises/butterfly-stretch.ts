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
  steps: [
    'Sit tall on the floor with the soles of your feet together and knees dropped out to the sides.',
    'Hold your ankles and rest your elbows lightly on your inner thighs.',
    'Lengthen up out of your lower back, then hinge slightly forward from the hips until you feel the inner-thigh stretch.',
    'Breathe slowly through the hold, then ease back upright.',
  ],
  form: {
    alignmentCue: 'Hinge forward from the hips with a long spine and let your knees settle toward the floor.',
    avoidCue: 'Avoid bouncing the knees or rounding your lower back to reach further.',
  },
  muscles: [
    { muscleSlug: 'hip-adductors', role: 'stretch', progressionLevel: 2 },
  ],
}

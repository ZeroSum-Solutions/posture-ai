import type { ExerciseContent } from '../muscles/types'

// Anti-rotation isometric that trains the trunk to resist a sideways band pull.
export const tallKneelingAntiRotationHold: ExerciseContent = {
  slug: 'tall-kneeling-anti-rotation-hold',
  name: 'Tall-Kneeling Anti-Rotation Hold',
  category: 'activation',
  primaryDeviationKeys: ['pelvic_axial_rotation'],
  minZone: 'warning',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Kneel tall with both knees down and hips stacked over them, holding a band anchored to one side at chest height. Press your hands straight out in front of your chest and resist the sideways pull, keeping your hips and shoulders square to the front. Breathe steadily and stay tall through the spine for the full hold. Hold 15 seconds, then switch to the other side.',
  sets: 3,
  holdSeconds: 15,
  steps: [
    'Kneel tall with both knees down and your hips stacked directly over them.',
    'Hold a band anchored to one side at chest height with both hands.',
    'Press your hands straight out in front of your chest and resist the sideways pull.',
    'Keep your hips and shoulders square to the front and breathe steadily through the hold.',
    'Release slowly, then switch to the other side.',
  ],
  form: {
    alignmentCue: 'Keep your hips and shoulders square to the front and stay tall through the spine.',
    avoidCue: 'Avoid letting the band twist your torso toward the anchor.',
  },
  muscles: [
    { muscleSlug: 'obliques', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'deep-abdominals', role: 'strengthen', progressionLevel: 2 },
  ],
}

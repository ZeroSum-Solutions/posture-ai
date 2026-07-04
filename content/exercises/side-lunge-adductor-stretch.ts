import type { ExerciseContent } from '../muscles/types'

// Standing adductor stretch — longer lever than the butterfly.
export const sideLungeAdductorStretch: ExerciseContent = {
  slug: 'side-lunge-adductor-stretch',
  name: 'Side Lunge Adductor Stretch',
  category: 'stretch',
  primaryDeviationKeys: ['genu_varum_valgum_left', 'genu_varum_valgum_right', 'pelvic_obliquity'],
  minZone: 'maintain',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Stand with feet wide apart, toes pointing forward. Shift your weight to one side, bending that knee while keeping the other leg straight, until you feel a stretch along the inner thigh of the straight leg. Keep the chest up and hips facing forward; place hands on the bent thigh or the floor for balance. Sink only as deep as the bent-side knee stays over the foot. Hold 30 seconds, push back to center, and repeat on the other side.',
  sets: 3,
  holdSeconds: 30,
  steps: [
    'Stand with your feet wide apart and toes pointing forward.',
    'Shift your weight to one side, bending that knee while keeping the other leg straight.',
    'Sink down until you feel a stretch along the inner thigh of the straight leg, hands on the bent thigh for balance.',
    'Push back to center with control.',
    'Repeat on the other side.',
  ],
  form: {
    alignmentCue: 'Keep your chest up and hips facing forward, letting the bent knee stay over its foot.',
    avoidCue: 'Avoid letting the bent knee drift past the toes or the chest collapsing toward the floor.',
  },
  muscles: [
    { muscleSlug: 'hip-adductors', role: 'stretch', progressionLevel: 3 },
  ],
}

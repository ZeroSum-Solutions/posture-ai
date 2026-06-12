import type { ExerciseContent } from '../muscles/types'

// Standing adductor stretch — longer lever than the butterfly.
export const sideLungeAdductorStretch: ExerciseContent = {
  slug: 'side-lunge-adductor-stretch',
  name: 'Side Lunge Adductor Stretch',
  category: 'stretch',
  primaryDeviationKeys: ['genu_varum_valgum_left', 'genu_varum_valgum_right', 'pelvic_obliquity'],
  minZone: 'maintain',
  instructions:
    'Stand with feet wide apart, toes pointing forward. Shift your weight to one side, bending that knee while keeping the other leg straight, until you feel a stretch along the inner thigh of the straight leg. Keep the chest up and hips facing forward; place hands on the bent thigh or the floor for balance. Sink only as deep as the bent-side knee stays over the foot. Hold 20-30 seconds, push back to center, and repeat on the other side.',
  sets: 3,
  holdSeconds: 20,
  muscles: [
    { muscleSlug: 'hip-adductors', role: 'stretch', progressionLevel: 3 },
  ],
}

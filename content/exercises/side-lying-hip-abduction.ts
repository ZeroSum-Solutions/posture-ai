import type { ExerciseContent } from '../muscles/types'

// Standard gluteus medius strengthener — straight-leg raise on the side.
export const sideLyingHipAbduction: ExerciseContent = {
  slug: 'side-lying-hip-abduction',
  name: 'Side-Lying Hip Abduction',
  category: 'strengthen',
  primaryDeviationKeys: ['pelvic_obliquity', 'genu_varum_valgum_left', 'genu_varum_valgum_right'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Lie on your side with the bottom leg bent for stability and the top leg straight, body in one line. Keeping the toes of the top foot pointing forward (not up), lift the leg toward the ceiling about 30-45 degrees. Pause 3 seconds at the top, then lower slowly without resting the leg between repetitions. Avoid rolling the hips backward or hiking the waist — the work should sit in the side of the hip. Do 10-12 lifts, then switch sides.',
  sets: 3,
  holdSeconds: 3,
  muscles: [
    { muscleSlug: 'gluteus-medius', role: 'strengthen', progressionLevel: 2 },
  ],
}

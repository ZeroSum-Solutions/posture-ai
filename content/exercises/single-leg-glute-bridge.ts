import type { ExerciseContent } from '../muscles/types'

// Progression of the glute bridge — one leg carries the load.
export const singleLegGluteBridge: ExerciseContent = {
  slug: 'single-leg-glute-bridge',
  name: 'Single-Leg Glute Bridge',
  category: 'strengthen',
  primaryDeviationKeys: ['anterior_pelvic_shift', 'pelvic_axial_rotation', 'knee_extension_back_knee'],
  minZone: 'warning',
  instructions:
    'Lie on your back with knees bent and feet flat. Extend one leg straight or hold that knee to your chest. Squeeze the glute of the grounded leg and drive the hips up until the body forms a straight line from knee to shoulder, keeping the pelvis level — do not let one side drop or rotate. Hold 3 seconds at the top, then lower with control. Do 8-10 repetitions on one side before switching. Keep the ribs down and avoid arching the lower back.',
  sets: 3,
  holdSeconds: 3,
  muscles: [
    { muscleSlug: 'gluteus-maximus', role: 'strengthen', progressionLevel: 3 },
    { muscleSlug: 'hamstrings', role: 'strengthen', progressionLevel: 2 },
  ],
}

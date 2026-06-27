import type { ExerciseContent } from '../muscles/types'

// Prone hip extension paired with an abdominal draw-in (ADIM) brace: the brace
// keeps the lumbar erectors quiet so the gluteus maximus does the hip-extension
// work rather than the low back. Oh 2007 (~52% MVIC glute max from this drill,
// not the glute bridge).
export const proneHipExtension: ExerciseContent = {
  slug: 'prone-hip-extension',
  name: 'Prone Hip Extension with Abdominal Brace',
  category: 'strengthen',
  primaryDeviationKeys: ['anterior_pelvic_shift'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 8, max: 10 },
  instructions:
    'Lie face-down with a flat cushion under your hips and your forehead resting on your hands. First draw the lower belly gently up and away from the floor — an abdominal brace — and hold it there so the lower back stays quiet. Keeping that brace, squeeze one glute and lift that straight leg a few inches off the floor, leading with the heel and without arching the back or rotating the pelvis. Hold 5 seconds, lower with control, and repeat for 8-10 reps before switching sides.',
  sets: 3,
  holdSeconds: 5,
  muscles: [
    { muscleSlug: 'gluteus-maximus', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'deep-abdominals', role: 'strengthen', progressionLevel: 1 },
  ],
}

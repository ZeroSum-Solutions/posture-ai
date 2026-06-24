import type { ExerciseContent } from '../muscles/types'

// Standard deep-core drill — limb movement over a braced trunk.
export const deadBug: ExerciseContent = {
  slug: 'dead-bug',
  name: 'Dead Bug',
  category: 'strengthen',
  primaryDeviationKeys: ['anterior_pelvic_shift', 't1_tilt_backward'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Lie on your back with arms reaching toward the ceiling and hips and knees bent to 90 degrees, shins parallel to the floor. Press your lower back gently into the mat. Slowly lower one arm overhead and the opposite leg toward the floor, stopping before the lower back lifts. Pause 3 seconds, return, and switch sides. Move only as far as you can keep the trunk completely still. Do 6-8 slow repetitions per side, per set.',
  sets: 3,
  holdSeconds: 3,
  muscles: [
    { muscleSlug: 'deep-abdominals', role: 'strengthen', progressionLevel: 2 },
  ],
}

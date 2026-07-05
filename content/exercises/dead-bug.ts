import type { ExerciseContent } from '../muscles/types'

// Standard deep-core drill — limb movement over a braced trunk.
export const deadBug: ExerciseContent = {
  slug: 'dead-bug',
  name: 'Dead Bug',
  category: 'strengthen',
  primaryDeviationKeys: ['trunk_lean'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Lie on your back with arms reaching toward the ceiling and hips and knees bent to 90 degrees, shins parallel to the floor. Press your lower back gently into the mat. Slowly lower one arm overhead and the opposite leg toward the floor, stopping before the lower back lifts. Pause 3 seconds, return, and switch sides. Move only as far as you can keep the trunk completely still. Do 6-8 slow repetitions per side, per set.',
  sets: 3,
  holdSeconds: 3,
  steps: [
    'Lie on your back with arms reaching up and knees and hips bent so the shins are level.',
    'Press the lower back gently into the mat to set a stable, braced trunk.',
    'Lower one arm overhead and the opposite leg toward the floor, stopping before the back lifts.',
    'Pause about three seconds, return to the start with control, then switch to the other side.',
  ],
  form: {
    alignmentCue: 'Keep the lower back lightly pinned to the mat so the trunk stays completely still.',
    avoidCue: 'Avoid reaching so far that the lower back arches up off the floor; shorten the range instead.',
  },
  muscles: [
    { muscleSlug: 'deep-abdominals', role: 'strengthen', progressionLevel: 2 },
  ],
}

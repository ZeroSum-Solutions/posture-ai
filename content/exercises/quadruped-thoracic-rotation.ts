import type { ExerciseContent } from '../muscles/types'

export const quadrupedThoracicRotation: ExerciseContent = {
  slug: 'quadruped-thoracic-rotation',
  name: 'Quadruped Thoracic Rotation',
  category: 'mobility',
  primaryDeviationKeys: ['trunk_lean'],
  minZone: 'maintain',
  dosageType: 'dynamic',
  reps: { min: 8, max: 10 },
  instructions:
    'Start on your hands and knees and place one hand behind your head. Rotate that elbow up toward the ceiling, opening your chest and following the elbow with your eyes. Then reach the same elbow down and under your body, letting your upper back round gently. Move smoothly through the full range and count each rotation as one repetition per side. Switch sides. Perform 8-10 repetitions per side per set.',
  sets: 2,
  holdSeconds: 2,
  steps: [
    'Begin on your hands and knees with your back flat and place one hand behind your head.',
    'Rotate that elbow up toward the ceiling, opening your chest and following it with your eyes.',
    'Reach the same elbow down and under your body, letting your upper back round gently.',
    'Flow smoothly through the range for your reps, then switch sides.',
  ],
  form: {
    alignmentCue: 'Let the rotation come from your upper back and follow the elbow with your eyes.',
    avoidCue: 'Avoid twisting through your lower back or letting your hips shift side to side.',
  },
  muscles: [
    { muscleSlug: 'thoracic-erector-spinae', role: 'stretch', progressionLevel: 2 },
    { muscleSlug: 'latissimus-dorsi', role: 'stretch', progressionLevel: 1 },
  ],
}

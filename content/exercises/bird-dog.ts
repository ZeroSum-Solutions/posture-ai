import type { ExerciseContent } from '../muscles/types'

// Quadruped drill — gentle glute and deep-core work with anti-rotation demand.
export const birdDog: ExerciseContent = {
  slug: 'bird-dog',
  name: 'Bird Dog',
  category: 'strengthen',
  primaryDeviationKeys: ['trunk_lean'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Start on hands and knees, wrists under shoulders and knees under hips, spine in a comfortable mid position. Brace the abdominals lightly, then reach one arm forward and the opposite leg back until both are level with the trunk. Keep the hips square to the floor — imagine balancing a cup of water on the lower back. Hold 5 seconds, return slowly, and switch sides. Do 6-8 repetitions per side, moving with control rather than speed.',
  sets: 3,
  holdSeconds: 5,
  steps: [
    'Start on hands and knees with wrists under shoulders, knees under hips, spine in a neutral mid position.',
    'Brace the abdominals lightly to steady the trunk before you move.',
    'Reach one arm forward and the opposite leg back until both are level with the torso.',
    'Hold about five seconds, lower with control, then switch to the other arm and leg.',
  ],
  form: {
    alignmentCue: 'Keep the hips square to the floor, as if balancing a cup of water on the lower back.',
    avoidCue: 'Avoid letting the hips tilt or the back sag; move with control rather than swinging the limbs.',
  },
  muscles: [
    { muscleSlug: 'gluteus-maximus', role: 'strengthen', progressionLevel: 1 },
    { muscleSlug: 'deep-abdominals', role: 'strengthen', progressionLevel: 2 },
  ],
}

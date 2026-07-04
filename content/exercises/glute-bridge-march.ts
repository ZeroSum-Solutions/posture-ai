import type { ExerciseContent } from '../muscles/types'

export const gluteBridgeMarch: ExerciseContent = {
  slug: 'glute-bridge-march',
  name: 'Glute Bridge March',
  category: 'strengthen',
  primaryDeviationKeys: ['anterior_pelvic_shift', 'pelvic_obliquity'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 8, max: 12 },
  instructions:
    'Set up in a glute bridge with your hips lifted and glutes squeezed. Holding that height, lift one foot off the floor, then set it down and lift the other, marching slowly and steadily. Keep your hips level and still the whole time so the pelvis does not dip or rotate. Count each leg lift as one repetition per leg. Perform 8-12 repetitions per leg per set.',
  sets: 3,
  holdSeconds: 2,
  steps: [
    'Lie on your back, lift into a glute bridge, and squeeze your glutes to hold the height.',
    'Slowly lift one foot a few inches off the floor while keeping your hips level.',
    'Lower that foot with control, then lift the other foot the same way.',
    'Keep alternating, staying steady so the pelvis does not dip or twist.',
  ],
  form: {
    alignmentCue: 'Keep your hips lifted and perfectly level as you march each foot up.',
    avoidCue: 'Avoid letting your hips drop or rotate toward the leg that lifts.',
  },
  muscles: [
    { muscleSlug: 'gluteus-maximus', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'deep-abdominals', role: 'strengthen', progressionLevel: 2 },
  ],
}

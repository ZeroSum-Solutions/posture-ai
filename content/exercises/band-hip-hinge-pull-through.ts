import type { ExerciseContent } from '../muscles/types'

export const bandHipHingePullThrough: ExerciseContent = {
  slug: 'band-hip-hinge-pull-through',
  name: 'Band Hip Hinge Pull-Through',
  category: 'strengthen',
  primaryDeviationKeys: ['trunk_lean'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Stand facing away from a low band anchor with the band running between your legs and held in both hands. Push your hips back to hinge forward, keeping a flat back and a soft bend in the knees. Then drive your hips forward to stand tall, squeezing your glutes at the top. Move with control and let the hips do the work. Perform 10-15 repetitions per set.',
  sets: 3,
  holdSeconds: 2,
  steps: [
    'Stand facing away from a low anchor with the band between your legs, held in both hands.',
    'Push your hips back and hinge forward, keeping your back flat and knees softly bent.',
    'Drive your hips forward to stand tall, squeezing your glutes at the top.',
    'Pause briefly at the top, then hinge back to begin the next rep.',
  ],
  form: {
    alignmentCue: 'Keep a flat back and let the movement come from your hips, not your lower back.',
    avoidCue: 'Avoid rounding your back or squatting down instead of hinging at the hips.',
  },
  muscles: [
    { muscleSlug: 'gluteus-maximus', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'hamstrings', role: 'strengthen', progressionLevel: 1 },
  ],
}

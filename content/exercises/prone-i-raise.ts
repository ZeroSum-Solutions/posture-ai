import type { ExerciseContent } from '../muscles/types'

// Prone overhead raise targeting the mid and lower trapezius.
export const proneIRaise: ExerciseContent = {
  slug: 'prone-i-raise',
  name: 'Prone I Raise',
  category: 'strengthen',
  primaryDeviationKeys: ['posterior_imbalanced_shoulders', 't1_tilt_backward'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 8, max: 12 },
  instructions:
    'Lie face down with your arms reaching straight overhead in a narrow "I" shape, thumbs pointing up toward the ceiling. Keeping your arms long and your neck relaxed, lift both arms toward the ceiling by drawing your shoulder blades down and together. Pause briefly at the top, then lower slowly with control. Focus the effort in your mid and lower back rather than your neck or hands. Perform 8-12 controlled repetitions per set.',
  sets: 3,
  holdSeconds: 2,
  steps: [
    'Lie face down with both arms straight overhead in an "I", thumbs pointing up.',
    'Lift your arms toward the ceiling by drawing your shoulder blades down and together.',
    'Pause briefly at the top, then lower your arms slowly back toward the floor.',
  ],
  form: {
    alignmentCue: 'Keep your arms long and drive the lift from your mid-back, keeping your neck relaxed.',
    avoidCue: 'Avoid shrugging your shoulders up or arching hard through your lower back.',
  },
  muscles: [
    { muscleSlug: 'lower-trapezius', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'thoracic-erector-spinae', role: 'strengthen', progressionLevel: 1 },
  ],
}

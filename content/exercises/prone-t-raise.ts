import type { ExerciseContent } from '../muscles/types'

// Progression for mid-trap and rhomboids — arms lifted against gravity in a T.
export const proneTRaise: ExerciseContent = {
  slug: 'prone-t-raise',
  name: 'Prone T-Raise',
  category: 'strengthen',
  primaryDeviationKeys: ['anterior_imbalanced_shoulders', 'posterior_imbalanced_shoulders'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Lie face down with your forehead on a folded towel and arms out to the sides in a T shape, thumbs pointing up. Squeeze your shoulder blades together and down, then lift both arms a few centimeters off the floor without lifting your chest or shrugging. Hold 3 seconds at the top, then lower slowly. Keep the neck long and gaze at the floor. Perform 8-12 repetitions per set; add light weights to progress further.',
  sets: 3,
  holdSeconds: 3,
  steps: [
    'Lie face down with your forehead on a folded towel and arms out to the sides like a T, thumbs up.',
    'Draw the shoulder blades together and down, then float both arms a little off the floor.',
    'Hold briefly at the top, then lower the arms back down with control.',
  ],
  form: {
    alignmentCue: 'Keep your neck long and gaze at the floor while the shoulder blades do the lifting.',
    avoidCue: 'Avoid lifting your chest or shrugging your shoulders to raise the arms higher.',
  },
  muscles: [
    { muscleSlug: 'middle-trapezius', role: 'strengthen', progressionLevel: 3 },
    { muscleSlug: 'rhomboids', role: 'strengthen', progressionLevel: 3 },
  ],
}

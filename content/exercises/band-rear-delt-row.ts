import type { ExerciseContent } from '../muscles/types'

// High-elbow band row for the mid-back retractors.
export const bandRearDeltRow: ExerciseContent = {
  slug: 'band-rear-delt-row',
  name: 'Band Rear Delt Row',
  category: 'strengthen',
  primaryDeviationKeys: ['posterior_imbalanced_shoulders'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Stand tall facing a band anchored at about chest height, holding one end in each hand with arms extended forward. Row your elbows high and wide toward the rear, drawing your shoulder blades together as your hands travel back. Pause briefly at the fullest squeeze, then return your arms forward slowly with control. Keep your ribs down and your neck relaxed, letting the mid-back do the work. Perform 10-15 controlled repetitions per set.',
  sets: 3,
  holdSeconds: 2,
  steps: [
    'Stand tall facing a band anchored at chest height, arms extended forward holding each end.',
    'Row your elbows high and wide toward the rear, squeezing your shoulder blades together.',
    'Pause briefly at the fullest squeeze, then return your arms forward slowly.',
  ],
  form: {
    alignmentCue: 'Keep your elbows high and wide and let your shoulder blades draw together.',
    avoidCue: 'Avoid shrugging your shoulders up or leaning back to pull the band.',
  },
  muscles: [
    { muscleSlug: 'middle-trapezius', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'rhomboids', role: 'strengthen', progressionLevel: 2 },
  ],
}

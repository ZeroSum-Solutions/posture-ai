import type { ExerciseContent } from '../muscles/types'

// Standard rowing pattern for the scapular retractors.
export const seatedBandRow: ExerciseContent = {
  slug: 'seated-band-row',
  name: 'Seated Band Row',
  category: 'strengthen',
  primaryDeviationKeys: ['anterior_imbalanced_shoulders'],
  minZone: 'warning',
  instructions:
    'Sit on the floor with legs extended and loop a resistance band around your feet, holding one end in each hand. Sit tall, then pull the band toward your lower ribs, driving the elbows back and squeezing the shoulder blades together. Pause 2 seconds, then let the arms return slowly without letting the shoulders roll forward. Keep the torso upright the whole time. Perform 10-12 repetitions per set.',
  sets: 3,
  holdSeconds: 2,
  muscles: [
    { muscleSlug: 'rhomboids', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'middle-trapezius', role: 'strengthen', progressionLevel: 2 },
  ],
}

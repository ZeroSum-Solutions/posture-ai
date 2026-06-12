import type { ExerciseContent } from '../muscles/types'

// Focused lat lengthening using a chair or bench.
export const kneelingLatStretch: ExerciseContent = {
  slug: 'kneeling-lat-stretch',
  name: 'Kneeling Lat Stretch on Chair',
  category: 'stretch',
  primaryDeviationKeys: ['t1_tilt_backward'],
  minZone: 'maintain',
  instructions:
    'Kneel in front of a chair or bench and place both elbows on it, hands together and thumbs pointing toward the ceiling. Sit your hips back toward your heels while letting your chest sink between the arms until you feel a stretch along the sides of your upper back and under the arms. Keep the lower ribs drawn gently in so the stretch stays in the lats rather than the lower back. Hold 30 seconds, breathing slowly, then ease out.',
  sets: 3,
  holdSeconds: 30,
  muscles: [
    { muscleSlug: 'latissimus-dorsi', role: 'stretch', progressionLevel: 2 },
  ],
}

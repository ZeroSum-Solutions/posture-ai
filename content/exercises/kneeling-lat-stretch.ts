import type { ExerciseContent } from '../muscles/types'

// Focused lat lengthening using a chair or bench.
export const kneelingLatStretch: ExerciseContent = {
  slug: 'kneeling-lat-stretch',
  name: 'Kneeling Lat Stretch on Chair',
  category: 'stretch',
  primaryDeviationKeys: ['t1_tilt_backward'],
  minZone: 'maintain',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Kneel in front of a chair or bench and place both elbows on it, hands together and thumbs pointing toward the ceiling. Sit your hips back toward your heels while letting your chest sink between the arms until you feel a stretch along the sides of your upper back and under the arms. Keep the lower ribs drawn gently in so the stretch stays in the lats rather than the lower back. Hold 30 seconds, breathing slowly, then ease out.',
  sets: 3,
  holdSeconds: 30,
  steps: [
    'Kneel in front of a chair or bench and rest both elbows on it, thumbs pointing up.',
    'Sit your hips back toward your heels while letting your chest sink between your arms.',
    'Ease down until you feel a stretch along the sides of your upper back, and hold.',
  ],
  form: {
    alignmentCue: 'Draw your lower ribs gently in so the stretch stays under the arms and along the back.',
    avoidCue: 'Avoid letting your lower back sag so the stretch shifts away from the sides of your back.',
  },
  muscles: [
    { muscleSlug: 'latissimus-dorsi', role: 'stretch', progressionLevel: 2 },
  ],
}

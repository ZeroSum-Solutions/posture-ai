import type { ExerciseContent } from '../muscles/types'

// Reverse fly with a front-anchored band to load the rear shoulder and mid-back.
export const bandReverseFly: ExerciseContent = {
  slug: 'band-reverse-fly',
  name: 'Band Reverse Fly',
  category: 'strengthen',
  primaryDeviationKeys: ['posterior_imbalanced_shoulders'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Stand with feet hip-width apart and hinge forward slightly at the hips, holding a light band anchored in front of you at chest height with straight arms. Sweep both arms out to the sides in a wide arc like a reverse fly, drawing the shoulder blades together at the top. Pause 2 seconds at the widest point, then return slowly to the start with control. Keep the ribs down and the neck long throughout. Perform 10-15 controlled repetitions per set.',
  sets: 3,
  holdSeconds: 2,
  steps: [
    'Stand tall, feet hip-width apart, and hinge forward slightly from the hips.',
    'Hold the front-anchored band at chest height with straight arms in front of you.',
    'Sweep both arms out to the sides in a wide arc, drawing the shoulder blades together.',
    'Pause briefly at the widest point, then return the arms slowly to the start.',
  ],
  form: {
    alignmentCue: 'Keep your ribs down and lead the sweep with your shoulder blades, not your hands.',
    avoidCue: 'Avoid shrugging your shoulders toward your ears as you open the arms.',
  },
  muscles: [
    { muscleSlug: 'middle-trapezius', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'rhomboids', role: 'strengthen', progressionLevel: 1 },
  ],
}

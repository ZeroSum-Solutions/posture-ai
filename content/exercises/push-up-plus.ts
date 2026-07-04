import type { ExerciseContent } from '../muscles/types'

// Floor progression of the wall push-up plus for serratus anterior.
export const pushUpPlus: ExerciseContent = {
  slug: 'push-up-plus',
  name: 'Push-Up Plus',
  category: 'strengthen',
  primaryDeviationKeys: ['anterior_imbalanced_shoulders'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Start in a push-up position with hands under the shoulders and body in one straight line (drop to the knees to reduce the load). At the top of the position, keep the elbows straight and push the floor away, spreading your shoulder blades apart so the upper back rounds slightly. Hold 2 seconds, then lower the chest a few centimeters and repeat the push. Keep the core braced so the hips stay level. Perform 8-12 repetitions per set.',
  sets: 3,
  holdSeconds: 2,
  steps: [
    'Set up in a push-up position with hands under your shoulders, or drop to your knees to lighten it.',
    'With elbows straight, push the floor away so your shoulder blades spread and the upper back rounds slightly.',
    'Hold briefly, then let the chest lower a little as the blades draw back together.',
  ],
  form: {
    alignmentCue: 'Brace your core so your hips stay level as you push the floor away.',
    avoidCue: 'Avoid bending your elbows; the extra push should come from the shoulder blades.',
  },
  muscles: [
    { muscleSlug: 'serratus-anterior', role: 'strengthen', progressionLevel: 3 },
  ],
}

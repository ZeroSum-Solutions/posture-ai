import type { ExerciseContent } from '../muscles/types'

// Entry-level serratus anterior drill — the "plus" push at a wall.
export const wallPushUpPlus: ExerciseContent = {
  slug: 'wall-push-up-plus',
  name: 'Wall Push-Up Plus',
  category: 'activation',
  primaryDeviationKeys: ['anterior_imbalanced_shoulders'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Stand facing a wall with hands flat on it at shoulder height, arms straight, feet a step back. Keeping the elbows straight, push your upper back away from the wall by spreading the shoulder blades apart — this extra push is the "plus". Hold 2 seconds, then let the shoulder blades glide back together with control. Keep the trunk in one line and avoid sagging hips. Perform 10-15 slow repetitions per set.',
  sets: 3,
  holdSeconds: 2,
  steps: [
    'Stand facing a wall with hands flat at shoulder height, arms straight and feet a step back.',
    'Keeping elbows straight, push your upper back away from the wall so the shoulder blades spread apart.',
    'Hold briefly, then let the shoulder blades glide back together with control.',
  ],
  form: {
    alignmentCue: 'Keep your trunk in one straight line from head to heels as you push away.',
    avoidCue: 'Avoid letting your hips sag; the movement comes from the shoulder blades, not the elbows.',
  },
  muscles: [
    { muscleSlug: 'serratus-anterior', role: 'strengthen', progressionLevel: 1 },
  ],
}

import type { ExerciseContent } from '../muscles/types'

// Simplest retraction drill — isometric squeeze, no equipment.
export const shoulderBladeSqueeze: ExerciseContent = {
  slug: 'shoulder-blade-squeeze',
  name: 'Shoulder Blade Squeeze',
  category: 'activation',
  primaryDeviationKeys: ['anterior_imbalanced_shoulders'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 10, max: 15 },
  instructions:
    'Sit or stand tall with arms relaxed at your sides. Draw both shoulder blades back and slightly down, as if pinching a pencil between them — without shrugging or arching the lower back. Hold the squeeze for 5 seconds while breathing steadily, then release slowly. Aim for a firm but comfortable effort, about 70 percent of maximum. Repeat 10 times per set; this can be done several times through the day.',
  sets: 3,
  holdSeconds: 5,
  muscles: [
    { muscleSlug: 'rhomboids', role: 'strengthen', progressionLevel: 1 },
    { muscleSlug: 'middle-trapezius', role: 'strengthen', progressionLevel: 1 },
  ],
}

import type { ExerciseContent } from '../muscles/types'

// Gentle lower-back lengthening in supine.
export const kneesToChestStretch: ExerciseContent = {
  slug: 'knees-to-chest-stretch',
  name: 'Knees-to-Chest Stretch',
  category: 'stretch',
  primaryDeviationKeys: ['anterior_pelvic_shift'],
  minZone: 'maintain',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Lie on your back on a mat. Draw both knees up and hug them toward your chest with your hands behind the thighs or over the shins. Let your lower back relax and gently round into the floor, and keep your head and shoulders resting down. You should feel an easy stretch across the lower back and hips. Hold 30 seconds while breathing slowly, then lower one leg at a time. Rock gently side to side during the hold if that feels comfortable.',
  sets: 3,
  holdSeconds: 30,
  steps: [
    'Lie on your back on a mat with your head and shoulders resting down.',
    'Draw both knees up and hug them toward your chest with hands behind the thighs or over the shins.',
    'Let your lower back soften and gently round into the floor as you feel the easy stretch.',
    'Breathe slowly through the hold, then lower one leg at a time.',
  ],
  form: {
    alignmentCue: 'Let your lower back round gently into the floor while your shoulders stay relaxed and down.',
    avoidCue: 'Avoid tensing your neck or shoulders while you hug the knees in.',
  },
  muscles: [
    { muscleSlug: 'lumbar-erector-spinae', role: 'stretch', progressionLevel: 1 },
  ],
}

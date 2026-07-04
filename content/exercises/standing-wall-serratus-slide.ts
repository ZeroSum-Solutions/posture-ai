import type { ExerciseContent } from '../muscles/types'

// Standing wall slide to activate the serratus anterior.
export const standingWallSerratusSlide: ExerciseContent = {
  slug: 'standing-wall-serratus-slide',
  name: 'Standing Wall Serratus Slide',
  category: 'activation',
  primaryDeviationKeys: ['anterior_imbalanced_shoulders'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: { min: 8, max: 12 },
  instructions:
    'Stand facing a wall with your forearms resting against it, elbows about shoulder height and shoulder-width apart. Press your forearms into the wall and reach tall, letting your upper back round slightly forward to engage the muscles along your ribs. Keeping that gentle press, slide your forearms upward along the wall, then bring them back down with control. Keep your neck relaxed and your ribs down. Perform 8-12 controlled repetitions per set.',
  sets: 3,
  holdSeconds: 2,
  steps: [
    'Stand facing a wall with your forearms on it, elbows about shoulder height and width.',
    'Press your forearms into the wall and reach tall, letting your upper back round slightly.',
    'Slide your forearms up the wall, then bring them back down slowly with control.',
  ],
  form: {
    alignmentCue: 'Keep a steady press into the wall and reach tall to feel the muscles along your ribs.',
    avoidCue: 'Avoid shrugging your shoulders up or letting your ribs flare as you slide.',
  },
  muscles: [
    { muscleSlug: 'serratus-anterior', role: 'strengthen', progressionLevel: 2 },
  ],
}

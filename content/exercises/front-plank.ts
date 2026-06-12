import type { ExerciseContent } from '../muscles/types'

// Progression for the deep abdominals — full-body isometric brace.
export const frontPlank: ExerciseContent = {
  slug: 'front-plank',
  name: 'Front Plank',
  category: 'strengthen',
  primaryDeviationKeys: ['anterior_pelvic_shift', 't1_tilt_backward'],
  minZone: 'warning',
  instructions:
    'Lie face down, then prop yourself on your forearms and toes with elbows under the shoulders. Tuck the tailbone slightly and brace the abdominals so the body forms one straight line from head to heels — no sagging hips, no pike. Breathe steadily throughout the hold; if the lower back starts to dip, rest and restart from the knees. Hold 20-30 seconds per set, building duration gradually as control improves.',
  sets: 3,
  holdSeconds: 30,
  muscles: [
    { muscleSlug: 'deep-abdominals', role: 'strengthen', progressionLevel: 3 },
  ],
}

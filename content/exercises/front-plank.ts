import type { ExerciseContent } from '../muscles/types'

// Progression for the deep abdominals — full-body isometric brace.
export const frontPlank: ExerciseContent = {
  slug: 'front-plank',
  name: 'Front Plank',
  category: 'strengthen',
  primaryDeviationKeys: ['trunk_lean'],
  minZone: 'warning',
  dosageType: 'hold',
  reps: null,
  instructions:
    'Lie face down, then prop yourself on your forearms and toes with elbows under the shoulders. Tuck the tailbone slightly and brace the abdominals so the body forms one straight line from head to heels — no sagging hips, no pike. Breathe steadily throughout the hold; if the lower back starts to dip, rest and restart from the knees. Hold 20-30 seconds per set, building duration gradually as control improves.',
  sets: 3,
  holdSeconds: 30,
  steps: [
    'Lie face down, then prop onto your forearms with elbows directly under the shoulders.',
    'Lift onto your toes and tuck the tailbone slightly to set a neutral spine.',
    'Brace the abdominals so the body forms one straight line from head to heels.',
    'Breathe steadily and hold twenty to thirty seconds; drop to the knees to rest if the back dips.',
  ],
  form: {
    alignmentCue: 'Hold one straight line from head to heels with the hips level, neither sagging nor piking.',
    avoidCue: 'Avoid letting the hips drop toward the floor or holding your breath through the set.',
  },
  muscles: [
    { muscleSlug: 'deep-abdominals', role: 'strengthen', progressionLevel: 3 },
  ],
}

import type { ExerciseContent } from '../muscles/types'

// Anti-rotation hold — obliques and deep core resist a sideways pull.
export const pallofPress: ExerciseContent = {
  slug: 'pallof-press',
  name: 'Pallof Press (Anti-Rotation Hold)',
  category: 'informational',
  primaryDeviationKeys: ['pelvic_axial_rotation'],
  minZone: 'warning',
  dosageType: 'dynamic',
  reps: null,
  instructions:
    'Anchor a resistance band at chest height and stand side-on to the anchor, holding the band with both hands at your sternum, feet hip-width apart. Press the hands straight out in front of your chest and hold — the band will try to twist you toward the anchor; resist so the hips and shoulders stay square. Hold 10 seconds, return the hands to the chest, and repeat 8 times, then face the other way. Soften the knees and keep breathing through every hold.',
  sets: 3,
  holdSeconds: 10,
  steps: [
    'Anchor a resistance band at chest height and stand side-on, feet about hip-width apart.',
    'Hold the band with both hands against your sternum and soften the knees slightly.',
    'Press the hands straight out in front of the chest and hold as the band pulls you sideways.',
    'Hold about ten seconds, return the hands to the chest, then repeat and later face the other way.',
  ],
  form: {
    alignmentCue: 'Resist the sideways pull so the hips and shoulders stay square and facing forward.',
    avoidCue: 'Avoid letting the torso twist toward the anchor or holding your breath during the press.',
  },
  muscles: [
    { muscleSlug: 'obliques', role: 'strengthen', progressionLevel: 2 },
    { muscleSlug: 'deep-abdominals', role: 'strengthen', progressionLevel: 2 },
  ],
}
